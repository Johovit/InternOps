const pool = require('../../config/db');

async function logEvent(data) {
  const {
    userId,
    action,
    resourceType,
    resourceId,
    details,
    oldValue,
    newValue,
    ipAddress,
    userAgent,
  } = data || {};

  await pool.query(
    `INSERT INTO audit_logs
      (user_id, action, resource_type, resource_id, details, old_value, new_value, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      userId || null,
      action,
      resourceType || null,
      resourceId || null,
      details ? JSON.stringify(details) : null,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
      ipAddress || null,
      userAgent || null,
    ]
  );
}

module.exports = {
  logEvent,
};
