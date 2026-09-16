const auth = require('../../middleware/auth');
const pool = require('../../config/db');
const { z } = require('zod');
const { toSchema } = require('../../utils/schemaHelper');
const repo = require('./repository');
const { encodeCursor, decodeCursor } = require('../../utils/keysetCursor');

// Whitelist of allowed filter keys → qualified column names.
// Prevents SQL injection if filter keys ever become user-controllable.
const AUDIT_COLUMN_MAP = {
  userId: 'al.user_id',
  resourceType: 'al.resource_type',
  action: 'al.action',
};

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().optional(),
  userId: z.string().uuid().optional(),
  resourceType: z.string().trim().max(100).optional(),
  action: z.string().trim().max(100).optional(),
  search: z.string().trim().max(200).optional(),
  startDate: z
    .string()
    .trim()
    .max(40)
    .optional()
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), {
      message: 'startDate must be a valid date',
    }),
  endDate: z
    .string()
    .trim()
    .max(40)
    .optional()
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), {
      message: 'endDate must be a valid date',
    }),
});

async function routes(fastify) {
  fastify.get(
    '/',
    {
      preHandler: [auth],
      schema: {
        tags: ['Audit'],
        description: 'Get audit logs using keyset pagination',
        querystring: toSchema(auditQuerySchema),
      },
    },
    async (req, reply) => {
      const parsed = auditQuerySchema.safeParse(req.query);

      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          details: parsed.error.issues,
        });
      }

      const {
        limit,
        cursor,
        userId,
        resourceType,
        action,
        search,
        startDate,
        endDate,
      } = parsed.data;

      const conditions = [];
      const params = [];

      if (req.user.role === 'ADMIN') {
        if (userId) {
          params.push(userId);
          conditions.push(`${AUDIT_COLUMN_MAP.userId} = $${params.length}`);
        }
      } else {
        params.push(req.user.id);
        conditions.push(`${AUDIT_COLUMN_MAP.userId} = $${params.length}`);
      }

      if (resourceType) {
        params.push(resourceType);
        conditions.push(`${AUDIT_COLUMN_MAP.resourceType} = $${params.length}`);
      }

      if (action) {
        params.push(`%${action}%`);
        conditions.push(`${AUDIT_COLUMN_MAP.action} ILIKE $${params.length}`);
      }

      if (search) {
        params.push(`%${search}%`);
        const searchIdx1 = params.length;

        params.push(`%${search}%`);
        const searchIdx2 = params.length;

        conditions.push(
          `(u.email ILIKE $${searchIdx1} OR u.full_name ILIKE $${searchIdx2})`
        );
      }

      if (startDate) {
        params.push(startDate);
        conditions.push(`al.created_at >= $${params.length}`);
      }

      if (endDate) {
        params.push(endDate);
        conditions.push(`al.created_at <= $${params.length}`);
      }

      if (cursor) {
        let decodedCursor;

        try {
          decodedCursor = decodeCursor(cursor);
        } catch (err) {
          return reply.status(err.statusCode || 400).send({
            error: err.message || 'Invalid cursor',
          });
        }

        if (
          typeof decodedCursor.id !== 'string' ||
          typeof decodedCursor.createdAt !== 'string' ||
          Number.isNaN(Date.parse(decodedCursor.createdAt))
        ) {
          return reply.status(400).send({
            error: 'Invalid cursor',
          });
        }

        params.push(decodedCursor.createdAt);
        const createdAtIndex = params.length;

        params.push(decodedCursor.id);
        const idIndex = params.length;

        conditions.push(
          `(al.created_at < $${createdAtIndex}
            OR (
              al.created_at = $${createdAtIndex}
              AND al.id < $${idIndex}
            ))`
        );
      }

      const whereClause = conditions.length
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      const queryParams = [...params, limit + 1];
      const limitIndex = queryParams.length;

      const logs = await pool.query(
        `
        SELECT
          al.*,
          u.full_name AS actor_name,
          u.email AS actor_email
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
        ${whereClause}
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT $${limitIndex}
        `,
        queryParams
      );

      const hasNextPage = logs.rows.length > limit;
      const rows = hasNextPage ? logs.rows.slice(0, limit) : logs.rows;

      const data = rows.map((row) => {
        if (req.user.role !== 'ADMIN' && row.user_id !== req.user.id) {
          const { ip_address, user_agent, ...rest } = row;

          return {
            ...rest,
            ip_address: null,
            user_agent: null,
          };
        }

        return row;
      });

      const lastRow = rows[rows.length - 1];

      const nextCursor =
        hasNextPage && lastRow
          ? encodeCursor({
              id: lastRow.id,
              createdAt: lastRow.created_at,
            })
          : null;

      return {
        data,
        limit,
        nextCursor,
      };
    }
  );
}

module.exports = routes;
