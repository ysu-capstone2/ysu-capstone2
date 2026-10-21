import { session, userData, fail, method, ApiError } from './_auth.js';
export default async function handler(req, res) {
  try {
    method(req, res, ['GET']);
    const { user, token } = await session(req, res);
    const no = String(req.query?.no || '').trim();
    if (no.length > 100) throw new ApiError(400, '접수번호를 확인해 주세요.');
    const rows = await userData(token, `citizen_complaints?user_id=eq.${encodeURIComponent(user.id)}${no ? `&complaint_no=eq.${encodeURIComponent(no)}` : ''}&order=created_at.desc&limit=100`);
    const complaints = rows.map(item => ({ complaintNo: item.complaint_no, processStatus: item.process_status, officerName: item.officer_name || '담당자 배정 전', dueDate: item.due_date, result: item.result, createdAt: item.created_at, summary: item.summary, deptName: item.dept_name, consultType: item.consult_type }));
    if (no && !complaints.length) throw new ApiError(404, '본인 명의의 접수 내역을 찾지 못했어요.');
    return res.status(200).json({ ok: true, ...(no ? { complaint: complaints[0] } : { complaints }) });
  } catch (error) { return fail(res, error); }
}
