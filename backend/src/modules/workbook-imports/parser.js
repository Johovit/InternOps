const XLSX = require('xlsx');

const ATTENDANCE_MAP = {
  PRESENT: { status: 'PRESENT', remarks: null },
  LEAVE: { status: 'ABSENT', remarks: 'Imported from workbook: LEAVE' },
  INFORMED: { status: 'ABSENT', remarks: 'Imported from workbook: INFORMED' },
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
function normalizePhone(value) {
  const digits = clean(value).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
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
  return [
    code ? `code:${code.toUpperCase()}` : null,
    phone ? `phone:${phone}` : null,
    name ? `name:${nameAlias(name)}` : null,
  ].filter(Boolean);
}
function generatedEmail(code, name) {
  const base = (code || name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
  return `${base || 'unknown'}@import.internops.local`;
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
function parseSheet(sheetName, sheet) {
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
  const completionIndex = headerIndex(headers, 'COMPLETION DATE');
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
    const completionDate =
      completionIndex >= 0 ? excelDate(row[completionIndex]) : null;
    const workbookStatus =
      statusIndex >= 0 ? clean(row[statusIndex]) || null : null;
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
      email: generatedEmail(code, name),
      workbookStatus,
      completionDate,
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
  target.joinedDate ||= source.joinedDate;
  target.completionDate ||= source.completionDate;
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
      canonical.joinedDate ||= record.joinedDate;
      canonical.completionDate ||= record.completionDate;
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
          phone: canonical.phone,
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
    return {
      key: intern.code
        ? `code:${intern.code.toUpperCase()}`
        : [...intern.aliases][0],
      aliases: [...intern.aliases].sort(),
      name: intern.name,
      code: intern.code,
      phone: intern.phone,
      email: generatedEmail(intern.code, intern.name),
      workbookStatus: intern.workbookStatus,
      completionDate: intern.completionDate,
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
function previewWorkbook(buffer, { includeComparisonData = false } = {}) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheets = workbook.SheetNames.map((name) =>
    parseSheet(name, workbook.Sheets[name])
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
  isAttendanceSheet,
  parseSheet,
  mergeInterns,
  isInternRow,
};
