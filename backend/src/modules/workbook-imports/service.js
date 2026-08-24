const crypto = require('crypto');
const {
  previewWorkbook,
  normalizePhone,
  parseEmailDetailsWorkbook,
  normalizeCode,
} = require('./parser');
const repository = require('./repository');

const ALLOWED_RESOLUTIONS = new Set([
  'USE_EXISTING',
  'USE_INCOMING',
  'SKIP_DATE',
  'EXCLUDE_INTERN',
]);

function fingerprint(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeStatus(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[ -]+/g, '_');
}

function validateConflictResolutions(preview, resolutions = {}) {
  const conflicts = preview.conflicts || [];
  const errors = [];
  const normalized = {};
  for (const conflict of conflicts) {
    const selected = resolutions[conflict.id];
    if (!selected) {
      errors.push({ conflictId: conflict.id, error: 'Resolution required' });
      continue;
    }
    if (!ALLOWED_RESOLUTIONS.has(selected)) {
      errors.push({ conflictId: conflict.id, error: 'Unsupported resolution' });
      continue;
    }
    normalized[conflict.id] = selected;
  }
  for (const conflictId of Object.keys(resolutions)) {
    if (!conflicts.some((conflict) => conflict.id === conflictId)) {
      errors.push({
        conflictId,
        error: 'Resolution does not belong to this preview',
      });
    }
  }
  return {
    valid: errors.length === 0,
    resolved: Object.keys(normalized).length,
    required: conflicts.length,
    errors,
    resolutions: normalized,
  };
}

function uniqueIndex(rows, keyFor) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    if (!key) continue;
    const matches = grouped.get(key) || [];
    matches.push(row);
    grouped.set(key, matches);
  }
  return grouped;
}

function selectExistingMatch(intern, phoneIndex, nameIndex) {
  const phone = normalizePhone(intern.phone);
  if (phone) {
    const byPhone = phoneIndex.get(phone) || [];
    if (byPhone.length === 1) return { user: byPhone[0], matchedBy: 'PHONE' };
    if (byPhone.length > 1) return { ambiguous: true, matchedBy: 'PHONE' };
  }
  const name = normalizeName(intern.name);
  if (name) {
    const byName = nameIndex.get(name) || [];
    if (byName.length === 1) return { user: byName[0], matchedBy: 'NAME' };
    if (byName.length > 1) return { ambiguous: true, matchedBy: 'NAME' };
  }
  return null;
}

function profileDifferences(intern, user) {
  const differences = [];
  if (normalizeName(intern.name) !== normalizeName(user.full_name)) {
    differences.push({
      field: 'fullName',
      workbook: intern.name,
      neon: user.full_name,
    });
  }
  const workbookPhone = normalizePhone(intern.phone);
  const neonPhone = normalizePhone(user.phone);
  if (workbookPhone && neonPhone && workbookPhone !== neonPhone) {
    differences.push({
      field: 'phone',
      workbook: workbookPhone,
      neon: neonPhone,
    });
  }
  if (
    intern.joinedDate &&
    user.joining_date &&
    intern.joinedDate !== user.joining_date
  ) {
    differences.push({
      field: 'joiningDate',
      workbook: intern.joinedDate,
      neon: user.joining_date,
    });
  }
  const workbookStatus = normalizeStatus(
    intern.lifecycle?.status || intern.workbookStatus
  );
  const neonStatus = normalizeStatus(user.internship_status);
  if (workbookStatus && neonStatus && workbookStatus !== neonStatus) {
    differences.push({
      field: 'internshipStatus',
      workbook: workbookStatus,
      neon: neonStatus,
    });
  }
  return differences;
}

