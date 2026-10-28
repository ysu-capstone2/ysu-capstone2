import { createHash } from 'node:crypto';
import { faqs, findFaq, normalizeQuestion, FAQ_VERSION } from '../data/faq.js';
import { ChatError } from './chat-error.js';
import { geminiBudget } from './gemini-budget.js';
import { supabaseRequest } from '../api/_supabase.js';
import { getGeminiApiKey, getGeminiModel, generateCivilResponseWithGemini } from '../api/_gemini.js';

const privateInput = (text) => /\d{6}\s*-?\s*[1-4]\d{6}|01[016789][-\s]?\d{3,4}[-\s]?\d{4}|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\d{8,}/iu.test(text);
const hash = (value) => createHash('sha256').update(value).digest('hex');

export function createPortalChatService({
  request = supabaseRequest, generate = generateCivilResponseWithGemini,
  getKey = getGeminiApiKey, getModel = getGeminiModel,
  budget = geminiBudget, now = Date.now, ttlMs = 30 * 60000,
} = {}) {
  const cache = new Map();
  const pending = new Map();
  const base = { isTransferred: false, category: '전국 공통 안내', requiredDocs: '', fee: '', suggestedAction: '세부 절차는 공식 확인 창구에서 확인해 주세요.' };
  const defaultSlots = ['익일 오전 (09:00~11:00)', '익일 오후 (14:00~16:00)', '모레 오전 (10:00~12:00)', '모레 오후 (15:00~17:00)'];
  function buildAiSummary(message, category = '일반행정', reason = '근거 법령 확인 및 담당자 유권해석 필요') {
    const clean = String(message || '').trim().slice(0, 200);
    return `[상담 내용 요약] 핵심 질의: "${clean}" | 분류: ${category} | 이관 사유: ${reason}`;
  }
  async function transfer(extra = {}) {
    const departments = await request('department_info?select=*&limit=5');
    const transferReason = extra.transferReason || '저확신·복합 질의 (신뢰도 기준치 65점 미달)';
    return {
      ...base, isTransferred: true, confidenceScore: 0, title: '담당자 확인이 필요한 민원',
      answer: '확인된 지식만으로는 정확히 안내하기 어려워요. 민원 종류와 발생 지역을 정리해 담당 부서에 문의하거나 아래 상담 예약 기능을 이용해 주세요.',
      departments, consultTypes: [
        { type: '전화상담', desc: '담당 부서 전화상담' },
        { type: '방문상담', desc: '담당 부서 방문상담' },
        { type: '채팅상담', desc: '담당 부서 채팅상담' },
      ], consultSlots: defaultSlots, transferReason,
      aiSummary: extra.aiSummary || buildAiSummary(extra.userQuery, extra.category, transferReason),
      source: 'knowledge', savedCall: true, aiEngine: 'rule-rag-fallback', ...extra,
    };
  }
  async function answer({ message, sessionId }) {
    const faq = findFaq(message);
    if (faq) {
      return { ...base, title: faq.question, answer: faq.answer, confidenceScore: null, knowledgeId: null, sources: faq.sources, aiSummary: buildAiSummary(message, '자주 묻는 질문', '일반 상담 요청'), source: 'faq', savedCall: true, aiEngine: 'faq' };
    }
    const key = hash(JSON.stringify([sessionId, FAQ_VERSION, getModel(), message.normalize('NFC').trim().replace(/\s+/gu, ' ')]));
    const cacheable = !privateInput(message);
    const cached = cache.get(key);
    if (cacheable && cached?.expires > now()) return { ...cached.value, source: 'cache', savedCall: true };
    if (cached) cache.delete(key);
    if (cacheable && pending.has(key)) return { ...await pending.get(key), source: 'cache', savedCall: true };
    const task = (async () => {
      let knowledges;
      try { knowledges = await request('admin_knowledge?select=*'); }
      catch { throw new ChatError(503, '행정 지식베이스에 연결하지 못했어요. 공통 민원 신청 방법 등 자주 묻는 질문은 계속 사용할 수 있어요.'); }
      // A complete title match may be answered from the maintained knowledge base.
      // Keyword overlap alone is insufficient for skipping generation.
      const exact = knowledges.find((item) => item.title?.trim() && normalizeQuestion(item.title) === normalizeQuestion(message));
      if (exact) return {
        ...base, title: exact.title, answer: exact.content, category: exact.category_code,
        requiredDocs: exact.required_docs || '', fee: exact.fee || '',
        lawClause: exact.law_clause || '', revisedAt: exact.revised_at || '', versionNo: exact.version_no || 'v1.0',
        knowledgeId: exact.id, aiSummary: buildAiSummary(message, exact.category_code, '정형 민원 안내 후 추가 상담'),
        confidenceScore: null, source: 'knowledge', savedCall: true, aiEngine: 'rule-rag-fallback',
      };
      if (!knowledges.length || !getKey()) return transfer({ userQuery:message, transferReason:'AI 엔진 미설정 또는 근거 자료 부족' });
      budget.reserve();
      let generated;
      try { generated = await generate(message, knowledges); }
      catch (error) {
        if (error.status === 429) { budget.block(); throw new ChatError(429, 'Gemini 사용 한도에 도달했어요. 잠시 후 다시 질문해 주세요.', 60); }
        throw new ChatError(502, 'AI 답변을 받지 못했어요. 잠시 후 다시 질문해 주세요.');
      }
      const validKnowledge = knowledges.find((item) => item.id === generated.matchedKnowledgeId);
      const isLow = generated.isTransferred || generated.confidenceScore < 65;
      const reason = isLow ? `신뢰도 점수(${generated.confidenceScore}점) 기준치 미달 · 복합/유권해석 민원` : '정형 민원 안내';
      const value = {
        ...base, ...generated, knowledgeId: validKnowledge?.id || null,
        requiredDocs: generated.requiredDocs || validKnowledge?.required_docs || '',
        fee: generated.fee || validKnowledge?.fee || '',
        lawClause: validKnowledge?.law_clause || '', revisedAt: validKnowledge?.revised_at || '', versionNo: validKnowledge?.version_no || 'v1.0',
        transferReason: reason,
        aiSummary: buildAiSummary(message, generated.category || validKnowledge?.category_code || '일반행정', reason),
        aiEngine: generated.model, source: 'gemini', savedCall: false,
      };
      const result = isLow ? await transfer({ ...value, userQuery: message, isTransferred: true }) : value;
      if (cacheable) {
        for (const [id, entry] of cache) if (entry.expires <= now()) cache.delete(id);
        if (cache.size >= 300) cache.delete(cache.keys().next().value);
        cache.set(key, { value: result, expires: now() + ttlMs });
      }
      return result;
    })();
    if (cacheable) pending.set(key, task);
    try { return await task; }
    finally { if (pending.get(key) === task) pending.delete(key); }
  }
  return { answer };
}
