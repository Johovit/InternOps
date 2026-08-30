'use strict';

const app = require('../../src/app');
const { generateAccessToken } = require('../../src/utils/tokens');

describe('Attendance Bulk API', () => {
  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  test('POST /attendance/bulk rejects more than 200 entries', async () => {
    const entries = Array.from({ length: 201 }, () => ({
      user_id: '00000000-0000-0000-0000-000000000001',
      date: '2026-08-30',
      status: 'PRESENT',
    }));

    const token = generateAccessToken({
      id: '00000000-0000-0000-0000-000000000002',
      role: 'CAPTAIN',
      department_id: '00000000-0000-0000-0000-000000000003',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/attendance/bulk',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: { entries },
    });

    expect(res.statusCode).toBe(400);
  });
});