function compareWithDatabase(preview, existingInterns, existingAttendance) {
  const phoneIndex = uniqueIndex(existingInterns, (user) =>
    normalizePhone(user.phone)
  );
  const nameIndex = uniqueIndex(existingInterns, (user) =>
    normalizeName(user.full_name)
  );
  const attendanceIndex = new Map(
    existingAttendance.map((row) => [`${row.user_id}|${row.date}`, row])
  );
  const internResults = [];
  const counts = {
    databaseMatched: 0,
    databaseNewCandidates: 0,
    databaseAmbiguous: 0,
    databaseProfileDifferences: 0,
    databaseNewAttendance: 0,
    databaseUnchangedAttendance: 0,
    databaseAttendanceConflicts: 0,
    databaseUnmatchedAttendance: 0,
  };

  for (const intern of preview.interns) {
    const match = selectExistingMatch(intern, phoneIndex, nameIndex);
    if (!match) {
      counts.databaseNewCandidates += 1;
      counts.databaseUnmatchedAttendance += intern.attendance.length;
      internResults.push({
        key: intern.key,
        status: 'NEW_CANDIDATE',
        matchedBy: null,
        existingUserId: null,
        profileDifferences: [],
        attendance: {
          new: 0,
          unchanged: 0,
          conflicts: 0,
          unmatched: intern.attendance.length,
        },
      });
      continue;
    }
    if (match.ambiguous) {
      counts.databaseAmbiguous += 1;
      counts.databaseUnmatchedAttendance += intern.attendance.length;
      internResults.push({
        key: intern.key,
        status: 'REVIEW_REQUIRED',
        matchedBy: match.matchedBy,
        existingUserId: null,
        profileDifferences: [],
        attendance: {
          new: 0,
          unchanged: 0,
          conflicts: 0,
          unmatched: intern.attendance.length,
        },
      });
      continue;
    }

    counts.databaseMatched += 1;
    const differences = profileDifferences(intern, match.user);
    if (differences.length) counts.databaseProfileDifferences += 1;
    const attendance = { new: 0, unchanged: 0, conflicts: 0, unmatched: 0 };
    for (const item of intern.attendance) {
      const existing = attendanceIndex.get(`${match.user.id}|${item.date}`);
      if (!existing) {
        attendance.new += 1;
        counts.databaseNewAttendance += 1;
      } else if (existing.status === item.status) {
        attendance.unchanged += 1;
        counts.databaseUnchangedAttendance += 1;
      } else {
        attendance.conflicts += 1;
        counts.databaseAttendanceConflicts += 1;
      }
    }
    internResults.push({
      key: intern.key,
      status: differences.length ? 'PROFILE_DIFFERENCE' : 'MATCHED',
      matchedBy: match.matchedBy,
      existingUserId: match.user.id,
      profileDifferences: differences,
      attendance,
    });
  }

  return {
    enabled: true,
    mode: 'read-only',
    writesAllowed: false,
    counts,
    interns: internResults,
  };
}

function attendanceRange(interns) {
  const dates = interns.flatMap((intern) =>
    intern.attendance.map((item) => item.date)
  );
  if (!dates.length) return { from: null, to: null };
  dates.sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}

function isValidAccountEmail(email) {
  return (
    typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  );
}

function currentWorkbookStatus(intern) {
  return normalizeStatus(intern.lifecycle?.status || intern.workbookStatus);
}

function groupedIndex(rows, keyFor) {
  const index = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    if (!key) continue;
    const list = index.get(key) || [];
    list.push(row);
    index.set(key, list);
  }
  return index;
}
function prioritizedMatches(matches) {
  const primary = matches.filter((profile) => profile.sourcePriority === 1);
  if (primary.length) return primary;
  return matches.filter((profile) => profile.sourcePriority === 2);
}
function applyEmailProfiles(interns, profiles) {
  const byPhone = groupedIndex(profiles, (profile) =>
    normalizePhone(profile.phone)
  );
  const byCode = groupedIndex(profiles, (profile) =>
    normalizeCode(profile.code)
  );
  const counts = {
    emailProfileRows: profiles.length,
    emailMatchedByPhone: 0,
    emailMatchedByCode: 0,
    emailUnmatchedActive: 0,
    emailIdentityConflicts: 0,
    emailInvalidOrMissing: 0,
    emailMatchedFromInternDetails: 0,
  };
  const enriched = interns.map((intern) => {
    if (currentWorkbookStatus(intern) !== 'ACTIVE') return { ...intern };
    const phoneMatches = intern.phone
      ? prioritizedMatches(byPhone.get(normalizePhone(intern.phone)) || [])
      : [];
    const codeMatches = intern.code
      ? prioritizedMatches(byCode.get(normalizeCode(intern.code)) || [])
      : [];
    let match = null;
    let matchedBy = null;
    if (phoneMatches.length === 1) {
      match = phoneMatches[0];
      matchedBy = 'PHONE';
      if (codeMatches.length === 1 && codeMatches[0] !== match) {
        counts.emailIdentityConflicts += 1;
        return { ...intern, email: null, emailMatch: 'IDENTITY_CONFLICT' };
      }
    } else if (phoneMatches.length > 1) {
      counts.emailIdentityConflicts += 1;
      return { ...intern, email: null, emailMatch: 'IDENTITY_CONFLICT' };
    } else if (codeMatches.length === 1) {
      match = codeMatches[0];
      matchedBy = 'INTERN_CODE';
    } else if (codeMatches.length > 1) {
      counts.emailIdentityConflicts += 1;
      return { ...intern, email: null, emailMatch: 'IDENTITY_CONFLICT' };
    }
    if (!match) {
      counts.emailUnmatchedActive += 1;
      return { ...intern, email: null, emailMatch: 'UNMATCHED' };
    }
    if (!match.email) {
      counts.emailInvalidOrMissing += 1;
      return { ...intern, email: null, emailMatch: 'INVALID_EMAIL' };
    }
    if (matchedBy === 'PHONE') counts.emailMatchedByPhone += 1;
    else counts.emailMatchedByCode += 1;
    if (match.sourcePriority === 2) counts.emailMatchedFromInternDetails += 1;
    return {
      ...intern,
      email: match.email,
      emailMatch: matchedBy,
      emailProfileSource: match.sourceSheet,
      emailProfileRow: match.sourceRow,
    };
  });
  return { interns: enriched, counts };
}

