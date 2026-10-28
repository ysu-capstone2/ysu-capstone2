import { session, userData, fail, method, ApiError } from './_auth.js';
import { listQuery, listPage } from './_complaints.js';
export default async function handler(req, res) {
  try {
    method(req, res, ['GET']);
    const { user, token } = await session(req, res);
    const no = String(req.query?.no || '').trim();
    if (no.length > 100) throw new ApiError(400, '접수번호를 확인해 주세요.');
    const { page, size, params } = listQuery(req.query);
    params.set('user_id', `eq.${user.id}`);
    if (no) { params.set('complaint_no', `eq.${no}`); params.set('limit', '1'); params.delete('offset'); params.delete('or'); params.delete('process_status'); }
    const rows = await userData(token, `citizen_complaints?${params}`);
    const result = listPage(rows, page, size);
    const complaints = result.rows.map(item => ({ id: item.id, complaintNo: item.complaint_no, processStatus: item.process_status, officerName: item.officer_name || '담당자 배정 전', dueDate: item.due_date, result: item.result, createdAt: item.created_at, summary: item.summary, deptName: item.dept_name, consultType: item.consult_type, preferredAt: item.preferred_at, supplements: item.supplements || [] }));
    if (no && !complaints.length) throw new ApiError(404, '본인 명의의 접수 내역을 찾지 못했어요.');
    return res.status(200).json({ ok: true, ...(no ? { complaint: complaints[0] } : { complaints, pagination: result.pagination }) });
  } catch (error) { return fail(res, error); }
}
