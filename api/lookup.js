import { session, userData, jsonBody, fail, method, ApiError } from './_auth.js';
import { listQuery, listPage } from './_complaints.js';
import { supabaseRequest } from './_supabase.js';
import complaintHandler from './complaints.js';
export default async function handler(req, res) {
  try {
    method(req, res, ['GET', 'PATCH']);
    const { user, token } = await session(req, res);
    if (req.method === 'PATCH') {
      const body = await jsonBody(req);
      if (typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.id)) throw new ApiError(400, '접수 번호를 확인해 주세요.');
      const rows = await userData(token, `citizen_complaints?id=eq.${encodeURIComponent(body.id)}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`);
      if (!rows.length) throw new ApiError(404, '본인 명의의 접수 내역을 찾지 못했어요.');
      const current = rows[0];
      if (['cancel','supplement'].includes(body.action)) {
        req.body={...body,text:body.text ?? body.supplement};
        req.portalSession={user,token};
        return complaintHandler(req,res);
      }
      if (body.action === 'edit') {
        if (current.process_status !== '접수') throw new ApiError(409, '접수 대기 상태인 민원만 내용과 일정을 수정할 수 있어요.');
        const summary = String(body.summary || '').trim();
        const consultType = body.consultType || current.consult_type;
        const citizenTel = body.citizenTel ? String(body.citizenTel).trim() : current.citizen_tel;
        if (!summary || summary.length > 2000 || !['전화상담', '방문상담', '채팅상담'].includes(consultType) || !/^[0-9+() -]{8,30}$/.test(citizenTel)) {
          throw new ApiError(400, '수정할 상담 내용, 상담 방식, 연락처를 확인해 주세요.');
        }
        const params=new URLSearchParams({id:`eq.${current.id}`,user_id:`eq.${user.id}`,process_status:'eq.접수'});
        if(current.updated_at)params.set('updated_at',`eq.${current.updated_at}`);
        const updated=await supabaseRequest(`citizen_complaints?${params}`, {
          method: 'PATCH',
          body: JSON.stringify({ summary, consult_type: consultType, citizen_tel: citizenTel, updated_at: new Date().toISOString() }),
        });
        if(!updated.length)throw new ApiError(409,'접수 상태가 변경됐어요. 새로 조회한 뒤 다시 수정해 주세요.');
        return res.status(200).json({ ok: true, message: '민원 내용 및 예약 정보를 수정했어요.' });
      }
      throw new ApiError(400, '요청 동작을 확인해 주세요.');
    }
    const no = String(req.query?.no || '').trim();
    if (no.length > 100) throw new ApiError(400, '접수번호를 확인해 주세요.');
    const { page, size, params } = listQuery(req.query);
    params.set('user_id', `eq.${user.id}`);
    if (no) { params.set('complaint_no', `eq.${no}`); params.set('limit', '1'); params.delete('offset'); params.delete('or'); params.delete('process_status'); }
    const rows = await userData(token, `citizen_complaints?${params}`);
    const result = listPage(rows, page, size);
    const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
    const complaints = result.rows.map(item => ({ id: item.id, updatedAt:item.updated_at, citizenTel:item.citizen_tel, isOverdue:Boolean(item.due_date && item.due_date<today && !['완료','취소'].includes(item.process_status)), complaintNo: item.complaint_no, processStatus: item.process_status, officerName: item.officer_name || '담당자 배정 전', dueDate: item.due_date, result: item.result, createdAt: item.created_at, summary: item.summary, deptName: item.dept_name, consultType: item.consult_type, preferredAt: item.preferred_at, supplements: item.supplements || [] }));
    if (no && !complaints.length) throw new ApiError(404, '본인 명의의 접수 내역을 찾지 못했어요.');
    return res.status(200).json({ ok: true, ...(no ? { complaint: complaints[0] } : { complaints, pagination: result.pagination }) });
  } catch (error) { return fail(res, error); }
}
