const crypto = require('crypto');
const { previewWorkbook, normalizePhone } = require('./parser');
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

async function preview(buffer) {
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
  return {
    ...workbookPreview,
    summary: {
      ...workbookPreview.summary,
      ...databaseComparison.counts,
    },
    previewFingerprint: fingerprint(buffer),
    resolutionState: validateConflictResolutions(workbookPreview, {}),
    databaseComparison,
  };
}

module.exports = {
  preview,
  fingerprint,
  validateConflictResolutions,
  normalizeName,
  compareWithDatabase,
  attendanceRange,
};
