jest.mock('../../src/utils/dbTx', () => ({ dbTx: jest.fn() }));
jest.mock('../../src/utils/audit', () => ({ createAuditLog: jest.fn() }));
jest.mock('argon2', () => ({
  hash: jest.fn(async (value) => `hashed-${value}`),
}));
jest.mock('../../src/modules/workbook-imports/parser', () => ({
  previewWorkbook: jest.fn(),
  parseEmailDetailsWorkbook: jest.fn(),
  normalizePhone: jest.fn((value) => value || null),
  normalizeCode: jest.fn((value) => String(value || '').toUpperCase()),
}));
jest.mock('../../src/modules/workbook-imports/service', () => ({
  applyEmailProfiles: jest.fn(),
}));

const { dbTx } = require('../../src/utils/dbTx');
const { createAuditLog } = require('../../src/utils/audit');
const parser = require('../../src/modules/workbook-imports/parser');
const service = require('../../src/modules/workbook-imports/service');
const {
  execute,
  hash,
  resolveExistingAccounts,
  findBatchIdentityDuplicates,
  assertNoBatchIdentityDuplicates,
} = require('../../src/modules/workbook-imports/execution');

const workbook = Buffer.from('main-workbook');
const emails = Buffer.from('email-workbook');
const options = {
  previewFingerprint: hash(workbook),
  emailPreviewFingerprint: hash(emails),
  departmentId: 'department-1',
  managerId: 'manager-1',
  requesterId: 'admin-1',
  requesterRole: 'ADMIN',
};
function intern(overrides = {}) {
  return {
    name: 'Current Intern',
    code: 'INT-001',
    phone: '9000000001',
    email: 'current@example.com',
    emailMatch: 'PHONE',
    workbookStatus: 'Active',
    joinedDate: '2026-08-01',
    attendance: [{ date: '2026-08-02', status: 'PRESENT', remarks: null }],
    ratings: [{ score: 9 }],
    ...overrides,
  };
}
function clientWith(overrides = {}) {
  const queries = [];
  let insertedUser = 0;
  const client = {
    query: jest.fn(async (sql) => {
      queries.push(sql);
      if (sql.startsWith('SELECT id FROM departments'))
        return { rows: [{ id: 'department-1' }], rowCount: 1 };
      if (sql.includes("WHERE id=$1 AND role IN ('TL','SENIOR_TL')"))
        return {
          rows: [
            {
              id: 'manager-1',
              role: 'TL',
              email: 'manager@example.com',
              phone: '9000000099',
              intern_code: 'MGR-1',
              department_id: 'department-1',
              manager_id: null,
            },
          ],
          rowCount: 1,
        };
      if (sql.startsWith('SELECT pg_advisory_xact_lock'))
        return { rows: [], rowCount: 1 };
      if (sql.includes('FROM workbook_import_batches WHERE'))
        return {
          rows: overrides.priorBatch ? [overrides.priorBatch] : [],
          rowCount: overrides.priorBatch ? 1 : 0,
        };
      if (sql.startsWith('INSERT INTO workbook_import_batches'))
        return { rows: [{ id: 'batch-1' }], rowCount: 1 };
      if (sql.startsWith('SELECT id FROM users WHERE phone='))
        return {
          rows: overrides.phoneOwners || [],
          rowCount: (overrides.phoneOwners || []).length,
        };
      if (sql.includes('FROM users WHERE deleted_at IS NULL'))
        return {
          rows: overrides.existingUsers || [],
          rowCount: (overrides.existingUsers || []).length,
        };
      if (sql.startsWith('INSERT INTO users')) {
        insertedUser++;
        return {
          rows: [{ id: `user-${insertedUser}`, intern_code: 'INT-001' }],
          rowCount: 1,
        };
      }
      if (sql.startsWith('SELECT a.user_id'))
        return {
          rows: overrides.existingAttendance || [],
          rowCount: (overrides.existingAttendance || []).length,
        };
      return { rows: [], rowCount: 1 };
    }),
  };
  return { client, queries };
}

beforeEach(() => {
  jest.clearAllMocks();
  parser.previewWorkbook.mockReturnValue({
    importBlocked: false,
    comparisonInterns: [intern()],
  });
  parser.parseEmailDetailsWorkbook.mockReturnValue({ profiles: [] });
  service.applyEmailProfiles.mockReturnValue({ interns: [intern()] });
});