function maskPhone(phone) {
  const normalized = normalizePhone(phone);
  return normalized ? `******${normalized.slice(-4)}` : 'Not available';
}
function manualReviewSources(record) {
  return (record.sourceRows || []).map((source) => ({
    sheet: source.sheet,
    row: source.row,
  }));
}
function reviewReasonCodes(record) {
  const codes = [];
  if (record.emailMatch === 'UNMATCHED') codes.push('UNMATCHED_EMAIL_PROFILE');
  if (record.emailMatch === 'IDENTITY_CONFLICT')
    codes.push('EMAIL_IDENTITY_CONFLICT');
  if (record.emailMatch === 'INVALID_EMAIL')
    codes.push('INVALID_PROFILE_EMAIL');
  if (!record.email) codes.push('MISSING_EMAIL');
  else if (!isValidAccountEmail(record.email)) codes.push('INVALID_EMAIL');
  if (!record.code) codes.push('MISSING_INTERN_CODE');
  for (const reason of record.completionReviewReasons || []) codes.push(reason);
  if (
    record.effectiveCompletionDate &&
    record.reasons.some((reason) =>
      reason.includes('Effective completion date has passed')
    )
  ) {
    codes.push('STATUS_VERIFICATION_REQUIRED');
  }
  return [...new Set(codes)];
}
function buildActiveAccountPlan(interns, context, options) {
  const existingByEmail = new Map(
    context.existingInterns
      .filter((user) => user.email)
      .map((user) => [user.email.trim().toLowerCase(), user])
  );
  const existingByPhone = new Map(
    context.existingInterns
      .map((user) => [normalizePhone(user.phone), user])
      .filter(([phone]) => phone)
  );
  const records = [];
  const counts = {
    accountPlanTotal: interns.length,
    accountPlanActive: 0,
    accountPlanEligible: 0,
    accountPlanNonActiveExcluded: 0,
    accountPlanMissingEmail: 0,
    accountPlanInvalidGmail: 0,
    accountPlanMissingInternCode: 0,
    accountPlanExistingUser: 0,
    accountPlanManualReview: 0,
    accountPlanStatusVerification: 0,
    accountPlanAttendanceExcluded: interns.reduce(
      (sum, intern) => sum + intern.attendance.length,
      0
    ),
  };

  for (const intern of interns) {
    const status = currentWorkbookStatus(intern);
    const record = {
      key: intern.key,
      name: intern.name,
      code: intern.code,
      phone: intern.phone,
      email: intern.email,
      sourceRows: intern.sourceRows || [],
      emailProfileSource: intern.emailProfileSource || null,
      emailProfileRow: intern.emailProfileRow || null,
      latestAttendanceCompletionDate: intern.completionDate || null,
      latestAttendanceCompletionSource:
        intern.latestCompletionDateSource || null,
      completionDateHistory: intern.completionDateHistory || [],
      extensionEvidence: intern.extensionEvidence || [],
      completionReviewReasons: intern.completionReviewReasons || [],
      effectiveCompletionDate: intern.completionDate || null,
      extensionDetected: Boolean(intern.extensionDetectedFromAttendance),
      workbookStatus: status || 'UNKNOWN',
      proposedRole: 'INTERN',
      proposedDepartmentId: options.departmentId,
      proposedManagerId: options.managerId,
      temporaryPasswordSource: 'INTERN_CODE',
      firstLoginPasswordChangeRequired: true,
      attendanceImportEnabled: false,
      decision: null,
      reasons: [],
    };

    if (status !== 'ACTIVE') {
      counts.accountPlanNonActiveExcluded += 1;
      record.decision = 'EXCLUDED_NON_ACTIVE';
      record.reasons.push(`Workbook status is ${status || 'UNKNOWN'}`);
      records.push(record);
      continue;
    }

    counts.accountPlanActive += 1;
    if (!intern.email) {
      counts.accountPlanMissingEmail += 1;
      record.reasons.push('Email is missing or invalid');
    } else if (!isValidAccountEmail(intern.email)) {
      counts.accountPlanInvalidGmail += 1;
      record.reasons.push('A valid email address is required');
    }
    if (!intern.code) {
      counts.accountPlanMissingInternCode += 1;
      record.reasons.push('Intern code is required for the temporary password');
    }
    if (record.completionReviewReasons.length) {
      record.reasons.push(...record.completionReviewReasons);
    }
    const asOfDate = options.asOfDate || new Date().toISOString().slice(0, 10);
    if (
      record.completionReviewReasons.length === 0 &&
      record.effectiveCompletionDate &&
      record.effectiveCompletionDate < asOfDate
    ) {
      counts.accountPlanStatusVerification += 1;
      record.reasons.push(
        'Effective completion date has passed; verify current status'
      );
    }

    const existing =
      (intern.email && existingByEmail.get(intern.email.toLowerCase())) ||
      (intern.phone && existingByPhone.get(normalizePhone(intern.phone)));
    if (existing) {
      counts.accountPlanExistingUser += 1;
      record.decision = 'EXISTING_USER';
      record.existingUserId = existing.id;
      record.reasons.push(
        'An existing Neon intern matches this email or phone'
      );
    } else if (record.reasons.length) {
      counts.accountPlanManualReview += 1;
      record.decision = 'MANUAL_REVIEW';
    } else {
      counts.accountPlanEligible += 1;
      record.decision = 'ELIGIBLE';
    }
    records.push(record);
  }

  const manualReview = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.decision === 'MANUAL_REVIEW')
    .map(({ record }) => ({
      name: record.name,
      maskedPhone: maskPhone(record.phone),
      sources: manualReviewSources(record),
      emailProfileSource: record.emailProfileSource,
      emailProfileRow: record.emailProfileRow,
      joiningDate: record.profileJoiningDate,
      endingDate: record.profileEndingDate,
      latestAttendanceCompletionDate: record.latestAttendanceCompletionDate,
      latestAttendanceCompletionSource: record.latestAttendanceCompletionSource,
      completionDateHistory: record.completionDateHistory,
      extensionEvidence: record.extensionEvidence,
      effectiveCompletionDate: record.effectiveCompletionDate,
      extensionDetected: record.extensionDetected,
      reasons: reviewReasonCodes(record),
    }));
  return {
    enabled: true,
    mode: 'active-account-dry-run',
    writesAllowed: false,
    attendanceImportEnabled: false,
    passwordChangeEnforcementReady: false,
    passwordChangeEnforcementNote:
      'A reviewed database migration is still required before first-login password change can be enforced.',
    department: context.department,
    manager: context.manager,
    counts,
    manualReview,
  };
}

