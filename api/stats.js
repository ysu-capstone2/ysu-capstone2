import { adminSession, userData, fail, method } from './_auth.js';
export default async function handler(req, res) {
  try {
    method(req, res, ['GET']);
    const { token } = await adminSession(req, res);
    const [summary, complaints, recentSessions] = await Promise.all([
      userData(token, 'rpc/portal_summary', { method: 'POST', body: '{}' }),
      userData(token, 'citizen_complaints?order=created_at.desc&limit=100'),
      userData(token, 'chat_session?select=id,query,status,created_at,channel,confidence_score&order=id.desc&limit=20'),
    ]);
    return res.status(200).json({ ok: true, summary, complaints, recentSessions });
  } catch (error) { return fail(res, error); }
}