test('rejects changed workbooks before opening a transaction', async () => {
  await expect(
    execute(workbook, emails, {
      ...options,
      previewFingerprint: '0'.repeat(64),
    })
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(dbTx).not.toHaveBeenCalled();
});

test('rejects an already completed exact import', async () => {
  const { client } = clientWith({
    priorBatch: { id: 'old', status: 'COMPLETED' },
  });
  dbTx.mockImplementation(async (work) => work(client));
  await expect(execute(workbook, emails, options)).rejects.toMatchObject({
    statusCode: 409,
  });
});

test('rejects an identical import already running', async () => {
  const { client } = clientWith({
    priorBatch: { id: 'running', status: 'RUNNING' },
  });
  dbTx.mockImplementation(async (work) => work(client));
  await expect(execute(workbook, emails, options)).rejects.toMatchObject({
    statusCode: 409,
  });
});

test('bulk creates one account and attendance without Ratings writes', async () => {
  const { client, queries } = clientWith();
  dbTx.mockImplementation(async (work) => work(client));
  const result = await execute(workbook, emails, options);
  expect(result.summary).toMatchObject({
    accountsCreated: 1,
    existingAccounts: 0,
    attendanceCreated: 1,
  });
  expect(
    queries.filter((sql) => sql.startsWith('INSERT INTO users'))
  ).toHaveLength(1);
  expect(
    queries.filter((sql) => sql.startsWith('INSERT INTO attendance'))
  ).toHaveLength(1);
  expect(queries.some((sql) => /ratings/i.test(sql))).toBe(false);
  expect(createAuditLog).toHaveBeenCalled();
});

test('reuses one matching account and skips identical attendance', async () => {
  const existingUsers = [
    {
      id: 'existing-1',
      role: 'INTERN',
      email: 'current@example.com',
      phone: '9000000001',
      intern_code: 'INT-001',
      department_id: 'department-1',
      manager_id: 'manager-1',
    },
  ];
  const existingAttendance = [
    {
      user_id: 'existing-1',
      role: 'INTERN',
      date: '2026-08-02',
      status: 'PRESENT',
      remarks: null,
    },
  ];
  const { client, queries } = clientWith({ existingUsers, existingAttendance });
  dbTx.mockImplementation(async (work) => work(client));
  const result = await execute(workbook, emails, options);
  expect(result.summary).toMatchObject({
    accountsCreated: 0,
    existingAccounts: 1,
    attendanceCreated: 0,
    attendanceUnchanged: 1,
  });
  expect(queries.some((sql) => sql.startsWith('INSERT INTO users'))).toBe(
    false
  );
  expect(queries.some((sql) => sql.startsWith('INSERT INTO attendance'))).toBe(
    false
  );
});

test('rejects an existing account assigned to another project group', () => {
  expect(() =>
    resolveExistingAccounts(
      [intern()],
      [
        {
          id: 'existing-1',
          role: 'INTERN',
          email: 'current@example.com',
          phone: '9000000001',
          intern_code: 'INT-001',
          department_id: 'other',
          manager_id: 'manager-1',
        },
      ],
      { id: 'department-1' },
      { id: 'manager-1' }
    )
  ).toThrow(/project group/);
});

test('rejects conflicting existing attendance instead of overwriting', async () => {
  const existingUsers = [
    {
      id: 'existing-1',
      role: 'INTERN',
      email: 'current@example.com',
      phone: '9000000001',
      intern_code: 'INT-001',
      department_id: 'department-1',
      manager_id: 'manager-1',
    },
  ];
  const existingAttendance = [
    {
      user_id: 'existing-1',
      role: 'INTERN',
      date: '2026-08-02',
      status: 'LEAVE',
      remarks: null,
    },
  ];
  const { client } = clientWith({ existingUsers, existingAttendance });
  dbTx.mockImplementation(async (work) => work(client));
  await expect(execute(workbook, emails, options)).rejects.toMatchObject({
    statusCode: 409,
  });
});

test('finds duplicate normalized emails inside the active batch', () => {
  const duplicates = findBatchIdentityDuplicates([
    intern({
      name: 'Intern One',
      code: 'INT-001',
      phone: '9000000001',
      email: 'Shared@Example.com',
    }),
    intern({
      name: 'Intern Two',
      code: 'INT-002',
      phone: '9000000002',
      email: 'shared@example.com',
    }),
  ]);
  expect(duplicates).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        field: 'email',
        value: 's***@example.com',
        interns: expect.arrayContaining([
          expect.objectContaining({ name: 'Intern One' }),
          expect.objectContaining({ name: 'Intern Two' }),
        ]),
      }),
    ])
  );
});

