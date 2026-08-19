const auth = require('../../middleware/auth');
const rbac = require('../../middleware/rbac');
const service = require('./service');

const XLSX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);
const MAX_WORKBOOK_SIZE = 10 * 1024 * 1024;
function hasZipSignature(buffer) {
  return buffer?.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}
async function routes(fastify) {
  fastify.post(
    '/preview',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      preHandler: [auth, rbac('ADMIN')],
      schema: {
        tags: ['Workbook Imports'],
        description:
          'Preview an anonymized XLSX workbook without writing to the database',
      },
    },
    async (request, reply) => {
      const upload = await request.file({
        limits: { fileSize: MAX_WORKBOOK_SIZE, files: 1 },
      });
      if (!upload)
        return reply.status(400).send({ error: 'No workbook uploaded' });
      const filename = String(upload.filename || '');
      if (
        !filename.toLowerCase().endsWith('.xlsx') ||
        !XLSX_MIMES.has(upload.mimetype)
      ) {
        return reply
          .status(400)
          .send({ error: 'Only .xlsx workbooks are supported' });
      }
      const buffer = await upload.toBuffer();
      if (upload.file.truncated || buffer.length > MAX_WORKBOOK_SIZE) {
        return reply
          .status(413)
          .send({ error: 'Workbook exceeds the 10MB limit' });
      }
      if (!hasZipSignature(buffer)) {
        return reply
          .status(400)
          .send({ error: 'Workbook contents are not a valid XLSX file' });
      }
      try {
        return await service.preview(buffer);
      } catch (error) {
        request.log.warn({ err: error }, 'Workbook preview parsing failed');
        return reply
          .status(400)
          .send({ error: `Could not parse workbook: ${error.message}` });
      }
    }
  );
}
module.exports = routes;
module.exports.hasZipSignature = hasZipSignature;
