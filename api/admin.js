import { adminSession, userData, jsonBody, fail, method, ApiError } from './_auth.js';
export default async function handler(req, res) {
  try {
    method(req, res, ['PATCH']);
    const body = await jsonBody(req);
    const { token } = await adminSession(req, res);
    if (typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.id) || !['접수', '처리중', '완료', '보완요청'].includes(body.status)) throw new ApiError(400, '접수 건과 처리 상태를 확인해 주세요.');
    const result = String(body.result || '').trim(), officer = String(body.officer || '').trim();
    if (result.length > 2000 || officer.length > 50) throw new ApiError(400, '담당자 또는 안내 내용이 너무 깁니다.');
    const rows = await userData(token, `citizen_complaints?id=eq.${encodeURIComponent(body.id)}`, { method: 'PATCH', body: JSON.stringify({ process_status: body.status, result, officer_name: officer, updated_at: new Date().toISOString() }) });
    if (!rows.length) throw new ApiError(404, '접수 건을 찾지 못했습니다.');
    return res.status(200).json({ ok: true });
  } catch (error) { return fail(res, error); }
}
