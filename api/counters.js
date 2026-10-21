import { supabaseRequest } from './_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: '지원하지 않는 메서드입니다.' });
  }

  try {
    const counters = await supabaseRequest('counter_status?select=*&order=id.asc');
    const depts = await supabaseRequest('department_info?select=*');

    const deptMap = {};
    for (const d of depts) {
      deptMap[d.dept_code] = d;
    }

    const merged = counters.map(c => {
      const dept = deptMap[c.dept_code] || {};
      return {
        id: c.id,
        deptCode: c.dept_code,
        orgName: dept.org_name || '행복구청',
        deptName: dept.dept_name || '종합창구',
        counterNo: c.counter_no,
        counterName: c.counter_name,
        location: dept.window_location || '본청',
        tel: dept.tel || '',
        currentCallingNo: c.current_calling_no,
        waitingCount: c.waiting_count,
        isCrowded: c.is_crowded === 'Y',
      };
    });

    // 인근 여유 창구 추천 (대기 인원이 3명 이하인 창구)
    const recommended = merged.filter(c => !c.isCrowded && c.waitingCount <= 3);

    return res.status(200).json({
      ok: true,
      counters: merged,
      recommended: recommended.slice(0, 2),
      updatedAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    });
  } catch (error) {
    console.error('Counters API Error:', error);
    return res.status(500).json({ ok: false, message: '창구 대기 현황 조회 중 오류가 발생했습니다.' });
  }
}
