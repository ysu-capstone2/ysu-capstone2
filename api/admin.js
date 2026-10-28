import { adminSession, userData, jsonBody, fail, method, ApiError } from './_auth.js';
import { supabaseRequest } from './_supabase.js';
export default async function handler(req, res) {
  try {
    method(req, res, ['GET', 'POST', 'PATCH']);
    if (req.method === 'GET') {
      await adminSession(req, res);
      let knowledges = [];
      try { knowledges = await supabaseRequest('admin_knowledge?order=id.desc&limit=50'); } catch { knowledges = []; }
      return res.status(200).json({ ok: true, knowledges });
    }
    const body = await jsonBody(req);
    const { token } = await adminSession(req, res);
    if (req.method === 'POST' && body.action === 'knowledge') {
      const title = String(body.title || '').trim();
      const content = String(body.content || '').trim();
      const categoryCode = String(body.categoryCode || '일반행정').trim();
      const requiredDocs = String(body.requiredDocs || '').trim();
      const fee = String(body.fee || '').trim();
      const keywords = String(body.keywords || '').split(',').map(k => k.trim()).filter(Boolean);
      if (!title || title.length > 120 || !content || content.length > 2000 || categoryCode.length > 50 || requiredDocs.length > 500 || fee.length > 200) {
        throw new ApiError(400, '지식베이스 제목, 분류, 안내 본문을 확인해 주세요.');
      }
      const payload = { category_code: categoryCode, title, content, required_docs: requiredDocs, fee, keywords };
      if (body.knowledgeId && Number.isInteger(Number(body.knowledgeId))) {
        await supabaseRequest(`admin_knowledge?id=eq.${Number(body.knowledgeId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await supabaseRequest('admin_knowledge', { method: 'POST', body: JSON.stringify(payload) });
      }
      return res.status(200).json({ ok: true, message: '행정지식베이스가 승인 및 반영되었습니다.' });
    }
    if (typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.id) || !['접수', '처리중', '완료', '보완요청'].includes(body.status)) throw new ApiError(400, '접수 건과 처리 상태를 확인해 주세요.');
    const rawResult = String(body.result || '').trim(), officer = String(body.officer || '').trim();
    const reviewMemo = String(body.reviewMemo || '').trim();
    const dueDate = String(body.dueDate || '').trim();
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new ApiError(400, '처리 예정일 형식을 확인해 주세요.');
    const result = reviewMemo && !rawResult.includes('[사전검토메모:') ? `[사전검토메모: ${reviewMemo}]\n${rawResult}`.trim() : rawResult;
    if (result.length > 2000 || officer.length > 50) throw new ApiError(400, '담당자 또는 안내 내용이 너무 깁니다.');
    const params = new URLSearchParams({ id: `eq.${body.id}`, process_status: 'neq.취소' });
    if (body.updatedAt) {
      if (typeof body.updatedAt !== 'string' || !Number.isFinite(Date.parse(body.updatedAt))) throw new ApiError(400, '접수 변경 시각을 확인해 주세요.');
      params.set('updated_at', `eq.${body.updatedAt}`);
    }
    const rows = await userData(token, `citizen_complaints?${params}`, { method: 'PATCH', body: JSON.stringify({ process_status: body.status, result, officer_name: officer, updated_at: new Date().toISOString(), ...(Object.hasOwn(body,'dueDate')?{due_date:dueDate || null}:{}) }) });
    if (!rows.length) throw new ApiError(409, '접수가 변경되었거나 취소됐어요. 새로고침 후 다시 확인해 주세요.');
    return res.status(200).json({ ok: true });
  } catch (error) { return fail(res, error); }
}
