const pool = require('../../config/db');

async function createDepartment(name, createdBy) {
  try {
    const res = await pool.query(
      'INSERT INTO departments (name, created_by) VALUES ($1,$2) RETURNING *',
      [name, createdBy]
    );
    return res.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      const err = new Error('Department name already exists');
      err.status = 409;
      throw err;
    }
    throw error;
  }
}

async function getAll() {
  return (
    await pool.query(
      'SELECT * FROM departments WHERE deleted_at IS NULL ORDER BY name'
    )
  ).rows;
}

async function getDepartmentTeams(departmentId) {
  const { rows } = await pool.query(
    `SELECT u.id AS lead_id,
            u.full_name AS lead_name,
            u.role,
            COUNT(r.id)::int AS member_count
     FROM users u
     LEFT JOIN users r
       ON r.manager_id = u.id
      AND r.deleted_at IS NULL
     WHERE u.department_id = $1
       AND u.role IN ('SENIOR_TL', 'TL')
       AND u.deleted_at IS NULL
       AND (u.manager_id IS NULL OR u.manager_id NOT IN (
           SELECT id FROM users WHERE department_id = $1 AND role IN ('SENIOR_TL', 'TL') AND deleted_at IS NULL
       ))
     GROUP BY u.id, u.full_name, u.role
     ORDER BY CASE u.role WHEN 'SENIOR_TL' THEN 0 WHEN 'TL' THEN 1 ELSE 2 END,
              u.full_name`,
    [departmentId]
  );

  return rows;
}

async function deleteDepartment(id, force = false) {
  const { rows } = await pool.query(
    `
    SELECT COUNT(*)::int AS user_count
    FROM users
    WHERE department_id = $1
      AND deleted_at IS NULL
    `,
    [id]
  );

  const userCount = Number(rows[0].user_count);

  if (userCount > 0 && !force) {
    return {
      success: false,
      userCount,
    };
  }

  if (force) {
    await pool.query(
      `
      UPDATE users
      SET department_id = NULL
      WHERE department_id = $1
        AND deleted_at IS NULL
      `,
      [id]
    );
  }

  const result = await pool.query(
    `
    UPDATE departments
    SET deleted_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    RETURNING id
    `,
    [id]
  );

  if (result.rowCount === 0) {
    return {
      success: false,
      userCount: 0,
    };
  }

  return {
    success: true,
    userCount,
  };
}

async function handoverDepartmentLead(
  departmentId,
  outgoingLeadId,
  replacementId,
  actorId,
  suspendOutgoing = false
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `department-handover:${departmentId}`,
    ]);
    const { rows } = await client.query(
      `SELECT id,role,department_id,suspended,deleted_at,full_name
       FROM users WHERE id=ANY($1::uuid[]) FOR UPDATE`,
      [[outgoingLeadId, replacementId]]
    );
    const outgoing = rows.find((user) => user.id === outgoingLeadId);
    const replacement = rows.find((user) => user.id === replacementId);
    if (
      !outgoing ||
      !replacement ||
      outgoing.deleted_at ||
      replacement.deleted_at
    )
      throw Object.assign(
        new Error('Outgoing or replacement user was not found'),
        { statusCode: 404 }
      );
    if (
      !['TL', 'SENIOR_TL'].includes(outgoing.role) ||
      outgoing.department_id !== departmentId
    )
      throw Object.assign(
        new Error('Outgoing user is not a lead of this project group'),
        { statusCode: 409 }
      );
    if (replacement.suspended || replacement.department_id !== departmentId)
      throw Object.assign(
        new Error('Replacement must be active in the same project group'),
        { statusCode: 409 }
      );
    if (!['INTERN', 'CAPTAIN', 'TL', 'SENIOR_TL'].includes(replacement.role))
      throw Object.assign(
        new Error('Replacement role is not eligible for TL handover'),
        { statusCode: 409 }
      );
    const nextManagerId = outgoing.manager_id || null;
    await client.query(
      `UPDATE users SET role='TL',manager_id=$1,updated_at=NOW() WHERE id=$2`,
      [nextManagerId, replacementId]
    );
    const reassigned = await client.query(
      `UPDATE users SET manager_id=$1,updated_at=NOW()
       WHERE manager_id=$2 AND id<>$1 AND deleted_at IS NULL`,
      [replacementId, outgoingLeadId]
    );
    if (suspendOutgoing) {
      await client.query(
        `UPDATE users SET suspended=TRUE,updated_at=NOW() WHERE id=$1`,
        [outgoingLeadId]
      );
    }
    await client.query(
      `INSERT INTO audit_logs(user_id,action,resource_type,resource_id,details)
       VALUES($1,'DEPARTMENT_TL_HANDOVER','department',$2,$3)`,
      [
        actorId,
        departmentId,
        JSON.stringify({
          outgoingLeadId,
          replacementId,
          reassignedUsers: reassigned.rowCount,
          suspendOutgoing,
        }),
      ]
    );
    await client.query('COMMIT');
    return {
      success: true,
      outgoingLeadId,
      replacementId,
      reassignedUsers: reassigned.rowCount,
      outgoingSuspended: suspendOutgoing,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createDepartment,
  getAll,
  getDepartmentTeams,
  deleteDepartment,
};
