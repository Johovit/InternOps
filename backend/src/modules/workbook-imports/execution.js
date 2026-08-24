const argon2 = require('argon2');
const crypto = require('crypto');
const { dbTx } = require('../../utils/dbTx');
const { createAuditLog } = require('../../utils/audit');
const {
  previewWorkbook,
  parseEmailDetailsWorkbook,
  normalizePhone,
  normalizeCode,
} = require('./parser');
const { applyEmailProfiles } = require('./service');

const hash = (buffer) =>
  crypto.createHash('sha256').update(buffer).digest('hex');
const currentStatus = (intern) =>
  String(intern.lifecycle?.status || intern.workbookStatus || '')
    .trim()
    .toUpperCase();
const normalizedEmail = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();
const normalizedText = (value) =>
  String(value || '')
    .trim()
    .toUpperCase();
const valuesSql = (rows, columns, offset = 0) =>
  rows
    .map(
      (_, rowIndex) =>
        `(${columns
          .map(
            (__, columnIndex) =>
              `$${offset + rowIndex * columns.length + columnIndex + 1}`
          )
          .join(',')})`
    )
    .join(',');
const flatten = (rows) => rows.flat();
const report = (options, stage, details = {}) => {
  options.log?.info?.({ stage, ...details }, 'Workbook import progress');
};

function maskEmail(value) {
  const [local = '', domain = ''] = normalizedEmail(value).split('@');
  if (!domain) return 'invalid email';
  return `${local.slice(0, 1) || '*'}***@${domain}`;
}

function findBatchIdentityDuplicates(active) {
  const fields = [
    {
      key: 'email',
      label: 'email address',
      get: (intern) => normalizedEmail(intern.email),
      display: (value) => maskEmail(value),
    },
    {
      key: 'phone',
      label: 'mobile number',
      get: (intern) => normalizePhone(intern.phone),
      display: (value) => `******${String(value).slice(-4)}`,
    },
    {
      key: 'internCode',
      label: 'Intern Code',
      get: (intern) => normalizeCode(intern.code),
      display: (value) => value,
    },
  ];
  const duplicates = [];
  for (const field of fields) {
    const groups = new Map();
    for (const intern of active) {
      const value = field.get(intern);
      if (!value) continue;
      const group = groups.get(value) || [];
      group.push(intern);
      groups.set(value, group);
    }
    for (const [value, interns] of groups) {
      if (interns.length < 2) continue;
      duplicates.push({
        field: field.key,
        label: field.label,
        value: field.display(value),
        interns: interns.map((intern) => ({
          name: intern.name,
          code: normalizeCode(intern.code),
          sources: intern.sources || [],
        })),
      });
    }
  }
  return duplicates;
}

function assertNoBatchIdentityDuplicates(active) {
  const duplicates = findBatchIdentityDuplicates(active);
  if (!duplicates.length) return;
  const details = duplicates
    .map(
      (item) =>
        `${item.label} ${item.value} is assigned to ${item.interns
          .map((intern) => `${intern.name} (${intern.code})`)
          .join(' and ')}`
    )
    .join('; ');
  throw Object.assign(
    new Error(
      `Import blocked because active interns share unique identifiers: ${details}. Correct the Attendance or Email Details workbook, then Preview again.`
    ),
    { statusCode: 409, code: 'BATCH_IDENTITY_DUPLICATE', duplicates }
  );
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run())
  );
  return results;
}

