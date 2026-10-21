import { session, userData, jsonBody, fail, method, ApiError } from './_auth.js';
const departments = { D01: '종합민원과', D02: '세무1과', D03: '건축과', D04: '행복1동 주민센터', D05: '행복2동 주민센터' };
export default async function handler(req, res) {
  try {
    method(req, res, ['POST']);
    const body = await jsonBody(req);
    const { user, token } = await session(req, res);
    const citizenName = String(body.citizenName || '').trim(), citizenTel = String(body.citizenTel || '').trim(), summary = String(body.summary || '').trim();
    if (!citizenName || citizenName.length > 50 || !/^[0-9+() -]{8,30}$/.test(citizenTel) || !summary || summary.length > 2000 || !departments[body.deptCode] || !['전화상담', '방문상담', '채팅상담'].includes(body.consultType)) throw new ApiError(400, '이름, 연락처, 상담 내용과 부서를 확인해 주세요.');
    const [row] = await userData(token, 'citizen_complaints', { method: 'POST', body: JSON.stringify({ user_id: user.id, citizen_name: citizenName, citizen_tel: citizenTel, dept_name: departments[body.deptCode], consult_type: body.consultType, summary }) });
    if (!row) throw new ApiError(503, '접수 결과를 확인하지 못했습니다. 마이페이지를 확인해 주세요.');
    return res.status(201).json({ ok: true, complaintNo: row.complaint_no, reservationId: row.id, deptName: row.dept_name, deptTel: '', consultType: row.consult_type, citizenName, citizenTel, message: '시연 서비스에 접수되었습니다. 마이페이지에서 확인해 주세요.' });
  } catch (error) { return fail(res, error); }
}
