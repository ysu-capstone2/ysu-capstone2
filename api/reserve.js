import { supabaseRequest } from './_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: '지원하지 않는 메서드입니다.' });
  }

  const {
    sessionId,
    deptCode = 'D01',
    citizenName = '민원인',
    citizenTel,
    consultType = '전화상담',
    desiredDatetime,
    summary = '민원 상담 사전 접수',
  } = req.body || {};

  if (!citizenTel) {
    return res.status(400).json({ ok: false, message: '연락처(전화번호)를 입력해 주세요.' });
  }

  try {
    // 1. 상담예약및이관이력(transfer_reservation) 생성
    const reservationRes = await supabaseRequest('transfer_reservation', {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId ? parseInt(sessionId, 10) : null,
        dept_code: deptCode,
        citizen_name: citizenName,
        citizen_tel: citizenTel,
        consult_type: consultType,
        desired_datetime: desiredDatetime ? new Date(desiredDatetime).toISOString() : new Date().toISOString(),
        summary: summary,
        status: '접수대기',
      }),
    });

    const reservation = reservationRes && reservationRes[0] ? reservationRes[0] : null;
    const reservationId = reservation ? reservation.id : Date.now();

    // 2. 접수번호 채번 (예: YSU-20261014-XXXX)
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const complaintNo = `YSU-${todayStr}-${randSuffix}`;

    // 3. 민원처리대장(complaint_ledger) 생성 (법정 처리기한 7일)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 7);

    await supabaseRequest('complaint_ledger', {
      method: 'POST',
      body: JSON.stringify({
        complaint_no: complaintNo,
        reservation_id: reservationId,
        officer_name: '담당자 배정중',
        process_status: '접수',
        due_date: dueDate.toISOString().slice(0, 10),
        result: '민원 접수 완료. 소관 부서 검토 대기 중입니다.',
      }),
    });

    // 4. 모의 알림톡 발송 기록 (notification_log)
    await supabaseRequest('notification_log', {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId ? parseInt(sessionId, 10) : null,
        recipient_tel: citizenTel,
        notif_type: '민원접수완료알림',
        channel: 'ALIMTALK',
        is_success: 'Y',
      }),
    });

    // 5. 부서 정보 조회
    const deptInfo = await supabaseRequest(`department_info?dept_code=eq.${deptCode}`);
    const dept = deptInfo && deptInfo[0] ? deptInfo[0] : { dept_name: '종합민원과', tel: '031-120-0001' };

    return res.status(200).json({
      ok: true,
      complaintNo,
      reservationId,
      deptName: dept.dept_name,
      deptTel: dept.tel,
      consultType,
      citizenName,
      citizenTel,
      message: `상담 예약 및 민원 사전 접수가 완료되었습니다.\n[접수번호: ${complaintNo}]`,
    });
  } catch (error) {
    console.error('Reservation API Error:', error);
    return res.status(500).json({ ok: false, message: '상담 예약 처리 중 오류가 발생했습니다.' });
  }
}