function resolveExistingAccounts(active, rows, department, manager) {
  const byEmail = new Map();
  const byPhone = new Map();
  const byCode = new Map();
  for (const row of rows) {
    const email = normalizedEmail(row.email);
    const phone = normalizePhone(row.phone);
    const code = normalizeCode(row.intern_code);
    if (email) byEmail.set(email, row);
    if (phone) byPhone.set(phone, row);
    if (code) byCode.set(code, row);
  }

  return active.map((intern) => {
    const email = normalizedEmail(intern.email);
    const phone = normalizePhone(intern.phone);
    const code = normalizeCode(intern.code);
    const matches = new Map();
    for (const row of [
      byEmail.get(email),
      phone && byPhone.get(phone),
      byCode.get(code),
    ]) {
      if (row) matches.set(row.id, row);
    }
    if (matches.size > 1) {
      throw Object.assign(
        new Error(
          `Different existing accounts match identifiers for ${intern.name}`
        ),
        { statusCode: 409 }
      );
    }
    const existing = [...matches.values()][0] || null;
    if (existing) {
      const reusableRoles = new Set(['INTERN', 'CAPTAIN', 'TL', 'SENIOR_TL']);
      if (!reusableRoles.has(existing.role)) {
        throw Object.assign(
          new Error(
            `${intern.name} uses an identifier already assigned to a ${existing.role} account`
          ),
          { statusCode: 409, code: 'IDENTIFIER_USED_BY_OTHER_ROLE' }
        );
      }
      if (
        existing.role !== 'INTERN' &&
        existing.department_id !== department.id
      ) {
        throw Object.assign(
          new Error(
            `${intern.name} matches a ${existing.role} account from another project group`
          ),
          { statusCode: 409, code: 'CROSS_DEPARTMENT_LEADER' }
        );
      }
      const conflicts = [];
      if (existing.department_id !== department.id)
        conflicts.push('project group');
      if (existing.role === 'INTERN' && existing.manager_id !== manager.id)
        conflicts.push('manager');
      if (normalizedEmail(existing.email) !== email) conflicts.push('email');
      if (existing.phone && phone && normalizePhone(existing.phone) !== phone)
        conflicts.push('phone');
      if (
        existing.intern_code &&
        code &&
        normalizeCode(existing.intern_code) !== code
      )
        conflicts.push('Intern Code');
      if (conflicts.length) {
        throw Object.assign(
          new Error(
            `${intern.name} already exists but ${conflicts.join(', ')} do not match the reviewed import`
          ),
          { statusCode: 409 }
        );
      }
    }
    return { intern, email, phone, code, existing };
  });
}

