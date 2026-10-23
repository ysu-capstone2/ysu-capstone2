import { randomUUID } from 'node:crypto';
import { session, userData, jsonBody, fail, method, ApiError } from './_auth.js';
const departments = { D01: '종합민원과', D02: '세무1과', D03: '건축과', D04: '행복1동 주민센터', D05: '행복2동 주민센터' };
const deptPhones = { D01: '031-120-0001', D02: '031-120-0002', D03: '031-120-0003', D04: '031-120-0004', D05: '031-120-0005' };
export default async function handler(req, res) {
  try {
    method(req, res, ['POST']);
    const body = await jsonBody(req);
    const { user, token } = await session(req, res);
    const citizenName = String(body.citizenName || '').trim(), citizenTel = String(body.citizenTel || '').trim();
    const rawSummary = String(body.summary || '').trim();
    const desiredDatetime = String(body.desiredDatetime || '').trim();
    const aiSummary = String(body.aiSummary || '').trim();
    if (desiredDatetime.length > 80 || aiSummary.length > 500) throw new ApiError(400, '희망 일시 또는 요약 내용을 확인해 주세요.');
    const prefix = desiredDatetime && !rawSummary.includes('[희망일시:') ? `[희망일시: ${desiredDatetime}] ` : '';
    const suffix = aiSummary && !rawSummary.includes(aiSummary) ? `\n${aiSummary}` : '';
    const summary = `${prefix}${rawSummary}${suffix}`.trim();
    if (!citizenName || citizenName.length > 50 || !/^[0-9+() -]{8,30}$/.test(citizenTel) || !rawSummary || summary.length > 2000 || !departments[body.deptCode] || !['전화상담', '방문상담', '채팅상담'].includes(body.consultType)) throw new ApiError(400, '이름, 연락처, 상담 내용과 부서를 확인해 주세요.');
    const suppliedId = body.requestId ?? randomUUID();
    if (typeof suppliedId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(suppliedId)) throw new ApiError(400, '접수 요청 번호를 확인해 주세요.');
    const requestId=suppliedId.toLowerCase();
    const payload = { user_id: user.id, request_id: requestId, citizen_name: citizenName, citizen_tel: citizenTel, dept_name: departments[body.deptCode], consult_type: body.consultType, summary };
    let [row] = await userData(token, 'citizen_complaints?on_conflict=user_id,request_id', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(payload),
    });
    const replayed = !row;
    if (replayed) {
      [row] = await userData(token, `citizen_complaints?user_id=eq.${encodeURIComponent(user.id)}&request_id=eq.${encodeURIComponent(requestId)}&limit=1`);
      if (row && Object.entries(payload).some(([key,value]) => row[key] !== value)) throw new ApiError(409, '이미 처리한 요청과 내용이 달라요. 예약 창을 다시 열어 접수해 주세요.');
    }
    if (!row) throw new ApiError(503, '접수 결과를 확인하지 못했습니다. 마이페이지를 확인해 주세요.');
    return res.status(replayed ? 200 : 201).json({ ok: true, replayed, complaintNo: row.complaint_no, reservationId: row.id, deptName: row.dept_name, deptTel: deptPhones[body.deptCode] || '031-120-0001', consultType: row.consult_type, desiredDatetime, citizenName, citizenTel, dueDate: row.due_date || null, message: '시연 서비스에 접수되었습니다. 마이페이지에서 확인해 주세요.' });
  } catch (error) { return fail(res, error); }
}
