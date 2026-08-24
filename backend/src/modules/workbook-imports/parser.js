const XLSX = require('xlsx');

const ATTENDANCE_MAP = {
  PRESENT: { status: 'PRESENT', remarks: null },
  LEAVE: { status: 'LEAVE', remarks: null },
  INFORMED: { status: 'INFORMED', remarks: null },
};
const LIFECYCLE = {
  JOINED: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  TERMINATED: 'TERMINATED',
  DISCONTINUED: 'DISCONTINUED',
  DISCOUNTINUED: 'DISCONTINUED',
};
const ATTENDANCE_SHEET = /^Attendance\s*-\s*.+$/i;

function clean(value) {
  return value == null ? '' : String(value).trim();
}
function normalized(value) {
  return clean(value).toUpperCase().replace(/\s+/g, ' ');
}
function excelDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const text = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return null;
}
function normalizeSheetName(name) {
  return clean(name).replace(/attendnace/i, 'Attendance');
}
function isAttendanceSheet(name) {
  return ATTENDANCE_SHEET.test(normalizeSheetName(name));
}
function extensionEvidenceValue(value) {
  const text = clean(value);
  if (!text || /^-?\d+(?:\.\d+)?$/.test(text)) return null;
  return text;
}
function completionSourcePeriod(source) {
  if (source.latestAttendanceDate) return source.latestAttendanceDate;
  const months = {
    JAN: '01',
    JANUARY: '01',
    FEB: '02',
    FEBRUARY: '02',
    MAR: '03',
    MARCH: '03',
    APR: '04',
    APRIL: '04',
    MAY: '05',
    JUN: '06',
    JUNE: '06',
    JUL: '07',
    JULY: '07',
    AUG: '08',
    AUGUST: '08',
    SEP: '09',
    SEPT: '09',
    SEPTEMBER: '09',
    OCT: '10',
    OCTOBER: '10',
    NOV: '11',
    NOVEMBER: '11',
    DEC: '12',
    DECEMBER: '12',
  };
  const token = normalized(source.sheet).match(
    /ATTENDANCE\s*-\s*([A-Z]+)/
  )?.[1];
  const month = months[token];
  const year = String(source.date || '').slice(0, 4);
  return month && /^\d{4}$/.test(year) ? `${year}-${month}-01` : '';
}
function normalizePhone(value) {
  const digits = clean(value).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}
