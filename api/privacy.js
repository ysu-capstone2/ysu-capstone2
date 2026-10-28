import { session, adminSession, userData, jsonBody, method, fail, ApiError } from './_auth.js';
import { requestKey } from './_complaints.js';

// Requests are reviewed by the team. This endpoint never deletes an account or its data.
export default async function handler(req, res) {
  try {
    method(req, res, ['GET', 'POST', 'PATCH']);
    const { user, token } = await session(req, res);
    if (req.method === 'GET') {
      const params = new URLSearchParams({ order: 'created_at.desc,id.desc', limit: '50' });
      if (user.app_metadata?.role !== 'admin') params.set('user_id', `eq.${user.id}`);
      return res.status(200).json({ ok: true, requests: await userData(token, `privacy_requests?${params}`) });
    }
    const body = await jsonBody(req);
    if (req.method === 'POST') {
      if (!['access', 'delete'].includes(body.kind) || typeof body.message !== 'string' || body.message.trim().length > 1000) throw new ApiError(400, '요청 종류와 내용(1,000자 이내)을 확인해 주세요.');
      const payload = { user_id: user.id, request_id: requestKey(body.requestId, { required: true }), kind: body.kind, message: body.message.trim() };
      let [row] = await userData(token, 'privacy_requests?on_conflict=user_id,request_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(payload) });
      if (!row) {
        [row] = await userData(token, `privacy_requests?user_id=eq.${user.id}&request_id=eq.${payload.request_id}&limit=1`);
        if (!row || row.kind !== payload.kind || row.message !== payload.message) throw new ApiError(409, '이미 접수한 요청과 내용이 달라요. 내용을 확인해 주세요.');
      }
      return res.status(200).json({ ok: true, request: row });
    }
    await adminSession(req, res);
    const id = requestKey(body.id, { required: true });
    if (!['접수', '처리중', '완료'].includes(body.status) || typeof body.response !== 'string' || body.response.trim().length > 2000 || (body.status === '완료' && !body.response.trim())) throw new ApiError(400, '처리 상태와 안내 내용을 확인해 주세요. 완료 시 처리 결과를 입력해 주세요.');
    if (typeof body.updatedAt !== 'string' || !Number.isFinite(Date.parse(body.updatedAt))) throw new ApiError(400, '최신 요청 내역을 불러온 뒤 저장해 주세요.');
    const params = new URLSearchParams({ id: `eq.${id}`, updated_at: `eq.${body.updatedAt}` });
    const rows = await userData(token, `privacy_requests?${params}`, { method: 'PATCH', body: JSON.stringify({ status: body.status, response: body.response.trim(), updated_at: new Date().toISOString() }) });
    if (!rows.length) throw new ApiError(409, '요청 상태가 변경됐어요. 새로고침 후 확인해 주세요.');
    return res.status(200).json({ ok: true, request: rows[0] });
  } catch (error) { return fail(res, error); }
}
