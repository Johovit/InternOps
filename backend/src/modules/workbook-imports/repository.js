const pool = require('../../config/db');

async function getExistingInterns(client = pool) {
  const result = await client.query(`
    SELECT id,
           full_name,
           phone,
           email,
           internship_status,
           TO_CHAR(joining_date, 'YYYY-MM-DD') AS joining_date
    FROM users
    WHERE role = 'INTERN'
      AND deleted_at IS NULL
    ORDER BY full_name ASC, id ASC
  `);
  return result.rows;
}

async function getExistingAttendance(userIds, from, to, client = pool) {
  if (!userIds.length || !from || !to) return [];
  const result = await client.query(
    `SELECT user_id,
            TO_CHAR(date, 'YYYY-MM-DD') AS date,
            status,
            remarks
     FROM attendance
     WHERE user_id = ANY($1::uuid[])
       AND date >= $2
       AND date <= $3
       AND deleted_at IS NULL
     ORDER BY user_id ASC, date ASC`,
    [userIds, from, to]
  );
  return result.rows;
}

module.exports = {
  getExistingInterns,
  getExistingAttendance,
};
