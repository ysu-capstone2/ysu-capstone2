import { session, jsonBody, fail, method, ApiError } from './_auth.js';
import { preferredTime, requestKey } from './_complaints.js';
import { supabaseRequest } from './_supabase.js';

export function createComplaintHandler({ request = supabaseRequest } = {}) {
  return async function handler(req, res) {
    try {
      method(req, res, ['PATCH']);
      const body = await jsonBody(req);
      const { user } = await session(req, res);
      if (user.app_metadata?.role === 'admin') throw new ApiError(403, '회원 본인의 접수에서 이용해 주세요.');
      if (typeof body.id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.id) || !['supplement', 'reschedule', 'cancel'].includes(body.action)) throw new ApiError(400, '접수 건과 요청을 확인해 주세요.');
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (body.action === 'supplement' && (!text || text.length > 2000)) throw new ApiError(400, '보완 내용을 1~2,000자로 입력해 주세요.');
      const requestId = requestKey(body.requestId);
      // The DB validates new schedules; a previously completed retry may now be in the past.
      const preferred = body.action === 'reschedule' ? preferredTime(body.preferredAt, { required: true, validateWindow: body.requestId === undefined }) : null;
      const result = await request('rpc/portal_member_complaint_once', { method: 'POST', body: JSON.stringify({ p_id: body.id, p_user: user.id, p_action: body.action, p_text: text, p_preferred: preferred, p_request: requestId }) });
      if (!result.ok) throw new ApiError(result.reason === 'not_found' ? 404 : 409, result.reason === 'not_found' ? '본인 명의의 접수를 찾지 못했어요.' : result.reason === 'request_conflict' ? '같은 요청 번호의 내용이 달라요. 접수 내역을 다시 확인해 주세요.' : '현재 처리 상태 또는 희망 일시에서는 요청할 수 없어요. 접수 내역을 새로 확인해 주세요.');
      return res.status(200).json({ ok: true, replayed: Boolean(result.replayed) });
    } catch (error) { return fail(res, error); }
  };
}
export default createComplaintHandler();
