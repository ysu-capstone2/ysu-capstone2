// Explicit integration test: npm run test:live (uses a running localhost server and real Supabase).
// Only test-owned temporary rows/accounts are removed. No emails are sent.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const origin='http://localhost:3000',url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY,pub=process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !key || !pub) throw new Error('Local Supabase environment required');
const member=JSON.parse(await readFile('.local/test-account.json','utf8'));
const administrator=JSON.parse(await readFile('.local/admin-account.json','utf8'));
let tempUser,counterId,receiptId;
async function service(path,options={}) {
 const response=await fetch(`${url}/${path}`,{...options,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'return=representation'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error(`Service test setup/cleanup failed: HTTP ${response.status}`);
 return response.status===204?null:response.json();
}
function client(){
 const jar=new Map();
 return {jar,async call(path,method='GET',body){
  const r=await fetch(origin+path,{method,headers:{origin,'Content-Type':'application/json',cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],i=pair.indexOf('=');if(c.includes('Max-Age=0'))jar.delete(pair.slice(0,i));else jar.set(pair.slice(0,i),pair.slice(i+1));}
  return {status:r.status,data:await r.json()};
 }};
}
const a=client(),b=client(),admin=client(),guest=client();
async function login(c,account){const r=await c.call('/api/auth','POST',{action:'login',email:account.email,password:account.password});assert.equal(r.status,200,'login should succeed');}
async function direct(c,path,options={}){const r=await fetch(`${url}/rest/v1/${path}`,{...options,headers:{apikey:pub,Authorization:`Bearer ${c.jar.get('portal_access')}`,'Content-Type':'application/json',Prefer:'return=representation'}});return {status:r.status,data:await r.json().catch(()=>null)};}
const pass=label=>console.log('PASS '+label);
try {
 const password=randomBytes(24).toString('base64url');
 const email=`integration-${randomUUID()}@ysu-capstone2.local`;
 tempUser=await service('auth/v1/admin/users',{method:'POST',body:JSON.stringify({email,password,email_confirm:true,user_metadata:{name:'임시 권한 테스트'}})});
 await login(a,member);await login(b,{email,password});await login(admin,administrator);pass('member and administrator login');
 assert.equal((await guest.call('/api/lookup')).status,401);assert.equal((await guest.call('/api/stats')).status,401);assert.equal((await a.call('/api/stats')).status,403);pass('guest and member admin access blocked');
 const submitted=await a.call('/api/reserve','POST',{citizenName:'통합 테스트',citizenTel:'010-0000-0000',summary:'[자동 검증] 삭제 예정 접수',consultType:'전화상담',deptCode:'D01',user_id:tempUser.id});
 assert.equal(submitted.status,201,'reservation should persist');const no=submitted.data.complaintNo;
 const stored=await service(`rest/v1/citizen_complaints?complaint_no=eq.${no}`);receiptId=stored[0].id;assert.equal(stored[0].user_id,member.id);
 assert.equal((await a.call('/api/lookup?no='+no)).status,200);assert.equal((await b.call('/api/lookup?no='+no)).status,404);
 assert.deepEqual((await direct(b,`citizen_complaints?id=eq.${receiptId}`)).data,[]);
 assert.ok((await direct(a,'rpc/portal_join_queue',{method:'POST',body:JSON.stringify({p_counter:randomUUID(),p_user:member.id})})).status>=400);pass('owner receipt succeeds; other account blocked by API and RLS');
 const forbiddenUpdate=await direct(a,`citizen_complaints?id=eq.${receiptId}`,{method:'PATCH',body:JSON.stringify({process_status:'완료'})});assert.deepEqual(forbiddenUpdate.data,[]);
 const impersonation=await direct(a,'citizen_complaints',{method:'POST',body:JSON.stringify({user_id:tempUser.id,citizen_name:'위조',citizen_tel:'010-0000-0000',dept_name:'테스트',consult_type:'전화상담',summary:'위조 테스트'})});assert.ok(impersonation.status>=400);pass('direct database status changes and owner spoof blocked');
 const adminRows=await admin.call('/api/stats');assert.equal(adminRows.status,200);assert.ok(adminRows.data.summary.totalComplaints>=1);
 assert.equal((await admin.call('/api/admin','PATCH',{id:receiptId,status:'완료',officer:'검증 담당자',result:'통합 테스트 완료'})).status,200);
 assert.equal((await a.call('/api/lookup?no='+no)).data.complaint.processStatus,'완료');pass('administrator real counts and status update');
 const created=await service('rest/v1/service_counters',{method:'POST',body:JSON.stringify({org_name:'자동 테스트 (삭제 예정)',counter_name:'통합 테스트 창구',location:'자동 검증 전용'})});counterId=created[0].id;
 const attempts=await Promise.all(Array.from({length:5},()=>a.call('/api/counters','POST',{action:'ticket',counterId})));
 assert.ok(attempts.every(r=>r.status===200));assert.equal(new Set(attempts.map(r=>r.data.ticket.id)).size,1);
 const ticketB=await b.call('/api/counters','POST',{action:'ticket',counterId});assert.equal(ticketB.status,200);assert.equal(ticketB.data.ticket.ticket_no,2);
 const before=(await guest.call('/api/counters')).data.counters.find(c=>c.id===counterId);assert.equal(before.waitingCount,2);
 assert.equal((await a.call('/api/counters','PATCH',{action:'next',counterId})).status,403);
 assert.equal((await admin.call('/api/counters','PATCH',{action:'next',counterId})).status,200);
 const after=(await guest.call('/api/counters')).data.counters.find(c=>c.id===counterId);assert.equal(after.waitingCount,1);assert.equal(after.currentCallingNo,1);
 assert.equal((await a.call('/api/counters?mine=1')).data.tickets.find(t=>t.counter_id===counterId).status,'호출');
 const otherTickets=await direct(b,`queue_tickets?counter_id=eq.${counterId}`);assert.ok(otherTickets.data.every(t=>t.user_id===tempUser.id));pass('concurrent ticket dedup, count 2 → 1, and owner-only tickets');
 const profile=await b.call('/api/auth','PATCH',{name:'프로필 검증',phone:'010-0000-0000',role:'admin'});assert.equal(profile.status,200);assert.equal(profile.data.user.isAdmin,false);pass('profile update cannot grant administrator role');
 a.jar.set('portal_access','deliberately-expired-token');assert.equal((await a.call('/api/auth')).status,200);assert.notEqual(a.jar.get('portal_access'),'deliberately-expired-token');pass('real refresh token renewal');
 assert.equal((await a.call('/api/auth','POST',{action:'logout'})).status,200);assert.equal((await a.call('/api/lookup')).status,401);pass('logout and subsequent access denial');
 console.log('All live integration checks passed.');
} finally {
 if(counterId){await service(`rest/v1/queue_tickets?counter_id=eq.${counterId}`,{method:'DELETE'});await service(`rest/v1/service_counters?id=eq.${counterId}`,{method:'DELETE'});}
 if(receiptId)await service(`rest/v1/citizen_complaints?id=eq.${receiptId}`,{method:'DELETE'});
 if(tempUser)await service(`auth/v1/admin/users/${tempUser.id}`,{method:'DELETE'});
 await Promise.allSettled([b.call('/api/auth','POST',{action:'logout'}),admin.call('/api/auth','POST',{action:'logout'})]);
 console.log('Temporary test records and account removed.');
}
