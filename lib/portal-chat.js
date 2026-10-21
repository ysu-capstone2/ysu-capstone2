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
  async function transfer(extra = {}) {
    const departments = await request('department_info?select=*&limit=5');
    return {
      ...base, isTransferred: true, confidenceScore: 0, title: '담당자 확인이 필요한 민원',
      answer: '확인된 지식만으로는 정확히 안내하기 어려워요. 민원 종류와 발생 지역을 정리해 담당 부서에 문의하거나 아래 상담 예약 기능을 이용해 주세요.',
      departments, consultTypes: [
        { type: '전화상담', desc: '담당 부서 전화상담' },
        { type: '방문상담', desc: '담당 부서 방문상담' },
        { type: '채팅상담', desc: '담당 부서 채팅상담' },
      ], source: 'knowledge', savedCall: true, aiEngine: 'rule-rag-fallback', ...extra,
    };
  }
  async function answer({ message, sessionId }) {
    const faq = findFaq(message);
    if (faq) return { ...base, title: faq.question, answer: faq.answer, confidenceScore: null, knowledgeId: null, sources: faq.sources, source: 'faq', savedCall: true, aiEngine: 'faq' };
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
        requiredDocs: exact.required_docs || '', fee: exact.fee || '', knowledgeId: exact.id,
        confidenceScore: null, source: 'knowledge', savedCall: true, aiEngine: 'rule-rag-fallback',
      };
      if (!getKey()) return transfer();
      budget.reserve();
      let generated;
      try { generated = await generate(message, knowledges); }
      catch (error) {
        if (error.status === 429) { budget.block(); throw new ChatError(429, 'Gemini 사용 한도에 도달했어요. 잠시 후 다시 질문해 주세요.', 60); }
        throw new ChatError(502, 'AI 답변을 받지 못했어요. 잠시 후 다시 질문해 주세요.');
      }
      const validKnowledge = knowledges.find((item) => item.id === generated.matchedKnowledgeId);
      const value = {
        ...base, ...generated, knowledgeId: validKnowledge?.id || null,
        requiredDocs: generated.requiredDocs || validKnowledge?.required_docs || '',
        fee: generated.fee || validKnowledge?.fee || '',
        aiEngine: generated.model, source: 'gemini', savedCall: false,
      };
      const result = generated.isTransferred || generated.confidenceScore < 65 ? await transfer({ ...value, isTransferred: true }) : value;
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
