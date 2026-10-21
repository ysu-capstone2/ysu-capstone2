import { supabaseRequest } from './_supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: '지원하지 않는 메서드입니다.' });
  }

  const { no, tel } = req.query || {};

  if (!no && !tel) {
    return res.status(400).json({ ok: false, message: '접수번호 또는 연락처를 입력해 주세요.' });
  }

  try {
    let filter = '';
    if (no) {
      filter = `complaint_no=eq.${encodeURIComponent(no.trim())}`;
    }

    const ledgers = await supabaseRequest(`complaint_ledger?${filter}&limit=5`);

    if (!ledgers || ledgers.length === 0) {
      return res.status(404).json({
        ok: false,
        message: '조회된 민원 내역이 없습니다. 접수번호를 다시 확인해 주세요.',
      });
    }

    const item = ledgers[0];

    return res.status(200).json({
      ok: true,
      complaint: {
        complaintNo: item.complaint_no,
        processStatus: item.process_status,
        officerName: item.officer_name || '민원조사관',
        dueDate: item.due_date,
        result: item.result || '조사 및 검토가 정상 진행 중입니다.',
        createdAt: item.created_at,
      },
    });
  } catch (error) {
    console.error('Lookup API Error:', error);
    return res.status(500).json({ ok: false, message: '민원 조회 중 오류가 발생했습니다.' });
  }
}
