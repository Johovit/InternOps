const crypto = require('crypto');
const { previewWorkbook } = require('./parser');
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

async function preview(buffer) {
  const workbookPreview = previewWorkbook(buffer);
  const existingInterns = await repository.getExistingInterns();
  return {
    ...workbookPreview,
    previewFingerprint: fingerprint(buffer),
    resolutionState: validateConflictResolutions(workbookPreview, {}),
    databaseComparison: {
      enabled: false,
      existingInterns: existingInterns.length,
    },
  };
}

module.exports = {
  preview,
  fingerprint,
  validateConflictResolutions,
};
