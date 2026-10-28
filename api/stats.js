import { adminSession, userData, fail, method } from './_auth.js';
import { listQuery, listPage } from './_complaints.js';
function buildAnalytics(complaints = [], sessions = []) {
  const safeComplaints = Array.isArray(complaints) ? complaints : [];
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const selfResolvedCount = safeSessions.filter(s => s.status === '자체완결').length;
  const transferredCount = safeSessions.length - selfResolvedCount;
  const selfResolveRate = safeSessions.length ? Number(((selfResolvedCount / safeSessions.length) * 100).toFixed(1)) : 0;
  const scored = safeSessions.filter(s => s.confidence_score != null && Number(s.confidence_score) > 0);
  const avgConfidence = scored.length ? Number((scored.reduce((a, b) => a + Number(b.confidence_score), 0) / scored.length).toFixed(1)) : 0;

  const nightHolidayCount = safeSessions.filter(s => {
    if (!s.created_at) return false;
    const d = new Date(new Date(s.created_at).getTime() + 9 * 3600000);
    const day = d.getUTCDay(), hour = d.getUTCHours();
    return day === 0 || day === 6 || hour < 9 || hour >= 18;
  }).length;

  const lowConfidenceSessions = safeSessions.filter(s => s.status !== '자체완결' || (s.confidence_score != null && Number(s.confidence_score) > 0 && Number(s.confidence_score) < 65));
  const stopWords = new Set(['민원', '문의', '질문', '안내', '방법', '어떻게', '어디서', '알려주세요', '궁금합니다', '하고', '싶어요', '있나요', '대한', '관련']);
  const keywordMap = new Map();
  for (const s of lowConfidenceSessions) {
    const tokens = String(s.query || '').match(/[가-힣]{2,}/g) || [];
    for (const token of new Set(tokens)) {
      if (stopWords.has(token)) continue;
      const entry = keywordMap.get(token) || { keyword: token, count: 0, sampleQuery: s.query };
      entry.count++;
      keywordMap.set(token, entry);
    }
  }
  const lowConfidenceClusters = [...keywordMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map(item => ({ ...item, needsKnowledgeUpdate: item.count >= 2 }));

  const byDepartment = {};
  const byConsultType = {};
  const byDateMap = new Map();
  const today = new Date().toISOString().slice(0, 10);
  let overdueCount = 0;

  for (const c of safeComplaints) {
    const dept = c.dept_name || '미분류';
    byDepartment[dept] = (byDepartment[dept] || 0) + 1;
    const cType = c.consult_type || '기타';
    byConsultType[cType] = (byConsultType[cType] || 0) + 1;
    const day = String(c.created_at || '').slice(0, 10);
    if (day) byDateMap.set(day, (byDateMap.get(day) || 0) + 1);
    if (c.due_date && c.due_date < today && !['완료','취소'].includes(c.process_status)) overdueCount++;
  }

  const byDate = [...byDateMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-7).map(([date, count]) => ({ date, count }));
  const surgeDetected = byDate.length >= 2 && byDate.at(-1).count >= Math.max(3, byDate.at(-2).count * 2);

  return {
    selfResolvedCount,
    transferredCount,
    selfResolveRate,
    avgConfidence,
    nightHolidayCount,
    lowConfidenceClusters,
    byDepartment,
    byConsultType,
    byDate,
    surgeDetected,
    overdueCount,
  };
}

export default async function handler(req, res) {
  try {
    method(req, res, ['GET']);
    const { token } = await adminSession(req, res);
    const { page, size, params } = listQuery(req.query, { admin: true });
    const [summary, complaints, recentSessions, analyticsComplaints] = await Promise.all([
      userData(token, 'rpc/portal_summary', { method: 'POST', body: '{}' }),
      userData(token, `citizen_complaints?${params}`),
      userData(token, 'chat_session?select=id,query,answer,status,created_at,channel,confidence_score,knowledge_id&order=id.desc&limit=50'),
      userData(token, 'citizen_complaints?order=created_at.desc,id.desc&limit=100'),
    ]);
    const result = listPage(complaints, page, size);
    return res.status(200).json({ ok: true, summary, complaints: result.rows, pagination: result.pagination, recentSessions, analytics:buildAnalytics(analyticsComplaints,recentSessions) });
  } catch (error) { return fail(res, error); }
}