async function execute(workbookBuffer, emailBuffer, options) {
  const workbookFingerprint = hash(workbookBuffer);
  const emailWorkbookFingerprint = hash(emailBuffer);
  if (
    options.previewFingerprint !== workbookFingerprint ||
    options.emailPreviewFingerprint !== emailWorkbookFingerprint
  ) {
    throw Object.assign(
      new Error('Workbooks changed after preview. Preview again.'),
      { statusCode: 409 }
    );
  }

  report(options, 'PARSING_WORKBOOKS');
  const parsed = previewWorkbook(workbookBuffer, {
    includeComparisonData: true,
  });
  if (parsed.importBlocked) {
    throw Object.assign(
      new Error('Workbook conflicts must be resolved first'),
      { statusCode: 409 }
    );
  }
  const profiles = parseEmailDetailsWorkbook(emailBuffer).profiles;
  const interns = applyEmailProfiles(
    parsed.comparisonInterns,
    profiles
  ).interns;
  const active = interns.filter((intern) => currentStatus(intern) === 'ACTIVE');
  const unsafeActive = active.filter(
    (intern) =>
      !intern.email || !intern.code || intern.emailMatch === 'IDENTITY_CONFLICT'
  );
  if (unsafeActive.length) {
    throw Object.assign(
      new Error(
        `${unsafeActive.length} active intern record(s) require email or identity review`
      ),
      { statusCode: 409 }
    );
  }
  assertNoBatchIdentityDuplicates(active);

  return dbTx(async (client) => {
    report(options, 'VALIDATING_SCOPE');
    const department = (
      await client.query(
        'SELECT id FROM departments WHERE id=$1 AND deleted_at IS NULL',
        [options.departmentId]
      )
    ).rows[0];
    const manager = (
      await client.query(
        "SELECT id,role,email,phone,intern_code,department_id,manager_id FROM users WHERE id=$1 AND role IN ('TL','SENIOR_TL') AND deleted_at IS NULL",
        [options.managerId]
      )
    ).rows[0];
    if (!department || !manager || manager.department_id !== department.id) {
      throw Object.assign(new Error('Invalid project group or manager'), {
        statusCode: 400,
      });
    }
    if (
      options.requesterRole === 'SENIOR_TL' &&
      (options.requesterId !== manager.id ||
        options.requesterDepartmentId !== department.id)
    ) {
      throw Object.assign(
        new Error('Senior TL can import only into their own project group'),
        { statusCode: 403 }
      );
    }

    const lockKey = [
      workbookFingerprint,
      emailWorkbookFingerprint,
      department.id,
      manager.id,
    ].join(':');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      lockKey,
    ]);
    const priorBatch = (
      await client.query(
        "SELECT id,status FROM workbook_import_batches WHERE workbook_fingerprint=$1 AND email_workbook_fingerprint=$2 AND department_id=$3 AND manager_id=$4 AND status IN ('RUNNING','COMPLETED') ORDER BY created_at DESC LIMIT 1",
        [
          workbookFingerprint,
          emailWorkbookFingerprint,
          department.id,
          manager.id,
        ]
      )
    ).rows[0];
    if (priorBatch?.status === 'COMPLETED') {
      throw Object.assign(new Error('This exact import already completed'), {
        statusCode: 409,
      });
    }
    if (priorBatch?.status === 'RUNNING') {
      throw Object.assign(new Error('This exact import is already running'), {
        statusCode: 409,
      });
    }

    const batch = (
      await client.query(
        'INSERT INTO workbook_import_batches(workbook_fingerprint,email_workbook_fingerprint,department_id,manager_id,requested_by) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [
          workbookFingerprint,
          emailWorkbookFingerprint,
          department.id,
          manager.id,
          options.requesterId,
        ]
      )
    ).rows[0];
    const summary = {
      activeInterns: active.length,
      nonActiveExcluded: interns.length - active.length,
      accountsCreated: 0,
      existingAccounts: 0,
      existingInternAccountsReused: 0,
      existingLeadershipAccountsReused: 0,
      peopleReceivingAttendance: 0,
      attendanceCreated: 0,
      attendanceUnchanged: 0,
    };

    report(options, 'CHECKING_EXISTING_ACCOUNTS', { count: active.length });
    const emails = [
      ...new Set(active.map((intern) => normalizedEmail(intern.email))),
    ];
    const phones = [
      ...new Set(
        active.map((intern) => normalizePhone(intern.phone)).filter(Boolean)
      ),
    ];
    const codes = [
      ...new Set(active.map((intern) => normalizeCode(intern.code))),
    ];
    const existingRows = (
      await client.query(
        'SELECT id,role,email,phone,intern_code,department_id,manager_id,password_hash,must_change_password,suspended FROM users WHERE deleted_at IS NULL AND (LOWER(email)=ANY($1::text[]) OR phone=ANY($2::text[]) OR UPPER(intern_code)=ANY($3::text[])) FOR UPDATE',
        [emails, phones, codes]
      )
    ).rows;
    const plans = resolveExistingAccounts(
      active,
      existingRows,
      department,
      manager
    );
    summary.existingAccounts = plans.filter((plan) => plan.existing).length;
    summary.existingInternAccountsReused = plans.filter(
      (plan) => plan.existing?.role === 'INTERN'
    ).length;
    summary.existingLeadershipAccountsReused = plans.filter((plan) =>
      ['CAPTAIN', 'TL', 'SENIOR_TL'].includes(plan.existing?.role)
    ).length;
    summary.peopleReceivingAttendance = plans.length;
    summary.profilePhonesEnriched = 0;
    for (const plan of plans.filter(
      (item) =>
        item.existing && !normalizePhone(item.existing.phone) && item.phone
    )) {
      const phoneOwner = await client.query(
        'SELECT id FROM users WHERE phone=$1 AND deleted_at IS NULL AND id<>$2 LIMIT 1',
        [plan.phone, plan.existing.id]
      );
      if (phoneOwner.rowCount > 0) {
        throw Object.assign(
          new Error(
            `${plan.intern.name} phone is already assigned to another account`
          ),
          { statusCode: 409, code: 'PHONE_ALREADY_USED' }
        );
      }
      await client.query(
        'UPDATE users SET phone=$1,updated_at=NOW() WHERE id=$2 AND phone IS NULL AND deleted_at IS NULL',
        [plan.phone, plan.existing.id]
      );
      await createAuditLog(
        {
          userId: options.requesterId,
          action: 'PROFILE_PHONE_ENRICHED',
          resourceType: 'user',
          resourceId: plan.existing.id,
          details: { source: 'reviewed workbook import' },
        },
        client
      );
      plan.existing.phone = plan.phone;
      summary.profilePhonesEnriched++;
    }
    const newPlans = plans.filter((plan) => !plan.existing);
    summary.newInternAccounts = newPlans.length;

    report(options, 'HASHING_PASSWORDS', { count: newPlans.length });
    const hashedPlans = await mapWithConcurrency(newPlans, 4, async (plan) => ({
      ...plan,
      passwordHash: await argon2.hash(plan.code),
    }));

    if (hashedPlans.length) {
      report(options, 'CREATING_ACCOUNTS', { count: hashedPlans.length });
      const columns = 9;
      const sql = `INSERT INTO users(email,password_hash,role,manager_id,department_id,full_name,phone,joining_date,internship_status,intern_code,must_change_password,email_verified)
        SELECT v.email,v.password_hash,'INTERN',v.manager_id::uuid,v.department_id::uuid,v.full_name,v.phone,v.joining_date::date,'ACTIVE',v.intern_code,TRUE,TRUE
        FROM (VALUES ${valuesSql(hashedPlans, Array(columns).fill(null))}) AS v(email,password_hash,manager_id,department_id,full_name,phone,joining_date,intern_code,plan_index)
        RETURNING id,intern_code`;
      const params = flatten(
        hashedPlans.map((plan, index) => [
          plan.email,
          plan.passwordHash,
          manager.id,
          department.id,
          plan.intern.name,
          plan.phone,
          plan.intern.joinedDate || null,
          plan.code,
          index,
        ])
      );
      const inserted = (await client.query(sql, params)).rows;
      const byCode = new Map(
        inserted.map((row) => [normalizeCode(row.intern_code), row.id])
      );
      for (const plan of hashedPlans) plan.userId = byCode.get(plan.code);
      summary.accountsCreated = inserted.length;
    }

    for (const plan of plans) {
      if (plan.existing) plan.userId = plan.existing.id;
      else {
        const hashed = hashedPlans.find((item) => item.code === plan.code);
        plan.userId = hashed?.userId;
      }
      if (!plan.userId) {
        throw new Error(`Could not resolve account for ${plan.intern.name}`);
      }
    }

    const attendanceRows = plans.flatMap((plan) =>
      (plan.intern.attendance || []).map((item) => ({
        userId: plan.userId,
        name: plan.intern.name,
        date: item.date,
        status: item.status,
        remarks: item.remarks || null,
      }))
    );
    report(options, 'CHECKING_EXISTING_ATTENDANCE', {
      count: attendanceRows.length,
    });
    const pairColumns = 2;
    const existingAttendance = attendanceRows.length
      ? (
          await client.query(
            `SELECT a.user_id,a.date::text,a.status,a.remarks
             FROM attendance a
             JOIN (VALUES ${valuesSql(attendanceRows, Array(pairColumns).fill(null))}) AS wanted(user_id,date)
               ON a.user_id=wanted.user_id::uuid AND a.date=wanted.date::date
             WHERE a.deleted_at IS NULL
             FOR UPDATE`,
            flatten(attendanceRows.map((row) => [row.userId, row.date]))
          )
        ).rows
      : [];
    const existingAttendanceMap = new Map(
      existingAttendance.map((row) => [
        `${row.user_id}:${String(row.date).slice(0, 10)}`,
        row,
      ])
    );
    const toInsert = [];
    for (const row of attendanceRows) {
      const old = existingAttendanceMap.get(`${row.userId}:${row.date}`);
      if (!old) {
        toInsert.push(row);
      } else if (
        normalizedText(old.status) === normalizedText(row.status) &&
        String(old.remarks || '') === String(row.remarks || '')
      ) {
        summary.attendanceUnchanged++;
      } else {
        throw Object.assign(
          new Error(`Attendance conflict for ${row.name} on ${row.date}`),
          { statusCode: 409 }
        );
      }
    }

    if (toInsert.length) {
      report(options, 'CREATING_ATTENDANCE', { count: toInsert.length });
      const columns = 5;
      await client.query(
        `INSERT INTO attendance(user_id,marked_by,date,status,remarks) VALUES ${valuesSql(toInsert, Array(columns).fill(null))}`,
        flatten(
          toInsert.map((row) => [
            row.userId,
            options.requesterId,
            row.date,
            row.status,
            row.remarks,
          ])
        )
      );
      summary.attendanceCreated = toInsert.length;
    }

    await client.query(
      "UPDATE workbook_import_batches SET status='COMPLETED',summary=$1,completed_at=NOW() WHERE id=$2",
      [summary, batch.id]
    );
    await createAuditLog(
      {
        userId: options.requesterId,
        action: 'WORKBOOK_IMPORT_COMPLETED',
        resourceType: 'workbook_import',
        resourceId: batch.id,
        details: summary,
      },
      client
    );
    report(options, 'COMPLETED', summary);
    return { success: true, batchId: batch.id, summary };
  });
}

module.exports = {
  execute,
  hash,
  mapWithConcurrency,
  resolveExistingAccounts,
  findBatchIdentityDuplicates,
  assertNoBatchIdentityDuplicates,
};
