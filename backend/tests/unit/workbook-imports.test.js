const XLSX = require('xlsx');
const {
  previewWorkbook,
  excelDate,
  normalizeSheetName,
  normalizePhone,
  isAttendanceSheet,
} = require('../../src/modules/workbook-imports/parser');

function addSheet(workbook, name, rows) {
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
}
function workbookBuffer() {
  const workbook = XLSX.utils.book_new();
  addSheet(workbook, 'Attendance - June', [
    ['NAME', 'Contact Info ', 'Status', 'Completion Date', 46174, 46175],
    ['Intern 001', '+91 90000 00001', 'Active', 46236, 'JOINED', 'PRESENT'],
  ]);
  addSheet(workbook, 'Attendance - July', [
    [
      'SRNO.',
      'NAME',
      'Status',
      'Intern Code',
      'Contact Info ',
      'Completion Date',
      46204,
      46205,
    ],
    [
      1,
      'Intern 001',
      'Active',
      'CODE-001',
      '+91 90000 00001',
      46236,
      'PRESENT',
      'LEAVE',
    ],
    [
      2,
      'Intern 002',
      'In-Active',
      'CODE-002',
      '+91 90000 00002',
      46236,
      'PRESENT',
      'Discountinued',
    ],
  ]);
  addSheet(workbook, 'Ratings - July', [
    ['NAME', 'Rating'],
    ['Intern 999', 10],
  ]);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('workbook import preview parser', () => {
  test('normalizes workbook-specific values', () => {
    expect(normalizeSheetName('Attendnace - Aug')).toBe('Attendance - Aug');
    expect(isAttendanceSheet('Attendnace - Aug')).toBe(true);
    expect(isAttendanceSheet('Ratings - Aug')).toBe(false);
    expect(normalizePhone('+91 90000 00001')).toBe('9000000001');
    expect(excelDate(46235)).toMatch(/^2026-/);
  });
  test('ignores non-attendance sheets', () => {
    const preview = previewWorkbook(workbookBuffer());
    expect(preview.summary.attendanceSheets).toBe(2);
    expect(preview.summary.ignoredSheets).toBe(1);
    expect(preview.interns.some((intern) => intern.name === 'Intern 999')).toBe(
      false
    );
  });
  test('reconciles code, phone, and name aliases across months', () => {
    const preview = previewWorkbook(workbookBuffer());
    expect(preview.summary.uniqueInterns).toBe(2);
    const first = preview.interns.find((intern) => intern.code === 'CODE-001');
    expect(first.aliases).toEqual(
      expect.arrayContaining([
        'code:CODE-001',
        'phone:9000000001',
        'name:intern 001',
      ])
    );
    expect(first.sources).toHaveLength(2);
    expect(first.joinedDate).toBeTruthy();
  });
  test('does not treat lifecycle markers as attendance statuses', () => {
    const preview = previewWorkbook(workbookBuffer());
    const second = preview.interns.find((intern) => intern.code === 'CODE-002');
    expect(second.lifecycle.status).toBe('DISCONTINUED');
    expect(second.attendance).toHaveLength(1);
  });
  test('blocks import when duplicate rows disagree for one date', () => {
    const workbook = XLSX.utils.book_new();
    addSheet(workbook, 'Attendance - July', [
      ['NAME', 'Intern Code', 'Contact Info ', 46204],
      ['Intern 051', 'CODE-051', '+91 90000 00051', 'LEAVE'],
      ['Intern 051', 'CODE-051', '+91 90000 00051', 'PRESENT'],
    ]);
    const preview = previewWorkbook(
      XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    );
    expect(preview.importBlocked).toBe(true);
    expect(preview.summary.reviewRequired).toBe(1);
    expect(preview.conflicts[0]).toMatchObject({
      resolution: 'REVIEW_REQUIRED',
      existing: 'LEAVE',
      incoming: 'PRESENT',
    });
  });
});

describe('workbook conflict resolution validation', () => {
  const {
    fingerprint,
    validateConflictResolutions,
  } = require('../../src/modules/workbook-imports/service');

  test('creates a deterministic fingerprint for the uploaded workbook', () => {
    const buffer = workbookBuffer();
    expect(fingerprint(buffer)).toBe(fingerprint(buffer));
    expect(fingerprint(buffer)).toHaveLength(64);
  });

  test('requires one supported resolution for every conflict', () => {
    const preview = {
      conflicts: [{ id: 'CODE-051|2026-07-25|84|94' }],
    };

    expect(validateConflictResolutions(preview, {})).toMatchObject({
      valid: false,
      required: 1,
      resolved: 0,
    });

    expect(
      validateConflictResolutions(preview, {
        'CODE-051|2026-07-25|84|94': 'USE_EXISTING',
      })
    ).toMatchObject({
      valid: true,
      required: 1,
      resolved: 1,
    });
  });

  test('rejects unsupported and foreign conflict resolutions', () => {
    const preview = { conflicts: [{ id: 'known' }] };
    const result = validateConflictResolutions(preview, {
      known: 'DELETE_EVERYTHING',
      foreign: 'USE_EXISTING',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});
