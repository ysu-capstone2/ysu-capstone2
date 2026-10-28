import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import auth from '../api/auth.js';
import stats from '../api/stats.js';
import lookup from '../api/lookup.js';
import reserve from '../api/reserve.js';
import admin from '../api/admin.js';
import { createComplaintHandler } from '../api/complaints.js';
import { createCounterHandler } from '../api/counters.js';
import { listQuery, preferredTime } from '../api/_complaints.js';
import { planBootstrap } from '../scripts/database-bootstrap.mjs';

process.env.SUPABASE_URL='https://workflow-test.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY='public-test-key';
const originalFetch=globalThis.fetch;
const id='11111111-1111-4111-8111-111111111111';
const user={id,email:'member@example.com',user_metadata:{},app_metadata:{}};
const response=(status,data)=>new Response(status===204?null:JSON.stringify(data),{status});
function req(method='GET',body,query={}){return {method,body,query,headers:{host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json',cookie:'portal_access=verified'}};}
async function run(handler,request,fetcher){
 const result={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},getHeader(k){return this.headers[k];},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 globalThis.fetch=fetcher||(()=>{throw new Error('unexpected upstream request');});
 try{await handler(request,result);return result;}finally{globalThis.fetch=originalFetch;}
}

test('DB bootstrap includes all migrations, adopts legacy schema, and skips recorded versions',async()=>{
 const files=(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
 const migrations=await Promise.all(files.map(async file=>{const [,version,name]=file.match(/^(\d+)_(.+)\.sql$/);return {version,name,sql:await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8')};}));
 const fresh=planBootstrap({migrations,tables:[]});
 const legacy=planBootstrap({migrations,tables:['chat_session']});assert.ok(legacy.includes('do $$ declare seq text;'));assert.match(legacy,/pg_get_serial_sequence/);
 assert.match(fresh,/add column request_id/);assert.match(fresh,/create function public.portal_cancel_ticket/);assert.match(fresh,/create table if not exists public.admin_knowledge/);assert.match(fresh,/create function public.portal_member_complaint/);
 const tables=['citizen_complaints','service_counters','queue_tickets','chat_session'];
 const old=planBootstrap({migrations,tables});assert.doesNotMatch(old,/create table public.citizen_complaints/);assert.match(old,/add column request_id/);
 const rerun=planBootstrap({migrations,tables,columns:['request_id'],hasCancel:true,applied:migrations.map(m=>m.version)});assert.doesNotMatch(rerun,/add column/);
 assert.throws(()=>planBootstrap({migrations,tables:['queue_tickets']}),/Partial/);
 assert.throws(()=>planBootstrap({migrations,tables,columns:['request_id']}),/Partial/);
 const referenceUpgrade=planBootstrap({migrations,tables:[...tables,'department_info'],columns:['request_id'],hasCancel:true});
 assert.ok(referenceUpgrade.indexOf('add column if not exists category_code')<referenceUpgrade.indexOf('insert into public.department_info'));
 assert.match(referenceUpgrade,/coalesce\(window_location/);assert.match(referenceUpgrade,/on conflict \(dept_code\) do nothing/);
});

test('administrator search and pagination query the complete data set with safe literals',async()=>{
 const request=req('GET',undefined,{page:'6',pageSize:'20',q:'옛 접수,(이름)'});
 const result=await run(stats,request,(url)=>{
  if(url.endsWith('/auth/v1/user'))return response(200,{...user,app_metadata:{role:'admin'}});
  if(url.includes('rpc/portal_summary'))return response(200,{totalComplaints:150});
  if(url.includes('chat_session'))return response(200,[]);
  const params=new URL(url).searchParams;if(params.get('limit')==='100'){assert.equal(params.has('or'),false);return response(200,[]);}assert.equal(params.get('offset'),'100');assert.equal(params.get('limit'),'21');assert.match(params.get('or'),/citizen_name\.ilike\."%옛 접수,\(이름\)%"/);
  return response(200,Array.from({length:21},(_,i)=>({id:i})));
 });assert.equal(result.code,200);assert.equal(result.body.complaints.length,20);assert.equal(result.body.pagination.hasNext,true);assert.equal(result.body.pagination.page,6);
 assert.throws(()=>listQuery({page:'-1'}));assert.throws(()=>listQuery({pageSize:'1000'}));assert.throws(()=>listQuery({q:'x'.repeat(101)}));
 const filter=listQuery({q:'"%,x*\\'}).params.get('or');assert.ok(filter.includes('\\"'));assert.ok(filter.includes('\\%'));assert.ok(filter.includes('\\*'));
});

test('member search stays owner-scoped and includes supplement and schedule details',async()=>{
 const result=await run(lookup,req('GET',undefined,{page:'2',q:'옛 민원'}),url=>{
  if(url.endsWith('/auth/v1/user'))return response(200,user);
  const p=new URL(url).searchParams;assert.equal(p.get('user_id'),'eq.'+id);assert.equal(p.get('offset'),'20');assert.ok(p.get('or').includes('summary.ilike'));
  return response(200,[{id,complaint_no:'YSU-old',supplements:[{text:'추가 설명'}],preferred_at:'2030-01-01T00:00:00Z'}]);
 });assert.equal(result.body.complaints[0].id,id);assert.equal(result.body.complaints[0].supplements[0].text,'추가 설명');assert.equal(result.body.pagination.hasNext,false);
});

test('receipt lookup ignores list pagination and search when an exact number is supplied',async()=>{
 const result=await run(lookup,req('GET',undefined,{no:'YSU-old',page:'10',q:'다른 내용'}),url=>{
  if(url.endsWith('/auth/v1/user'))return response(200,user);
  const p=new URL(url).searchParams;assert.equal(p.get('complaint_no'),'eq.YSU-old');assert.equal(p.get('offset'),null);assert.equal(p.get('or'),null);return response(200,[{id,complaint_no:'YSU-old'}]);
 });assert.equal(result.code,200);assert.equal(result.body.complaint.complaintNo,'YSU-old');
});

test('member mutations derive ownership from verified Auth and cannot be invoked by guests or administrators',async()=>{
 let payload;
 const handler=createComplaintHandler({request:async(path,options)=>{assert.equal(path,'rpc/portal_member_complaint_once');payload=JSON.parse(options.body);return {ok:true};}});
 const result=await run(handler,req('PATCH',{id,action:'supplement',text:'추가 설명',user_id:'spoofed'}),()=>response(200,user));assert.equal(result.code,200);assert.equal(payload.p_user,user.id);assert.equal(payload.p_text,'추가 설명');assert.match(payload.p_request,/^[a-f0-9-]{36}$/);
 const guest=req('PATCH',{id,action:'cancel'});guest.headers.cookie='';assert.equal((await run(handler,guest)).code,401);
 assert.equal((await run(handler,req('PATCH',{id,action:'cancel'}),()=>response(200,{...user,app_metadata:{role:'admin'}}))).code,403);
 const denied=createComplaintHandler({request:async()=>({ok:false,reason:'not_found'})});assert.equal((await run(denied,req('PATCH',{id,action:'cancel'}),()=>response(200,user))).code,404);
 const conflict=createComplaintHandler({request:async()=>({ok:false,reason:'invalid_state'})});assert.equal((await run(conflict,req('PATCH',{id,action:'cancel'}),()=>response(200,user))).code,409);
});

test('member mutations reject invalid content and past/out-of-range appointments before database writes',async()=>{
 const handler=createComplaintHandler({request:()=>{throw new Error('must not write');}});
 for(const body of [{id,action:'supplement',text:' '},{id,action:'supplement',text:'x'.repeat(2001)},{id,action:'reschedule',preferredAt:'2020-01-01T00:00:00Z'},{id,action:'reschedule',preferredAt:'2099-01-01T00:00:00Z'},{id:'spoofed',action:'cancel'}])assert.equal((await run(handler,req('PATCH',body),()=>response(200,user))).code,400);
 const cross=req('PATCH',{id,action:'cancel'});cross.headers.origin='https://evil.example';assert.equal((await run(handler,cross)).code,403);
 const now=Date.now();assert.equal(preferredTime(new Date(now+86400000).toISOString(),{now}),new Date(now+86400000).toISOString());assert.throws(()=>preferredTime('2027-01-01T12:00'));assert.throws(()=>preferredTime(null,{required:true}));
});

test('reservation stores an optional future preference without changing ownership',async()=>{
 const preferredAt=new Date(Date.now()+86400000).toISOString();
 const result=await run(reserve,req('POST',{citizenName:'회원',citizenTel:'010-1234-5678',summary:'상담',consultType:'방문상담',deptCode:'D01',preferredAt}),(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return response(200,user);
  const body=JSON.parse(options.body);assert.equal(body.preferred_at,preferredAt);assert.equal(body.user_id,id);return response(201,[{...body,complaint_no:'YSU-new',id}]);
 });assert.equal(result.code,201);
});

test('stale administrator writes cannot overwrite a cancelled or changed receipt',async()=>{
 const timestamp='2026-10-01T01:02:03.000Z';
 const result=await run(admin,req('PATCH',{id,status:'완료',updatedAt:timestamp}),(url)=>{
  if(url.endsWith('/auth/v1/user'))return response(200,{...user,app_metadata:{role:'admin'}});
  const p=new URL(url).searchParams;assert.equal(p.get('process_status'),'neq.취소');assert.equal(p.get('updated_at'),'eq.'+timestamp);return response(200,[]);
 });assert.equal(result.code,409);
});

test('administrator due dates are saved with the conditional status update in a single write',async()=>{
 let writes=0;
 const result=await run(admin,req('PATCH',{id,status:'처리중',dueDate:'2026-11-01',updatedAt:'2026-10-28T00:00:00Z'}),(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return response(200,{...user,app_metadata:{role:'admin'}});
  writes++;assert.equal(options.method,'PATCH');assert.equal(JSON.parse(options.body).due_date,'2026-11-01');assert.ok(new URL(url).searchParams.has('updated_at'));return response(200,[{id}]);
 });assert.equal(result.code,200);assert.equal(writes,1);
});

test('password recovery uses a canonical callback and does not reveal account existence or tokens',async()=>{
 const result=await run(auth,req('POST',{action:'recover',email:user.email,redirectTo:'https://evil.example'}),(url,options)=>{
  const target=new URL(url);assert.equal(target.pathname,'/auth/v1/recover');assert.equal(target.searchParams.get('redirect_to'),'http://localhost:3000/login.html');assert.deepEqual(JSON.parse(options.body),{email:user.email});return response(200,{});
 });assert.equal(result.code,200);assert.match(result.body.message,/가입한 이메일이라면/);assert.equal(result.headers['Set-Cookie'],undefined);
});

test('password update verifies the recovery token, changes only the password and clears cookies',async()=>{
 let updated=false;
 const result=await run(auth,req('POST',{action:'reset-password',accessToken:'private-recovery',password:'new-password-123',app_metadata:{role:'admin'}}),(url,options)=>{
  assert.equal(options.headers.Authorization,'Bearer private-recovery');
  if(options.method==='PUT'){updated=true;assert.deepEqual(JSON.parse(options.body),{password:'new-password-123'});return response(200,user);}
  return url.includes('logout')?response(204):response(200,user);
 });assert.equal(result.code,200);assert.equal(updated,true);assert.ok(result.headers['Set-Cookie'].some(value=>value.startsWith('portal_access=; Max-Age=0')));assert.ok(!JSON.stringify(result.body).includes('private-recovery'));
 let writes=0;
 const invalid=await run(auth,req('POST',{action:'reset-password',accessToken:'forged',password:'new-password-123'}),()=>{writes++;return response(401,{code:'bad_jwt'});});assert.equal(invalid.code,400);assert.equal(writes,1);
});


test('status filters are validated and combined with server search and pagination',()=>{
 const params=listQuery({status:'보완요청',q:'도로',page:'3'}).params;
 assert.equal(params.get('process_status'),'eq.보완요청');assert.equal(params.get('offset'),'40');assert.ok(params.get('or').includes('도로'));
 assert.throws(()=>listQuery({status:'완료,or(id.gt.0)'}));
});

test('member retries forward the same request ID and report successful replay',async()=>{
 const requestId='33333333-3333-4333-8333-333333333333';let received;
 const handler=createComplaintHandler({request:async(path,options)=>{received=JSON.parse(options.body);return {ok:true,replayed:true};}});
 const result=await run(handler,req('PATCH',{id,action:'supplement',text:'추가 설명',requestId}),()=>response(200,user));
 assert.equal(result.code,200);assert.equal(received.p_request,requestId);assert.equal(result.body.replayed,true);
 const invalid=await run(handler,req('PATCH',{id,action:'cancel',requestId:'bad'}),()=>response(200,user));assert.equal(invalid.code,400);
});

test('queue calls require an administrator, a stable request ID and the observed revision',async()=>{
 let payload;
 const handler=createCounterHandler({request:async(path,options)=>{assert.equal(path,'rpc/portal_call_next_once');payload=JSON.parse(options.body);return {ok:true,replayed:true};}});
 const body={action:'next',counterId:id,requestId:'44444444-4444-4444-8444-444444444444',updatedAt:'2026-10-28T01:02:03.123456+00:00',user_id:'spoofed'};
 const adminUser={...user,app_metadata:{role:'admin'}};
 const result=await run(handler,req('PATCH',body),()=>response(200,adminUser));assert.equal(result.code,200);assert.equal(payload.p_actor,user.id);assert.equal(payload.p_expected,body.updatedAt);assert.equal(payload.p_request,body.requestId);assert.equal(result.body.replayed,true);
 assert.equal((await run(handler,req('PATCH',body),()=>response(200,user))).code,403);
 assert.equal((await run(handler,req('PATCH',{...body,requestId:undefined}),()=>response(200,adminUser))).code,400);
 assert.equal((await run(handler,req('PATCH',{...body,updatedAt:undefined}),()=>response(200,adminUser))).code,400);
 const stale=createCounterHandler({request:async()=>({ok:false,reason:'stale_counter'})});assert.equal((await run(stale,req('PATCH',body),()=>response(200,adminUser))).code,409);
});
