const pool = require('../../config/db');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
async function updateAvatarUrl(userId, avatarUrl) {
  await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [
    avatarUrl,
    userId,
  ]);
}
async function getAvatarUrl(userId) {
  const { rows } = await pool.query(
    'SELECT avatar_url FROM users WHERE id = $1',
    [userId]
  );

  return rows[0]?.avatar_url || null;
}

async function deleteFile(dbSavedPath) {
  const projectRoot = path.resolve(__dirname, '..', '..', '..');

  const uploadsRoot = path.resolve(projectRoot, config.uploadDir);
  const normalizedPath = dbSavedPath.replace(/^[/\\]+/, '');
  const absolutePath = path.resolve(projectRoot, normalizedPath);

  const relative = path.relative(uploadsRoot, absolutePath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Directory traversal attempt detected');
  }

  try {
    await fs.promises.unlink(absolutePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;

    console.warn(
      `[deleteFile] File not found, skipping unlink: ${absolutePath}`
    );
  }
}

module.exports = {
  getAvatarUrl,
  updateAvatarUrl,
  deleteFile,
};
