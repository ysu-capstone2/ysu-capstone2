import { config, session, adminSession, userData, jsonBody, fail, method, ApiError } from './_auth.js';
import { supabaseRequest } from './_supabase.js';
import { requestKey } from './_complaints.js';
export function createCounterHandler({ request = supabaseRequest } = {}) {
 return async function handler(req, res) {
  try {
    method(req, res, ['GET', 'POST', 'PATCH']);
    if (req.method === 'GET') {
      const { url, key } = config();
      const response = await fetch(`${url}/rest/v1/service_counters?order=counter_name.asc`, { headers: { apikey: key }, signal: AbortSignal.timeout(9000) });
      if (!response.ok) throw new ApiError(503, '창구 정보를 불러오지 못했어요.');
      const rows = await response.json();
      const counters = rows.map(c => ({ id:c.id, orgName:c.org_name, counterName:c.counter_name, deptName:'', location:c.location, currentCallingNo:c.current_calling_no, waitingCount:c.waiting_count, isCrowded:c.waiting_count>=10, isOpen:c.is_open, updatedAt:c.updated_at }));
      let tickets = [];
      if (req.query?.mine === '1') {
        const current = await session(req, res);
        tickets = await userData(current.token, `queue_tickets?user_id=eq.${encodeURIComponent(current.user.id)}&status=in.(대기,호출)&order=created_at.desc`);
      }
      return res.status(200).json({ ok:true, counters, tickets, source:'이 서비스의 번호표 발급·호출 기록', recommended:counters.filter(c=>c.isOpen&&c.waitingCount<=3).slice(0,2) });
    }
    const body = await jsonBody(req);
    if (req.method === 'POST' && body.action === 'ticket') {
      const current = await session(req,res);
      if (!/^[a-f0-9-]{36}$/.test(body.counterId || '')) throw new ApiError(400,'창구를 선택해 주세요.');
      const counters = await request(`service_counters?id=eq.${body.counterId}&is_open=eq.true&select=id`);
      if (!counters.length) throw new ApiError(409,'운영 중인 창구가 아닙니다.');
      const ticket = await request('rpc/portal_join_queue',{method:'POST',body:JSON.stringify({p_counter:body.counterId,p_user:current.user.id})});
      return res.status(200).json({ok:true,ticket});
    }
    if (req.method === 'POST' && body.action === 'cancel') {
      const current = await session(req,res);
      if (typeof body.ticketId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.ticketId)) throw new ApiError(400,'번호표를 확인해 주세요.');
      const rows = await userData(current.token, `queue_tickets?id=eq.${body.ticketId}&user_id=eq.${encodeURIComponent(current.user.id)}&select=id,status`);
      if (!rows.length) throw new ApiError(404,'본인 명의의 번호표를 찾지 못했어요.');
      const result = await request('rpc/portal_cancel_ticket',{method:'POST',body:JSON.stringify({p_ticket:body.ticketId,p_user:current.user.id})});
      if (!result.cancelled) throw new ApiError(result.reason === 'not_found' ? 404 : 409,'이미 호출되었거나 종료된 번호표는 취소할 수 없어요.');
      return res.status(200).json({ok:true});
    }
    const administrator = await adminSession(req,res);
    if (req.method === 'POST' && body.action === 'create') {
      const org = String(body.orgName || '').trim(), name = String(body.counterName || '').trim(), location = String(body.location || '').trim();
      if (!org || org.length>80 || !name || name.length>80 || !location || location.length>100) throw new ApiError(400,'기관명, 창구명, 위치를 확인해 주세요.');
      await request('service_counters',{method:'POST',body:JSON.stringify({org_name:org,counter_name:name,location})});
    } else if (/^[a-f0-9-]{36}$/.test(body.counterId || '') && body.action === 'next') {
      const requestId = requestKey(body.requestId, { required: true });
      if (typeof body.updatedAt !== 'string' || !Number.isFinite(Date.parse(body.updatedAt))) throw new ApiError(400,'최신 창구 현황을 확인한 뒤 호출해 주세요.');
      const result = await request('rpc/portal_call_next_once',{method:'POST',body:JSON.stringify({p_counter:body.counterId,p_actor:administrator.user.id,p_request:requestId,p_expected:body.updatedAt})});
      if (!result.ok) throw new ApiError(409,result.reason === 'counter_closed' ? '운영 중인 창구가 아닙니다.' : '창구 현황이 변경됐어요. 최신 번호를 확인한 뒤 다시 호출해 주세요.');
      return res.status(200).json({ok:true,replayed:Boolean(result.replayed)});
    } else if (/^[a-f0-9-]{36}$/.test(body.counterId || '') && body.action === 'toggle' && typeof body.isOpen === 'boolean') {
      await request(`service_counters?id=eq.${body.counterId}`,{method:'PATCH',body:JSON.stringify({is_open:body.isOpen,updated_at:new Date().toISOString()})});
    } else throw new ApiError(400,'창구 요청을 확인해 주세요.');
    return res.status(200).json({ok:true});
  } catch (error) { return fail(res,error); }
}

}
export default createCounterHandler();