async function preview(buffer, options = {}, emailDetailsBuffer = null) {
  const parsedPreview = previewWorkbook(buffer, {
    includeComparisonData: true,
  });
  const { comparisonInterns, ...workbookPreview } = parsedPreview;
  const existingInterns = await repository.getExistingInterns();
  const range = attendanceRange(comparisonInterns);
  const existingAttendance = await repository.getExistingAttendance(
    existingInterns.map((user) => user.id),
    range.from,
    range.to
  );
  const databaseComparison = compareWithDatabase(
    { interns: comparisonInterns },
    existingInterns,
    existingAttendance
  );
  let accountPlan = null;
  if (options.departmentId && options.managerId) {
    const context = await repository.getAccountPlanContext(
      options.departmentId,
      options.managerId
    );
    if (!context.department)
      throw new Error('Selected department was not found');
    if (!context.manager)
      throw new Error('Selected Senior TL or TL was not found');
    if (context.manager.department_id !== context.department.id) {
      throw new Error(
        'Selected manager does not belong to the selected department'
      );
    }
    if (
      options.requesterRole === 'SENIOR_TL' &&
      (options.requesterDepartmentId !== context.department.id ||
        options.requesterId !== context.manager.id)
    ) {
      throw new Error(
        'Senior TL can plan accounts only for their own project group'
      );
    }
    let plannedInterns = comparisonInterns;
    let emailMatching = null;
    if (emailDetailsBuffer) {
      const emailDetails = parseEmailDetailsWorkbook(emailDetailsBuffer);
      const matching = applyEmailProfiles(
        comparisonInterns,
        emailDetails.profiles
      );
      plannedInterns = matching.interns;
      emailMatching = {
        sheet: emailDetails.sheet,
        fallbackSheet: emailDetails.fallbackSheet,
        primaryRows: emailDetails.primaryRows,
        fallbackRows: emailDetails.fallbackRows,
        ...matching.counts,
      };
    }
    accountPlan = buildActiveAccountPlan(plannedInterns, context, options);
    const managerIdentity = {
      id: context.manager.id,
      email: String(context.manager.email || '')
        .trim()
        .toLowerCase(),
      phone: normalizePhone(context.manager.phone),
      code: normalizeCode(context.manager.intern_code),
      role: context.manager.role,
    };
    const managerWorkbookRecords = plannedInterns.filter(
      (intern) =>
        currentWorkbookStatus(intern) === 'ACTIVE' &&
        ((managerIdentity.email &&
          intern.email?.toLowerCase() === managerIdentity.email) ||
          (managerIdentity.phone &&
            normalizePhone(intern.phone) === managerIdentity.phone) ||
          (managerIdentity.code &&
            normalizeCode(intern.code) === managerIdentity.code))
    );
    accountPlan.counts.accountPlanExistingLeadershipReused =
      managerWorkbookRecords.length;
    accountPlan.counts.accountPlanEligible = Math.max(
      0,
      accountPlan.counts.accountPlanEligible - managerWorkbookRecords.length
    );
    accountPlan.counts.accountPlanPeopleReceivingAttendance =
      plannedInterns.filter(
        (intern) => currentWorkbookStatus(intern) === 'ACTIVE'
      ).length;
    const activeInterns = plannedInterns.filter(
      (intern) => currentWorkbookStatus(intern) === 'ACTIVE'
    );
    accountPlan.counts.accountPlanAttendanceToImport = activeInterns.reduce(
      (sum, intern) => sum + intern.attendance.length,
      0
    );
    accountPlan.attendanceImportEnabled = true;
    accountPlan.importScope = 'ACTIVE_INTERNS_AND_ATTENDANCE_ONLY';
    accountPlan.passwordChangeEnforcementReady = true;
    accountPlan.writesAllowed =
      accountPlan.counts.accountPlanManualReview === 0;
    accountPlan.emailMatching = emailMatching;
    if (emailMatching) Object.assign(accountPlan.counts, emailMatching);
  }
  return {
    ...workbookPreview,
    summary: {
      ...workbookPreview.summary,
      ...databaseComparison.counts,
    },
    previewFingerprint: fingerprint(buffer),
    emailPreviewFingerprint: emailDetailsBuffer
      ? fingerprint(emailDetailsBuffer)
      : null,
    resolutionState: validateConflictResolutions(workbookPreview, {}),
    databaseComparison,
    accountPlan,
  };
}

module.exports = {
  preview,
  fingerprint,
  validateConflictResolutions,
  normalizeName,
  compareWithDatabase,
  attendanceRange,
  buildActiveAccountPlan,
  isValidAccountEmail,
  applyEmailProfiles,
};
