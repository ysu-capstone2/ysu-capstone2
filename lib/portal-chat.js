import { createHash } from 'node:crypto';
import { findFaq, normalizeQuestion, FAQ_VERSION } from '../data/faq.js';
import { conversationReply, needsDetails, needsContext, wantsHuman, withoutGreeting } from './conversation.js';
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
  const cache = new Map(), pending = new Map();
  const base = { isTransferred:false, responseType:'answer', category:'전국 공통 안내', requiredDocs:'', fee:'', suggestedAction:'세부 절차는 공식 확인 창구에서 확인해 주세요.', sources:[] };
  function summary(message, history, reason) {
    const questions = [...history.filter(turn => turn.role === 'user').map(turn => turn.text), message]
      .filter(text => !conversationReply(text)).slice(-3).map(text => text.trim().slice(0,100));
    return `[상담 내용 요약] ${questions.join(' → ')} | 안내: ${reason}`.slice(0,500);
  }
  function guidance(message, history, type, reason) {
    const clarify = type === 'clarification';
    return { ...base, responseType:type, source:'system', aiEngine:'basic-guidance', savedCall:true, confidenceScore:null,
      title:clarify?'조금만 더 알려주세요':'안내 범위를 확인해 주세요',
      answer:clarify?'어떤 민원인지와 궁금한 점을 조금 더 알려주시겠어요? 지역에 따라 다른 내용이라면 시·군·구 정도의 지역도 함께 알려주세요. 주민등록번호나 연락처는 적지 않으셔도 돼요.'
        :'현재 이용 가능한 자료로는 이 질문의 세부 내용을 확정해서 안내하기 어려워요. 해당 민원의 정부24·국민신문고 공식 안내를 확인해 주세요. 원하시면 이 시연 서비스에서 담당자 상담을 요청할 수도 있어요.',
      suggestedAction:'', canReserve:!clarify, aiSummary:summary(message,history,reason),
      sources:clarify?[]:[{title:'정부24',url:'https://www.gov.kr/'},{title:'국민신문고',url:'https://www.epeople.go.kr/'}],
    };
  }
  async function transfer(message, history, reason) {
    let departments=[];
    try { departments=await request('department_info?select=*&limit=5'); } catch { /* The reservation form can still be opened. */ }
    return { ...base, isTransferred:true, responseType:'transfer', canReserve:true, source:'system', savedCall:true,
      title:'담당자 상담으로 이어갈 수 있어요', answer:'개별 상황은 담당자에게 확인해 보실 수 있어요. 아래에서 시연용 상담을 예약하면 질문 내용을 함께 전달합니다. 실제 행정기관에 접수되지는 않습니다.',
      confidenceScore:null, departments, consultTypes:[{type:'전화상담'},{type:'방문상담'},{type:'채팅상담'}],
      transferReason:reason, aiSummary:summary(message,history,reason), aiEngine:'basic-guidance',
    };
  }
  async function answer({ message, history = [], sessionId }) {
    const conversational=conversationReply(message);
    if (conversational) return {...base,...conversational,responseType:'conversation',source:'conversation',aiEngine:'basic-guidance',savedCall:true,confidenceScore:null,suggestedAction:'',aiSummary:''};
    const question=withoutGreeting(message);
    const faq=findFaq(question);
    if (faq) return {...base,title:faq.question,answer:faq.answer,confidenceScore:null,knowledgeId:null,sources:faq.sources,aiSummary:summary(message,history,'기본 민원 안내'),source:'faq',savedCall:true,aiEngine:'faq'};
    if (wantsHuman(question)) return transfer(message,history,'사용자가 담당자 상담을 요청함');
    if (needsContext(question) && !history.some(turn=>turn.role==='user' && !conversationReply(turn.text))) return guidance(message,history,'clarification','대화에서 질문의 대상을 확인하는 중');
    let knowledges;
    try { knowledges=await request('admin_knowledge?select=*&order=id.asc&limit=100'); }
    catch { throw new ChatError(503,'행정 지식베이스에 연결하지 못했어요. 자주 묻는 질문은 계속 사용할 수 있어요. 잠시 후 다시 시도해 주세요.'); }
    // A model-generated score or reference ID alone does not establish a verified answer.
    knowledges=knowledges.filter(item => item.approval_status==='승인완료' && typeof item.title==='string' && item.title.trim() && typeof item.content==='string' && item.content.trim());
    const knowledgeAnswer=(item,extra={})=>({...base,title:item.title,answer:item.content,category:item.category_code||'전국 공통 안내',requiredDocs:item.required_docs||'',fee:item.fee||'',lawClause:item.law_clause||'',revisedAt:item.revised_at||'',versionNo:item.version_no||'',knowledgeId:item.id,confidenceScore:null,source:'knowledge',savedCall:true,answerMode:'verified-knowledge',aiEngine:'basic-guidance',aiSummary:summary(message,history,'등록된 행정 지식 안내'),...extra});
    const exact=knowledges.find(item=>normalizeQuestion(item.title)===normalizeQuestion(question));
    if (exact) return knowledgeAnswer(exact);
    const qNorm=normalizeQuestion(question);
    if (qNorm && !/(?:취소|철회|정정|수정|삭제|보상|배상|분쟁|소송|일조권|아닌|않았|없는데|동시에)/u.test(question) && !/^(?:민원|민원상담|상담|도와줘|도와주세요|문의|질문|궁금해요|민원있어요|민원이있어요|민원있는데|여권|세금|복지|쓰레기|소음)$/u.test(qNorm)) {
      let best=null, bestScore=0;
      for (const item of knowledges) {
        if (!Array.isArray(item.keywords)) continue;
        const terms=[item.title, ...item.keywords].map(t=>normalizeQuestion(String(t||''))).filter(t=>t.length>=2);
        let score=0;
        for (const term of terms) {
          if (qNorm===term) score=Math.max(score, 100+term.length);
          else if (qNorm.includes(term)) score=Math.max(score, 50+term.length);
          else if (term.includes(qNorm) && qNorm.length>=3) score=Math.max(score, 30+qNorm.length);
        }
        if (score>bestScore) { bestScore=score; best=item; }
      }
      if (best) return knowledgeAnswer(best);
    }
    if (needsDetails(question)) return guidance(message,history,'clarification','질문을 구체화하는 중');
    if (!knowledges.length) return guidance(message,history,'unavailable','확인 가능한 승인 자료 부족');
    const corpus=knowledges;
    const key=hash(JSON.stringify([sessionId,FAQ_VERSION,getModel(),history,question,corpus]));
    const cacheable=!privateInput(JSON.stringify([message,history]));
    const cached=cache.get(key);
    if (cacheable && cached?.expires>now()) return {...cached.value,source:'cache',savedCall:true};
    if (cached) cache.delete(key);
    if (cacheable && pending.has(key)) return {...await pending.get(key),source:'cache',savedCall:true};
    if (!getKey()) return guidance(message,history,'unavailable','AI 추가 안내 미연결');
    const task=(async()=>{
      budget.reserve();
      let generated;
      try { generated=await generate(question,knowledges,history); }
      catch (error) {
        if(error.status===429){budget.block();throw new ChatError(429,'AI 요청이 잠시 제한됐어요. 잠시 후 다시 질문하거나 자주 묻는 질문을 이용해 주세요.',60);}
        throw new ChatError([400,401,403,404].includes(error.status)?503:502,'AI 답변을 확인하지 못했어요. 잠시 후 다시 시도해 주세요. 자주 묻는 질문은 계속 사용할 수 있어요.');
      }
      let result;
      if (generated.decision==='transfer') result=await transfer(message,history,'개별 상황에 대한 담당자 확인 요청');
      else if (generated.decision==='clarify' || generated.confidenceScore<65) result=guidance(message,history,'clarification','답변 전에 추가 확인 필요');
      else {
        const matched=knowledges.find(item=>item.id===generated.matchedKnowledgeId);
        result=matched?knowledgeAnswer(matched,{source:'gemini',savedCall:false,aiEngine:generated.model}):guidance(message,history,'unavailable','확인 가능한 근거와 답변이 연결되지 않음');
      }
      // Selection/classification used AI even when its unverified prose is withheld.
      result={...result,savedCall:false,aiEngine:generated.model};
      if(cacheable){
        for(const [id,entry] of cache)if(entry.expires<=now())cache.delete(id);
        if(cache.size>=300)cache.delete(cache.keys().next().value);
        cache.set(key,{value:result,expires:now()+ttlMs});
      }
      return result;
    })();
    if(cacheable)pending.set(key,task);
    try{return await task;}finally{if(pending.get(key)===task)pending.delete(key);}
  }
  return {answer};
}
