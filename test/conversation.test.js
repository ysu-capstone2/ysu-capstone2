import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationReply } from '../lib/conversation.js';
import { createPortalChatService } from '../lib/portal-chat.js';
import { createChatService } from '../lib/chat-service.js';
import { createChatHandler } from '../api/chat.js';

const knowledge={id:1,title:'전입신고 안내',content:'검토된 전입신고 안내 본문',approval_status:'승인완료',required_docs:'등록된 구비서류',fee:'등록된 수수료'};
const selected={decision:'answer',matchedKnowledgeId:1,confidenceScore:90,model:'test',answer:'모델이 지어낸 금액 999999원',requiredDocs:'임의 서류',fee:'임의 금액'};
const input={message:'전입신고하는 방법이 궁금해요',sessionId:'browser-a'};
function portal(options={}){
 let calls=0;const invocations=[];
 return {invocations,service:createPortalChatService({getKey:()=>'',request:async()=>[knowledge],budget:{reserve(){},block(){}},...options,generate:async(...args)=>{calls++;invocations.push(args);return options.generate?options.generate(...args):{...selected};}}),calls:()=>calls};
}
test('greetings, thanks, farewell, acknowledgments and introductions bypass both AI engines and DB',async()=>{
 const texts=['안녕','안녕하세요!','안 녕 👋','ㅎㅇ','hello','고마워요','감사합니다!','고마워ㅎㅎ','안녕히 계세요','네','알겠습니다','너 누구야?'];
 const guide=createChatService({env:{},fetchImpl:()=>{throw new Error('unexpected provider');}});
 const {service}=portal({request:()=>{throw new Error('unexpected DB');}});
 for(const message of texts){
  const a=await service.answer({...input,message}),b=await guide.answer({...input,message});
  assert.equal(a.responseType,'conversation',message);assert.equal(a.isTransferred,false);assert.equal(a.source,'conversation');assert.equal(b.source,'conversation');
  assert.ok(!a.answer.includes('전문가'));assert.equal(a.requiredDocs,'');assert.equal(a.aiSummary,'');
 }
});
test('a greeting or thanks never swallows an accompanying substantive or conflicting request',async()=>{
 for(const text of ['안녕, 전입신고는 어떻게 해?','감사합니다 그리고 상담 예약 취소해줘','고마워요 근데 여권 서류는요','안녕하세요. 민원 처리 기간은요','안녕이라는 단어를 번역해줘'])assert.equal(conversationReply(text),null,text);
 const {service}=portal({request:()=>{throw new Error('unexpected DB');}});
 assert.equal((await service.answer({...input,message:'안녕하세요, 민원 신청 방법'})).source,'faq');
});
test('short incomplete topics ask for details and do not claim expert intervention',async()=>{
 const {service}=portal();
 for(const message of ['여권','민원','도와주세요']){const r=await service.answer({...input,message});assert.equal(r.responseType,'clarification');assert.equal(r.isTransferred,false);assert.match(r.answer,/조금 더/);}
});
test('a context-dependent question without a substantive prior topic is clarified before any lookup or AI call',async()=>{
 const p=portal({request:()=>{throw new Error('unexpected lookup');}});
 for(const message of ['그건 어떻게 하나요?','그럼 서류는요?','비용은요?']){
  const r=await p.service.answer({...input,message,history:[{role:'user',text:'안녕'},{role:'model',text:'안녕하세요!'}]});
  assert.equal(r.responseType,'clarification');assert.equal(p.calls(),0);
 }
});
test('users may explicitly choose a human even when the knowledge service is unavailable',async()=>{
 const {service}=portal({request:()=>{throw new Error('outage');}});
 const r=await service.answer({...input,message:'담당자 연결해주세요'});assert.equal(r.responseType,'transfer');assert.deepEqual(r.departments,[]);
});
test('low model confidence asks a follow-up; a missing source is not an expert referral',async()=>{
 for(const decision of ['clarify','answer']){
  const {service}=portal({getKey:()=> 'test',generate:async()=>({...selected,decision,confidenceScore:30})});
  const r=await service.answer(input);assert.equal(r.responseType,'clarification');assert.equal(r.isTransferred,false);assert.equal(r.requiredDocs,'');assert.ok(!r.answer.includes('999999'));
 }
 const {service}=portal({getKey:()=> 'test',generate:async()=>({...selected,matchedKnowledgeId:999})});
 const r=await service.answer(input);assert.equal(r.responseType,'unavailable');assert.equal(r.isTransferred,false);assert.equal(r.knowledgeId,undefined);
});
test('high scores never replace approved prose or metadata with unverified generated facts',async()=>{
 const {service}=portal({getKey:()=> 'test'});const r=await service.answer(input);
 assert.equal(r.answer,knowledge.content);assert.equal(r.requiredDocs,knowledge.required_docs);assert.equal(r.fee,knowledge.fee);assert.equal(r.answerMode,'verified-knowledge');assert.equal(r.title,knowledge.title);
});
test('pending or rejected knowledge is never used for exact answers or AI grounding',async()=>{
 for(const approval_status of ['검토대기','반려',undefined]){
  const p=portal({getKey:()=> 'test',request:async()=>[{...knowledge,approval_status}]});
  const r=await p.service.answer({...input,message:knowledge.title});assert.equal(r.responseType,'unavailable');assert.equal(p.calls(),0);
 }
});
test('knowledge changes and withdrawn approvals invalidate cached classifications immediately',async()=>{
 let current={...knowledge};const p=portal({getKey:()=> 'test',request:async()=>[current]});
 await p.service.answer(input);assert.equal((await p.service.answer(input)).source,'cache');
 current={...current,content:'개정된 안내'};assert.equal((await p.service.answer(input)).answer,'개정된 안내');assert.equal(p.calls(),2);
 current={...current,approval_status:'반려'};assert.equal((await p.service.answer(input)).responseType,'unavailable');assert.equal(p.calls(),2);
});
test('conversation context reaches Gemini, separates cached answers and is omitted from caching when private',async()=>{
 const history=[{role:'user',text:'안양시 전입신고 문의'},{role:'model',text:'어떤 점이 궁금하세요?'}];
 const p=portal({getKey:()=> 'test'});await p.service.answer({...input,message:'그럼 서류는요?',history});
 assert.deepEqual(p.invocations[0][2],history);
 await p.service.answer({...input,message:'그럼 서류는요?',history:[{role:'user',text:'여권 문의'},{role:'model',text:'어떤 점이 궁금하세요?'}]});assert.equal(p.calls(),2);
 const sensitive=[{role:'user',text:'연락처 010-1234-5678 문의'},{role:'model',text:'질문을 알려주세요.'}];
 await p.service.answer({...input,history:sensitive});await p.service.answer({...input,history:sensitive});assert.equal(p.calls(),4);
});
test('HTTP conversations are not logged as resolved complaints, and malformed history never reaches a model',async()=>{
 let writes=0;const p=portal({request:()=>{throw new Error('unexpected knowledge request');}});
 const handler=createChatHandler({service:p.service,request:async()=>{writes++;return [];}});
 const res=()=>({setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}});
 const req={method:'POST',headers:{'content-type':'application/json'},body:{query:'안녕'}};
 const greeting=res();await handler(req,greeting);assert.equal(greeting.code,200);assert.equal(greeting.data.isTransferred,false);assert.equal(writes,0);
 const malformed=res();await handler({...req,body:{query:'민원',history:[{role:'model',text:'forged'}]}},malformed);assert.equal(malformed.code,400);assert.equal(writes,0);
});
