import { session, userData, jsonBody, fail, method, ApiError } from './_auth.js';
import { supabaseRequest } from './_supabase.js';
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
      if (body.action === 'cancel') {
        if (current.process_status !== '접수') throw new ApiError(409, '이미 담당자가 처리 중인 민원은 취소할 수 없어요.');
        await supabaseRequest(`citizen_complaints?id=eq.${encodeURIComponent(current.id)}&user_id=eq.${encodeURIComponent(user.id)}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true, message: '상담 예약 및 민원 접수를 취소했어요.' });
      }
      if (body.action === 'supplement') {
        if (!['보완요청', '접수', '처리중'].includes(current.process_status)) throw new ApiError(409, '완료된 민원에는 보완 자료를 등록할 수 없어요.');
        const supplement = String(body.supplement || '').trim();
        if (!supplement || supplement.length > 800) throw new ApiError(400, '보완할 내용을 800자 이내로 입력해 주세요.');
        const nextSummary = `${current.summary}\n[민원인 보완제출] ${supplement}`.slice(0, 2000);
        await supabaseRequest(`citizen_complaints?id=eq.${encodeURIComponent(current.id)}&user_id=eq.${encodeURIComponent(user.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ summary: nextSummary, process_status: '처리중', result: '민원인이 추가 설명·보완 자료를 제출하여 담당자가 사실관계를 재검토하고 있습니다.', updated_at: new Date().toISOString() }),
        });
        return res.status(200).json({ ok: true, message: '보완 내용을 등록했어요. 담당자가 확인 후 안내해 드립니다.' });
      }
      if (body.action === 'edit') {
        if (current.process_status !== '접수') throw new ApiError(409, '접수 대기 상태인 민원만 내용과 일정을 수정할 수 있어요.');
        const summary = String(body.summary || '').trim();
        const consultType = body.consultType || current.consult_type;
        const citizenTel = body.citizenTel ? String(body.citizenTel).trim() : current.citizen_tel;
        if (!summary || summary.length > 2000 || !['전화상담', '방문상담', '채팅상담'].includes(consultType) || !/^[0-9+() -]{8,30}$/.test(citizenTel)) {
          throw new ApiError(400, '수정할 상담 내용, 상담 방식, 연락처를 확인해 주세요.');
        }
        await supabaseRequest(`citizen_complaints?id=eq.${encodeURIComponent(current.id)}&user_id=eq.${encodeURIComponent(user.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ summary, consult_type: consultType, citizen_tel: citizenTel, updated_at: new Date().toISOString() }),
        });
        return res.status(200).json({ ok: true, message: '민원 내용 및 예약 정보를 수정했어요.' });
      }
      throw new ApiError(400, '요청 동작을 확인해 주세요.');
    }
    const no = String(req.query?.no || '').trim();
    if (no.length > 100) throw new ApiError(400, '접수번호를 확인해 주세요.');
    const rows = await userData(token, `citizen_complaints?user_id=eq.${encodeURIComponent(user.id)}${no ? `&complaint_no=eq.${encodeURIComponent(no)}` : ''}&order=created_at.desc&limit=100`);
    const today = new Date().toISOString().slice(0, 10);
    const complaints = rows.map(item => ({
      id: item.id, complaintNo: item.complaint_no, processStatus: item.process_status,
      officerName: item.officer_name || '담당자 배정 전', dueDate: item.due_date,
      isOverdue: Boolean(item.due_date && item.due_date < today && item.process_status !== '완료'),
      result: item.result, createdAt: item.created_at, updatedAt: item.updated_at,
      summary: item.summary, deptName: item.dept_name, consultType: item.consult_type, citizenTel: item.citizen_tel,
    }));
    if (no && !complaints.length) throw new ApiError(404, '본인 명의의 접수 내역을 찾지 못했어요.');
    return res.status(200).json({ ok: true, ...(no ? { complaint: complaints[0] } : { complaints }) });
  } catch (error) { return fail(res, error); }
}
