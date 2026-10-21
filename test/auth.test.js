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