test.each([
  ['email', { email: 'same@example.com' }, { email: 'SAME@example.com' }],
  ['phone', { phone: '9000000001' }, { phone: '9000000001' }],
  ['Intern Code', { code: 'INT-001' }, { code: 'int-001' }],
])('blocks duplicate %s before dbTx opens', async (_label, first, second) => {
  const active = [
    intern({
      name: 'Intern One',
      code: 'INT-101',
      phone: '9000000101',
      email: 'one@example.com',
      ...first,
    }),
    intern({
      name: 'Intern Two',
      code: 'INT-102',
      phone: '9000000102',
      email: 'two@example.com',
      ...second,
    }),
  ];
  parser.previewWorkbook.mockReturnValue({
    importBlocked: false,
    comparisonInterns: active,
  });
  service.applyEmailProfiles.mockReturnValue({ interns: active });
  await expect(execute(workbook, emails, options)).rejects.toMatchObject({
    statusCode: 409,
    code: 'BATCH_IDENTITY_DUPLICATE',
  });
  expect(dbTx).not.toHaveBeenCalled();
});

test('blocks an identifier already owned by a non-intern account', () => {
  expect(() =>
    resolveExistingAccounts(
      [intern()],
      [
        {
          id: 'admin-1',
          role: 'ADMIN',
          email: 'current@example.com',
          phone: '1111111111',
          intern_code: null,
          department_id: null,
          manager_id: null,
        },
      ],
      { id: 'department-1' },
      { id: 'manager-1' }
    )
  ).toThrow(/ADMIN account/);
});

test('duplicate validation error contains masked review details', () => {
  expect(() =>
    assertNoBatchIdentityDuplicates([
      intern({ name: 'One', code: 'INT-001', email: 'same@example.com' }),
      intern({
        name: 'Two',
        code: 'INT-002',
        email: 'same@example.com',
        phone: '9000000002',
      }),
    ])
  ).toThrow(/s\*\*\*@example.com/);
});

test('reuses selected TL account without changing role or credentials', async () => {
  const leader = intern({
    name: 'Manager',
    code: 'MGR-1',
    phone: '9000000099',
    email: 'manager@example.com',
  });
  parser.previewWorkbook.mockReturnValue({
    importBlocked: false,
    comparisonInterns: [leader],
  });
  service.applyEmailProfiles.mockReturnValue({ interns: [leader] });
  const existingUsers = [
    {
      id: 'manager-1',
      role: 'TL',
      email: 'manager@example.com',
      phone: '9000000099',
      intern_code: 'MGR-1',
      department_id: 'department-1',
      manager_id: null,
      password_hash: 'original-hash',
      must_change_password: false,
      suspended: false,
    },
  ];
  const { client, queries } = clientWith({ existingUsers });
  dbTx.mockImplementation(async (work) => work(client));
  const result = await execute(workbook, emails, options);
  expect(result.summary.existingLeadershipAccountsReused).toBe(1);
  expect(result.summary.accountsCreated).toBe(0);
  expect(result.summary.attendanceCreated).toBe(1);
  expect(queries.some((sql) => sql.startsWith('INSERT INTO users'))).toBe(
    false
  );
  const accountMutationQueries = queries.filter((sql) =>
    sql.startsWith('UPDATE users SET')
  );
  expect(
    accountMutationQueries.some((sql) =>
      /(?:^|[,\s])(?:role|password_hash|must_change_password)\s*=/.test(sql)
    )
  ).toBe(false);
});

test('blocks a leader identity from another project group', () => {
  expect(() =>
    resolveExistingAccounts(
      [intern()],
      [
        {
          id: 'leader-2',
          role: 'TL',
          email: 'current@example.com',
          phone: '9000000001',
          intern_code: 'INT-001',
          department_id: 'other',
          manager_id: null,
        },
      ],
      { id: 'department-1' },
      { id: 'manager-1' }
    )
  ).toThrow(/another project group/);
});

test('enriches a blank existing leader phone without changing credentials', async () => {
  const leader = intern({
    name: 'Manager',
    code: 'MGR-1',
    phone: '9000000099',
    email: 'manager@example.com',
  });
  parser.previewWorkbook.mockReturnValue({
    importBlocked: false,
    comparisonInterns: [leader],
  });
  service.applyEmailProfiles.mockReturnValue({ interns: [leader] });
  const existingUsers = [
    {
      id: 'manager-1',
      role: 'TL',
      email: 'manager@example.com',
      phone: null,
      intern_code: 'MGR-1',
      department_id: 'department-1',
      manager_id: null,
      password_hash: 'original',
      must_change_password: false,
      suspended: false,
    },
  ];
  const { client, queries } = clientWith({ existingUsers });
  dbTx.mockImplementation(async (work) => work(client));
  const result = await execute(workbook, emails, options);
  expect(result.summary.profilePhonesEnriched).toBe(1);
  expect(queries.some((sql) => sql.startsWith('UPDATE users SET phone='))).toBe(
    true
  );
  expect(
    queries.some((sql) =>
      /UPDATE users SET .*password_hash|UPDATE users SET .*role=/.test(sql)
    )
  ).toBe(false);
});
