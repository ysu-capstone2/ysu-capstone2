import test from 'node:test';
import assert from 'node:assert/strict';
import auth from '../api/auth.js';
import lookup from '../api/lookup.js';
import reserve from '../api/reserve.js';
import stats from '../api/stats.js';
import admin from '../api/admin.js';
import counters from '../api/counters.js';
const originalFetch=globalThis.fetch;
process.env.SUPABASE_URL='https://auth-test.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY='public-test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY='service-test-key';
const user={id:'11111111-1111-4111-8111-111111111111',email:'member@example.com',user_metadata:{name:'회원'},app_metadata:{}};
function response(status,data={}) {return new Response(status===204?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
function req(method='GET',body,token=true){return {method,headers:{host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json',...(token?{cookie:'portal_access=verified-token'}:{})},query:{},body};}
function res(){return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;},getHeader(k){return this.headers[k];},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}
async function run(handler,request,fetcher){globalThis.fetch=fetcher||(()=>{throw new Error('Unexpected request');});try{const result=res();await handler(request,result);return result;}finally{globalThis.fetch=originalFetch;}}

test('guests cannot look up receipts, reserve, or read admin statistics',async()=>{
 for(const [handler,method,body] of [[lookup,'GET'],[reserve,'POST',{}],[stats,'GET']]){
  const result=await run(handler,req(method,body,false));assert.equal(result.code,401);
 }
});
test('forged access cookies are verified upstream and rejected',async()=>{
 const result=await run(lookup,req(),()=>response(401));assert.equal(result.code,401);assert.ok(result.headers['Set-Cookie'].some(c=>c.includes('Max-Age=0')));
});
test('lookup includes verified ownership and hides another account receipt',async()=>{
 const request=req();request.query={no:'OTHER-RECEIPT',user_id:'attacker-supplied'};
 const result=await run(lookup,request,(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return response(200,user);
  assert.ok(url.includes(`user_id=eq.${user.id}`));assert.ok(!url.includes('attacker-supplied'));assert.equal(options.headers.Authorization,'Bearer verified-token');return response(200,[]);
 });assert.equal(result.code,404);
});
test('regular users and editable user_metadata role cannot become admin',async()=>{
 const result=await run(stats,req(),()=>response(200,{...user,user_metadata:{role:'admin'}}));assert.equal(result.code,403);
 const update=await run(admin,req('PATCH',{id:user.id,status:'완료'}),()=>response(200,user));assert.equal(update.code,403);
});
test('reservation derives owner from verified session and writes one atomic record',async()=>{
 let writes=0;
 const result=await run(reserve,req('POST',{citizenName:'회원',citizenTel:'010-1234-5678',summary:'테스트 상담',consultType:'전화상담',deptCode:'D01',user_id:'spoofed'}),(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return response(200,user);
  const body=JSON.parse(options.body);writes++;assert.equal(body.user_id,user.id);assert.equal(body.process_status,undefined);return response(201,[{id:'receipt',complaint_no:'YSU-1',dept_name:'종합민원과',consult_type:'전화상담'}]);
 });assert.equal(result.code,201);assert.equal(writes,1);
});
test('cross origin changes, malformed JSON, and large bodies fail before auth',async()=>{
 const cross=req('POST',{action:'login'},false);cross.headers.origin='https://evil.example';assert.equal((await run(auth,cross)).code,403);
 assert.equal((await run(auth,req('POST','broken',false))).code,400);
 assert.equal((await run(auth,req('POST',{x:'x'.repeat(21000)},false))).code,413);
});
test('signup with confirmation does not manufacture a logged in session',async()=>{
 const result=await run(auth,req('POST',{action:'signup',name:'회원',email:'test@example.com',password:'safe-password-123'},false),()=>response(200,user));
 assert.equal(result.code,200);assert.equal(result.body.requiresConfirmation,true);assert.equal(result.headers['Set-Cookie'],undefined);
});
test('login sets private cookies, rotates chat identity, and never returns tokens',async()=>{
 const result=await run(auth,req('POST',{action:'login',email:'test@example.com',password:'password'},false),()=>response(200,{access_token:'private-access',refresh_token:'private-refresh',user}));
 assert.equal(result.code,200);assert.ok(result.headers['Set-Cookie'].every(c=>c.includes('HttpOnly')&&c.includes('SameSite=Lax')));assert.ok(result.headers['Set-Cookie'].some(c=>c.startsWith('minwon_session=')));assert.ok(!JSON.stringify(result.body).includes('private-'));
});
test('expired access can refresh without exposing the new credentials',async()=>{
 const request=req();request.headers.cookie+='; portal_refresh=refresh-for-unit-test';let refreshed=false;
 const result=await run(auth,request,(url,options)=>{
  if(url.includes('grant_type=refresh_token')){refreshed=true;return response(200,{access_token:'renewed',refresh_token:'rotated'});}
  return response(options.headers.Authorization==='Bearer renewed'?200:401,user);
 });assert.equal(result.code,200);assert.equal(refreshed,true);assert.equal(result.body.user.id,user.id);assert.ok(!JSON.stringify(result.body).includes('renewed'));
});
test('logout revokes the server session and clears cookies',async()=>{
 let revoked=false;
 const result=await run(auth,req('POST',{action:'logout'}),(url)=>{
  if(url.endsWith('/auth/v1/user'))return response(200,user);
  assert.ok(url.includes('logout?scope=local'));revoked=true;return response(204);
 });assert.equal(result.code,200);assert.equal(revoked,true);assert.ok(result.headers['Set-Cookie'].some(c=>c.startsWith('portal_access=; Max-Age=0')));
});
test('an auth outage does not silently discard a valid session',async()=>{
 const result=await run(auth,req(),()=>response(503));assert.equal(result.code,503);assert.equal(result.headers['Set-Cookie'],undefined);
});
test('empty counter DB returns no fabricated waiting counts or recommendations',async()=>{
 const result=await run(counters,req('GET',undefined,false),()=>response(200,[]));assert.equal(result.code,200);assert.deepEqual(result.body.counters,[]);assert.deepEqual(result.body.recommended,[]);
});

test('confirmation callback returns to the portal and ignores a user-supplied redirect',async()=>{
 const result=await run(auth,req('POST',{action:'signup',name:'회원',email:'test@example.com',password:'safe-password-123',redirectTo:'https://evil.example'},false),(url)=>{
  const target=new URL(url);assert.equal(target.searchParams.get('redirect_to'),'http://localhost:3000/login.html');return response(200,user);
 });assert.equal(result.code,200);
});
test('reservation retries reuse only the verified owner receipt and reject changed content',async()=>{
 const requestId='22222222-2222-4222-8222-222222222222';
 const input={citizenName:'회원',citizenTel:'010-1234-5678',summary:'같은 접수',consultType:'전화상담',deptCode:'D01',requestId};
 let payload;
 const mock=(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return response(200,user);
  if(options.method==='POST'){payload=JSON.parse(options.body);assert.match(options.headers.Prefer,/ignore-duplicates/);return response(200,[]);}
  assert.ok(url.includes(`user_id=eq.${user.id}`));return response(200,[{...payload,complaint_no:'YSU-existing',id:'receipt'}]);
 };
 const replay=await run(reserve,req('POST',input),mock);assert.equal(replay.code,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.complaintNo,'YSU-existing');
 const changed=await run(reserve,req('POST',input),(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return response(200,user);
  if(options.method==='POST')return response(200,[]);
  return response(200,[{...payload,summary:'이전에 접수한 다른 내용'}]);
 });assert.equal(changed.code,409);
});
test('cancellation checks ownership before any privileged queue operation',async()=>{
 const result=await run(counters,req('POST',{action:'cancel',ticketId:'22222222-2222-4222-8222-222222222222',user_id:'spoofed'}),(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return response(200,user);
  assert.ok(url.includes(`user_id=eq.${user.id}`));assert.ok(!url.includes('spoofed'));assert.equal(options.method,undefined);return response(200,[]);
 });assert.equal(result.code,404);
});

test('email confirmation resend keeps the portal callback and does not create a session',async()=>{
 const result=await run(auth,req('POST',{action:'resend',email:'member@example.com'},false),(url,options)=>{
  assert.equal(new URL(url).pathname,'/auth/v1/resend');assert.equal(new URL(url).searchParams.get('redirect_to'),'http://localhost:3000/login.html');
  assert.deepEqual(JSON.parse(options.body),{type:'signup',email:'member@example.com'});return response(200,{});
 });assert.equal(result.code,200);assert.equal(result.body.retryAfter,60);assert.equal(result.headers['Set-Cookie'],undefined);
});
test('resend validation and provider cooldown are preserved without retrying',async()=>{
 assert.equal((await run(auth,req('POST',{action:'resend',email:'invalid'},false))).code,400);
 let calls=0;
 const result=await run(auth,req('POST',{action:'resend',email:'member@example.com'},false),()=>{calls++;return new Response(JSON.stringify({error_code:'over_email_send_rate_limit'}),{status:429,headers:{'Retry-After':'120'}});});
 assert.equal(result.code,429);assert.equal(calls,1);assert.equal(result.headers['Retry-After'],'120');
});
test('citizen can edit, submit supplement, and cancel own complaint according to process state',async()=>{
 const receiptId='33333333-3333-4333-8333-333333333333';
 const editRes=await run(lookup,req('PATCH',{action:'edit',id:receiptId,summary:'수정된 민원 내용',consultType:'방문상담',citizenTel:'010-9999-8888'}),(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return response(200,user);
  if(!options.method)return response(200,[{id:receiptId,user_id:user.id,process_status:'접수',consult_type:'전화상담',citizen_tel:'010-1234-5678',summary:'기존'}]);
  assert.equal(options.method,'PATCH');assert.equal(JSON.parse(options.body).consult_type,'방문상담');return response(200,[{}]);
 });assert.equal(editRes.code,200);
 const suppRes=await run(lookup,req('PATCH',{action:'supplement',id:receiptId,supplement:'건축 도면 추가 제출'}),(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return response(200,user);
  if(!options.method)return response(200,[{id:receiptId,user_id:user.id,process_status:'보완요청',summary:'원본 질의'}]);
  const body=JSON.parse(options.body);assert.equal(body.process_status,'처리중');assert.match(body.summary,/\[민원인 보완제출\] 건축 도면 추가 제출/);return response(200,[{}]);
 });assert.equal(suppRes.code,200);
 const cancelBlocked=await run(lookup,req('PATCH',{action:'cancel',id:receiptId}),(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return response(200,user);
  return response(200,[{id:receiptId,user_id:user.id,process_status:'완료'}]);
 });assert.equal(cancelBlocked.code,409);
});
test('team leader statistics compute self-resolution rate, low-confidence keyword clusters, and department breakdown',async()=>{
 const adminUser={...user,app_metadata:{role:'admin'}};
 const statRes=await run(stats,req('GET'),(url)=>{
  if(url.endsWith('/auth/v1/user'))return response(200,adminUser);
  if(url.includes('portal_summary'))return response(200,{totalComplaints:2,pending:1,processing:1,completed:0,totalInquiries:3,waiting:0});
  if(url.includes('citizen_complaints'))return response(200,[{dept_name:'건축과',consult_type:'전화상담',created_at:'2026-10-22T10:00:00Z',due_date:'2026-10-01',process_status:'접수'},{dept_name:'건축과',consult_type:'방문상담',created_at:'2026-10-23T10:00:00Z',due_date:'2026-10-30',process_status:'처리중'}]);
  return response(200,[{id:1,query:'불법건축물 철거 분쟁 조정',status:'상담연계대기',confidence_score:35,created_at:'2026-10-23T14:00:00Z'},{id:2,query:'불법건축물 신고 및 일조권 분쟁',status:'상담연계대기',confidence_score:42,created_at:'2026-10-23T15:00:00Z'},{id:3,query:'주민등록등본 발급',status:'자체완결',confidence_score:94,created_at:'2026-10-23T01:00:00Z'}]);
 });
 assert.equal(statRes.code,200);assert.equal(statRes.body.analytics.selfResolvedCount,1);assert.equal(statRes.body.analytics.transferredCount,2);
 assert.equal(statRes.body.analytics.overdueCount,1);assert.equal(statRes.body.analytics.byDepartment['건축과'],2);
 assert.ok(statRes.body.analytics.lowConfidenceClusters.some(c=>c.keyword==='불법건축물'&&c.needsKnowledgeUpdate===true));
});