function normalizeEmail(value) {
  const email = clean(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
function nameAlias(name) {
  return clean(name).toLowerCase().replace(/\s+/g, ' ');
}
const NON_INTERN_NAMES = new Set([
  'NAME',
  'TOTAL',
  'TOTALS',
  'SUMMARY',
  'NOTES',
  'NOTE',
  'REMARKS',
  'GRAND TOTAL',
]);

function isInternRow({
  name,
  code,
  phone,
  workbookStatus,
  completionDate,
  attendance,
  lifecycleEvents,
}) {
  const normalizedName = normalized(name);
  if (!normalizedName || NON_INTERN_NAMES.has(normalizedName)) return false;
  if (
    /^(SR\.?\s*NO\.?|S\.?\s*NO\.?|DATE|STATUS|ATTENDANCE)$/i.test(
      normalizedName
    )
  ) {
    return false;
  }
  return Boolean(
    code ||
    phone ||
    workbookStatus ||
    completionDate ||
    attendance.length ||
    lifecycleEvents.length
  );
}

function aliasesFor({ code, phone, name }) {
  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone) return [`phone:${normalizedPhone}`];

  const normalizedCode = normalized(code);
  if (normalizedCode) return [`code:${normalizedCode}`];

  const normalizedName = normalized(name);
  if (normalizedName) return [`name:${normalizedName}`];

  return [];
}

function findHeaderRow(rows) {
  return rows.findIndex((row) =>
    row.some((cell) => normalized(cell) === 'NAME')
  );
}
function headerIndex(headers, label) {
  return headers.findIndex((header) => normalized(header) === label);
}
function ignoredSheet(sheetName, reason) {
  return {
    sheet: sheetName,
    normalizedSheet: normalizeSheetName(sheetName),
    ignored: true,
    ignoreReason: reason,
    skipped: false,
    warnings: [],
    interns: [],
    dateColumns: 0,
  };
}
function parseSheet(sheetName, sheet, sheetOrder = 0) {
  if (!isAttendanceSheet(sheetName)) {
    return ignoredSheet(sheetName, 'Not a monthly attendance sheet');
  }
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  const headerRow = findHeaderRow(rows);
  if (headerRow < 0) {
    return {
      sheet: sheetName,
      normalizedSheet: normalizeSheetName(sheetName),
      ignored: false,
      skipped: true,
      skipReason: 'NAME header not found',
      warnings: ['NAME header not found'],
      interns: [],
      dateColumns: 0,
    };
  }
  const headers = rows[headerRow];
  const nameIndex = headerIndex(headers, 'NAME');
  const statusIndex = headerIndex(headers, 'STATUS');
  const codeIndex = headerIndex(headers, 'INTERN CODE');
  const phoneIndex = headerIndex(headers, 'CONTACT INFO');
  const emailIndex = headerIndex(headers, 'EMAIL ID');
  const completionIndex = headerIndex(headers, 'COMPLETION DATE');
  const extensionIndex = headerIndex(headers, 'EXTENSION');
  const dateColumns = headers
    .map((header, index) => ({ index, date: excelDate(header) }))
    .filter((column) => column.date);
  const interns = [];
  const warnings = [];
  for (let rowIndex = headerRow + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const name = clean(row[nameIndex]);
    if (!name) continue;
    const code = codeIndex >= 0 ? clean(row[codeIndex]) || null : null;
    const phone = phoneIndex >= 0 ? normalizePhone(row[phoneIndex]) : null;
    const email = emailIndex >= 0 ? normalizeEmail(row[emailIndex]) : null;
    const completionDate =
      completionIndex >= 0 ? excelDate(row[completionIndex]) : null;
    const workbookStatus =
      statusIndex >= 0 ? clean(row[statusIndex]) || null : null;
    const extensionValue =
      extensionIndex >= 0 ? extensionEvidenceValue(row[extensionIndex]) : null;
    const attendance = [];
    const lifecycleEvents = [];
    let joinedDate = null;
    for (const column of dateColumns) {
      const marker = normalized(row[column.index]);
      if (!marker) continue;
      if (ATTENDANCE_MAP[marker]) {
        attendance.push({
          date: column.date,
          source: marker,
          ...ATTENDANCE_MAP[marker],
          sourceSheet: sheetName,
          sourceRow: rowIndex + 1,
        });
      } else if (LIFECYCLE[marker]) {
        const event = {
          status: LIFECYCLE[marker],
          date: column.date,
          source: marker,
          sourceSheet: sheetName,
          sourceRow: rowIndex + 1,
        };
        lifecycleEvents.push(event);
        if (marker === 'JOINED' && !joinedDate) joinedDate = column.date;
      } else if (!/^\d+(?:\.\d+)?$/.test(marker) && marker !== '-') {
        warnings.push(
          `Row ${rowIndex + 1}: unrecognized marker "${clean(row[column.index])}" for ${name}`
        );
      }
    }
    if (
      !isInternRow({
        name,
        code,
        phone,
        workbookStatus,
        completionDate,
        attendance,
        lifecycleEvents,
      })
    ) {
      continue;
    }
    interns.push({
      aliases: aliasesFor({ code, phone, name }),
      name,
      code,
      phone,
      email,
      workbookStatus,
      completionDate,
      completionDateSource: completionDate
        ? {
            date: completionDate,
            sheet: sheetName,
            row: rowIndex + 1,
            sheetOrder,
            latestAttendanceDate: dateColumns.at(-1)?.date || null,
          }
        : null,
      extensionEvidence: extensionValue
        ? {
            value: extensionValue,
            sheet: sheetName,
            row: rowIndex + 1,
            sheetOrder,
          }
        : null,
      joinedDate,
      lifecycleEvents,
      attendance,
      sourceSheet: sheetName,
      sourceRow: rowIndex + 1,
    });
  }
  return {
    sheet: sheetName,
    normalizedSheet: normalizeSheetName(sheetName),
    ignored: false,
    skipped: false,
    headerRow: headerRow + 1,
    dateColumns: dateColumns.length,
    interns,
    warnings,
  };
}
function newCanonical(record, id) {
  return {
    id,
    aliases: new Set(record.aliases),
    name: record.name,
    code: record.code,
    phone: record.phone,
    email: record.email,
    workbookStatus: record.workbookStatus,
    completionDate: record.completionDate,
    completionDateSources: record.completionDateSource
      ? [record.completionDateSource]
      : [],
    extensionEvidence: record.extensionEvidence
      ? [record.extensionEvidence]
      : [],
    joinedDate: record.joinedDate,
    lifecycleEvents: [...record.lifecycleEvents],
    attendance: new Map(),
    sources: new Set([record.sourceSheet]),
    sourceRows: [{ sheet: record.sourceSheet, row: record.sourceRow }],
  };
}
function mergeCanonical(target, source, aliasMap, canonicals) {
  for (const alias of source.aliases) {
    target.aliases.add(alias);
    aliasMap.set(alias, target);
  }
  target.code ||= source.code;
  target.phone ||= source.phone;
  target.email ||= source.email;
  target.joinedDate ||= source.joinedDate;
  target.completionDate ||= source.completionDate;
  target.completionDateSources.push(...source.completionDateSources);
  target.extensionEvidence.push(...source.extensionEvidence);
  target.workbookStatus ||= source.workbookStatus;
  target.lifecycleEvents.push(...source.lifecycleEvents);
  source.sources.forEach((item) => target.sources.add(item));
  target.sourceRows.push(...source.sourceRows);
  for (const [date, item] of source.attendance) {
    if (!target.attendance.has(date)) target.attendance.set(date, item);
  }
  canonicals.delete(source);
}
function mergeInterns(sheets) {
  const aliasMap = new Map();
  const canonicals = new Set();
  const conflicts = [];
  let nextId = 1;
  const records = sheets.flatMap((sheet) => sheet.interns);
  for (const record of records) {
    const matches = [
      ...new Set(
        record.aliases.map((alias) => aliasMap.get(alias)).filter(Boolean)
      ),
    ];
    let canonical;
    if (matches.length === 0) {
      canonical = newCanonical(record, nextId++);
      canonicals.add(canonical);
    } else {
      [canonical] = matches;
      for (const duplicate of matches.slice(1)) {
        mergeCanonical(canonical, duplicate, aliasMap, canonicals);
      }
      canonical.code ||= record.code;
      canonical.phone ||= record.phone;
      canonical.email ||= record.email;
      canonical.joinedDate ||= record.joinedDate;
      canonical.completionDate ||= record.completionDate;
      if (record.completionDateSource) {
        canonical.completionDateSources.push(record.completionDateSource);
      }
      if (record.extensionEvidence) {
        canonical.extensionEvidence.push(record.extensionEvidence);
      }
      if (record.workbookStatus)
        canonical.workbookStatus = record.workbookStatus;
      canonical.lifecycleEvents.push(...record.lifecycleEvents);
      canonical.sources.add(record.sourceSheet);
      canonical.sourceRows.push({
        sheet: record.sourceSheet,
        row: record.sourceRow,
      });
    }
    for (const alias of record.aliases) {
      canonical.aliases.add(alias);
      aliasMap.set(alias, canonical);
    }
    for (const item of record.attendance) {
      const prior = canonical.attendance.get(item.date);
      if (prior && prior.source !== item.source) {
        conflicts.push({
          id: [
            canonical.code || canonical.name,
            item.date,
            prior.sourceSheet,
            prior.sourceRow,
            item.sourceSheet,
            item.sourceRow,
          ].join('|'),
          type: 'ATTENDANCE_STATUS_CONFLICT',
          resolution: 'REVIEW_REQUIRED',
          intern: canonical.code || canonical.name,
          name: canonical.name,
          code: canonical.code,
          phone: canonical.phone ? `******${canonical.phone.slice(-4)}` : null,
          date: item.date,
          existing: prior.source,
          incoming: item.source,
          existingSource: `${prior.sourceSheet} row ${prior.sourceRow}`,
          incomingSource: `${item.sourceSheet} row ${item.sourceRow}`,
          existingCompletionDate: canonical.completionDate,
          incomingCompletionDate: record.completionDate,
          allowedResolutions: [
            {
              value: 'USE_EXISTING',
              label: `Use ${prior.source} from ${prior.sourceSheet} row ${prior.sourceRow}`,
            },
            {
              value: 'USE_INCOMING',
              label: `Use ${item.source} from ${item.sourceSheet} row ${item.sourceRow}`,
            },
            {
              value: 'SKIP_DATE',
              label: `Skip ${item.date} for ${canonical.code || canonical.name}`,
            },
            {
              value: 'EXCLUDE_INTERN',
              label: `Exclude ${canonical.code || canonical.name} from import`,
            },
          ],
        });
      } else if (!prior) {
        canonical.attendance.set(item.date, item);
      }
    }
  }
  const interns = [...canonicals].map((intern) => {
    const attendance = [...intern.attendance.values()].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    const lifecycleEvents = intern.lifecycleEvents.sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    const completionDateSources = [...intern.completionDateSources].sort(
      (a, b) =>
        completionSourcePeriod(b).localeCompare(completionSourcePeriod(a)) ||
        a.row - b.row
    );
    const latestCompletionDateSource = completionDateSources[0] || null;
    const chronologicalCompletionSources = [...completionDateSources].sort(
      (a, b) =>
        completionSourcePeriod(a).localeCompare(completionSourcePeriod(b)) ||
        a.row - b.row
    );
    const distinctCompletionDates = [
      ...new Set(chronologicalCompletionSources.map((source) => source.date)),
    ];
    const extensionDetectedFromAttendance = chronologicalCompletionSources.some(
      (source, index) =>
        chronologicalCompletionSources
          .slice(0, index)
          .some(
            (older) =>
              completionSourcePeriod(source) > completionSourcePeriod(older) &&
              source.date > older.date
          )
    );
    const sameSheetCompletionConflict = chronologicalCompletionSources.some(
      (source, index) =>
        chronologicalCompletionSources
          .slice(index + 1)
          .some(
            (other) =>
              normalizeSheetName(source.sheet) ===
                normalizeSheetName(other.sheet) && source.date !== other.date
          )
    );
    const completionDateRegression = chronologicalCompletionSources.some(
      (source, index) =>
        chronologicalCompletionSources
          .slice(0, index)
          .some(
            (older) =>
              completionSourcePeriod(source) > completionSourcePeriod(older) &&
              source.date < older.date
          )
    );
    const completionReviewReasons = [];
    if (sameSheetCompletionConflict)
      completionReviewReasons.push('COMPLETION_DATE_CONFLICT');
    if (completionDateRegression)
      completionReviewReasons.push('COMPLETION_DATE_REGRESSION');
    return {
      key: intern.code
        ? `code:${intern.code.toUpperCase()}`
        : [...intern.aliases][0],
      aliases: [...intern.aliases].sort(),
      name: intern.name,
      code: intern.code,
      phone: intern.phone,
      email: intern.email,
      workbookStatus: intern.workbookStatus,
      completionDate: latestCompletionDateSource?.date || intern.completionDate,
      completionDateSources,
      completionDateHistory: chronologicalCompletionSources,
      latestCompletionDateSource,
      distinctCompletionDates,
      extensionEvidence: [...intern.extensionEvidence].sort(
        (a, b) => a.sheetOrder - b.sheetOrder || a.row - b.row
      ),
      extensionDetectedFromAttendance,
      completionReviewReasons,
      joinedDate: intern.joinedDate,
      lifecycle: lifecycleEvents.at(-1) || null,
      lifecycleEvents,
      attendance,
      sources: [...intern.sources],
      sourceRows: intern.sourceRows,
    };
  });
  return { interns, conflicts };
}
function flexibleHeaderIndex(headers, labels) {
  const accepted = new Set(labels.map((label) => normalized(label)));
  return headers.findIndex((header) => accepted.has(normalized(header)));
}
function normalizeCode(value) {
  return clean(value).toUpperCase().replace(/\s+/g, '');
}
function profileDate(value) {
  const excel = excelDate(value);
  if (excel) return excel;
  const text = clean(value);
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
function parseProfileSheet(workbook, sheetName, { requireCode }) {
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
  const headerRow = rows.findIndex((row) =>
    row.some((cell) => ['EMAIL ID', 'EMAIL'].includes(normalized(cell)))
  );
  if (headerRow < 0)
    throw new Error(`Email header was not found in ${sheetName}`);
  const headers = rows[headerRow];
  const emailIndex = flexibleHeaderIndex(headers, [
    'EMAIL ID',
    'EMAIL',
    'EMAIL ADDRESS',
  ]);
  const phoneIndex = flexibleHeaderIndex(headers, [
    'MOBILE NO',
    'MOBILE NUM',
    'MOBILE NUMBER',
    'MOBILE NUMBER (WHATSAPP)',
    'CONTACT INFO',
  ]);
  const codeIndex = flexibleHeaderIndex(headers, ['INTERN CODE', 'INTERN ID']);
  const joiningIndex = flexibleHeaderIndex(headers, [
    'ONBOARDING DATE',
    'JOINING DATE',
    'JOINING DATE (ON OFFER LETTER)',
    'START DATE',
  ]);
  const endingIndex = flexibleHeaderIndex(headers, [
    'ENDING DATE',
    'ENDING DATE(',
    'ENDING DATE(ON OFFER LETTER)',
    'END DATE',
    'COMPLETION DATE',
  ]);
  if (emailIndex < 0 || phoneIndex < 0 || (requireCode && codeIndex < 0)) {
    throw new Error(
      `${sheetName} must contain Email and Mobile${requireCode ? ' plus Intern Code' : ''}`
    );
  }
  const profiles = [];
  for (let index = headerRow + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const email = normalizeEmail(row[emailIndex]);
    const phone = normalizePhone(row[phoneIndex]);
    const code = codeIndex >= 0 ? normalizeCode(row[codeIndex]) || null : null;
    if (!email && !phone && !code) continue;
    profiles.push({
      email,
      phone,
      code,
      joiningDate: joiningIndex >= 0 ? profileDate(row[joiningIndex]) : null,
      endingDate: endingIndex >= 0 ? profileDate(row[endingIndex]) : null,
      sourceSheet: sheetName,
      sourceRow: index + 1,
    });
  }
  return profiles;
}
function parseEmailDetailsWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const fullDetails = workbook.SheetNames.find(
    (name) => normalized(name) === 'FULL DETAILS'
  );
  const internDetails = workbook.SheetNames.find(
    (name) => normalized(name) === 'INTERN DETAILS'
  );
  if (!fullDetails) {
    throw new Error('Email-details workbook must contain a Full details sheet');
  }
  const primaryProfiles = parseProfileSheet(workbook, fullDetails, {
    requireCode: true,
  });
  const fallbackProfiles = internDetails
    ? parseProfileSheet(workbook, internDetails, { requireCode: false })
    : [];
  return {
    sheet: fullDetails,
    fallbackSheet: internDetails || null,
    profiles: [
      ...primaryProfiles.map((profile) => ({ ...profile, sourcePriority: 1 })),
      ...fallbackProfiles.map((profile) => ({ ...profile, sourcePriority: 2 })),
    ],
    primaryRows: primaryProfiles.length,
    fallbackRows: fallbackProfiles.length,
  };
}
function ratingName(value) {
  return clean(value)
    .replace(/\s*\((?:captain|team leader|tl|stl)\)\s*$/i, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
function parseRatingsSheets(workbook, interns) {
  const byName = new Map();
  for (const intern of interns) {
    const key = ratingName(intern.name);
    const list = byName.get(key) || [];
    list.push(intern);
    byName.set(key, list);
    intern.ratings = [];
  }
  const summary = {
    ratingSheets: 0,
    ratingRecords: 0,
    ratingNonActiveExcluded: 0,
    ratingUnmatched: 0,
    ratingAmbiguous: 0,
  };
  for (const sheetName of workbook.SheetNames.filter((name) =>
    /^Ratings\s*-\s*.+$/i.test(clean(name))
  )) {
    summary.ratingSheets++;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: true,
      defval: null,
    });
    const head = rows.findIndex((row) =>
      row.some((cell) => normalized(cell) === 'NAME')
    );
    if (head < 0) continue;
    const headers = rows[head],
      nameIndex = headerIndex(headers, 'NAME'),
      statusIndex = headerIndex(headers, 'STATUS');
    for (let r = head + 1; r < rows.length; r++) {
      const row = rows[r],
        name = clean(row[nameIndex]);
      if (!name) continue;
      const matches = byName.get(ratingName(name)) || [];
      if (!matches.length) {
        summary.ratingUnmatched++;
        continue;
      }
      if (matches.length > 1) {
        summary.ratingAmbiguous++;
        continue;
      }
      const intern = matches[0];
      const sheetStatus = statusIndex >= 0 ? normalized(row[statusIndex]) : '';
      const live = normalized(
        intern.lifecycle?.status || intern.workbookStatus
      );
      if (live !== 'ACTIVE' || (sheetStatus && sheetStatus !== 'ACTIVE')) {
        summary.ratingNonActiveExcluded++;
        continue;
      }
      for (let c = 0; c < headers.length; c++) {
        const header = clean(headers[c]),
          score = Number(row[c]);
        if (
          ['SNO', 'SRNO', 'SRNO.', 'COLUMN 1'].includes(normalized(header)) ||
          !header ||
          !Number.isFinite(score) ||
          score < 1 ||
          score > 10
        )
          continue;
        let remarks = null;
        for (let n = c + 1; n < Math.min(c + 4, headers.length); n++) {
          if (/reason|suggestion|improvement/i.test(clean(headers[n]))) {
            remarks = clean(row[n]) || null;
            break;
          }
        }
        intern.ratings.push({
          period: `${sheetName}:${header}`,
          score,
          remarks,
          sourceSheet: sheetName,
          sourceRow: r + 1,
        });
        summary.ratingRecords++;
      }
    }
  }
  return summary;
}
function previewWorkbook(buffer, { includeComparisonData = false } = {}) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheets = workbook.SheetNames.map((name, sheetOrder) =>
    parseSheet(name, workbook.Sheets[name], sheetOrder)
  );
  const merged = mergeInterns(
    sheets.filter((sheet) => !sheet.ignored && !sheet.skipped)
  );
  const attendanceCount = merged.interns.reduce(
    (sum, intern) => sum + intern.attendance.length,
    0
  );
  return {
    mode: 'preview-only',
    importBlocked: merged.conflicts.length > 0,
    workbook: {
      sheets: workbook.SheetNames.length,
      sheetNames: workbook.SheetNames,
    },
    summary: {
      attendanceSheets: sheets.filter(
        (sheet) => !sheet.ignored && !sheet.skipped
      ).length,
      ignoredSheets: sheets.filter((sheet) => sheet.ignored).length,
      skippedSheets: sheets.filter((sheet) => sheet.skipped).length,
      uniqueInterns: merged.interns.length,
      attendanceRecords: attendanceCount,
      reviewRequired: merged.conflicts.length,
      warnings: sheets.reduce((sum, sheet) => sum + sheet.warnings.length, 0),
    },
    sheets: sheets.map(({ interns, ...sheet }) => ({
      ...sheet,
      internRows: interns.length,
    })),
    conflicts: merged.conflicts.slice(0, 100),
    interns: merged.interns.map((intern) => ({
      ...intern,
      attendanceCount: intern.attendance.length,
      attendance: intern.attendance.slice(0, 10),
    })),
    ...(includeComparisonData
      ? {
          comparisonInterns: merged.interns,
        }
      : {}),
  };
}

module.exports = {
  previewWorkbook,
  excelDate,
  normalizeSheetName,
  normalizePhone,
  normalizeEmail,
  isAttendanceSheet,
  parseSheet,
  mergeInterns,
  isInternRow,
  aliasesFor,
  parseEmailDetailsWorkbook,
  parseRatingsSheets,
  normalizeCode,
  profileDate,
};
