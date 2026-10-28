import { adminSession, userData, fail, method } from './_auth.js';
import { listQuery, listPage } from './_complaints.js';
export default async function handler(req, res) {
  try {
    method(req, res, ['GET']);
    const { token } = await adminSession(req, res);
    const { page, size, params } = listQuery(req.query, { admin: true });
    const [summary, complaints, recentSessions] = await Promise.all([
      userData(token, 'rpc/portal_summary', { method: 'POST', body: '{}' }),
      userData(token, `citizen_complaints?${params}`),
      userData(token, 'chat_session?select=id,query,answer,status,created_at,channel,confidence_score&order=id.desc&limit=20'),
    ]);
    const result = listPage(complaints, page, size);
    return res.status(200).json({ ok: true, summary, complaints: result.rows, pagination: result.pagination, recentSessions });
  } catch (error) { return fail(res, error); }
}
