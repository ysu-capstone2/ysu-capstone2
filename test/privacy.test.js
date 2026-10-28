import test from 'node:test';
import assert from 'node:assert/strict';
import privacy from '../api/privacy.js';
process.env.SUPABASE_URL='https://privacy-test.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY='public-test-key';
const userId='11111111-1111-4111-8111-111111111111', requestId='22222222-2222-4222-8222-222222222222';
const originalFetch=globalThis.fetch;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
async function call({method='GET',body,guest=false,administrator=false,fetcher}={}) {
  const calls=[],res={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
  globalThis.fetch=async(url,options={})=>{
    if(url.endsWith('/auth/v1/user'))return json({id:userId,app_metadata:administrator?{role:'admin'}:{},user_metadata:{role:'admin'}});
    calls.push({url,options});return fetcher?fetcher(url,options):json([]);
  };
  try{await privacy({method,body,query:{},headers:{host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json',...(guest?{}:{cookie:'portal_access=verified'})}},res);return {...res,calls};}
  finally{globalThis.fetch=originalFetch;}
}
test('privacy records require login and members only query their own requests',async()=>{
  const guest=await call({guest:true});assert.equal(guest.code,401);assert.equal(guest.calls.length,0);
  const member=await call();assert.equal(member.code,200);assert.equal(new URL(member.calls[0].url).searchParams.get('user_id'),'eq.'+userId);
  const admin=await call({administrator:true});assert.equal(new URL(admin.calls[0].url).searchParams.has('user_id'),false);
});
test('privacy request owner and allowed columns come from verified authentication',async()=>{
  const body={kind:'delete',message:'내 상담 기록 삭제 요청',requestId,user_id:requestId,status:'완료',response:'forged'};
  const result=await call({method:'POST',body,fetcher:(url,options)=>json([{id:requestId,...JSON.parse(options.body)}])});
  assert.equal(result.code,200);
  assert.deepEqual(JSON.parse(result.calls[0].options.body),{user_id:userId,request_id:requestId,kind:'delete',message:body.message});
  assert.ok(result.calls.every(c=>!c.options.method||c.options.method!=='DELETE'));
});
test('a lost privacy request response replays one request and rejects changed content',async()=>{
  const body={kind:'access',message:'',requestId};let writes=0;
  const fetcher=(url,options)=>{if(options.method==='POST'){writes++;return json([]);}return json([{...body,request_id:requestId,id:requestId}]);};
  const replay=await call({method:'POST',body,fetcher});assert.equal(replay.code,200);assert.equal(writes,1);
  const conflict=await call({method:'POST',body:{...body,message:'changed'},fetcher});assert.equal(conflict.code,409);
});
test('invalid privacy kinds, missing request IDs and oversized messages never write',async()=>{
  for(const body of [{kind:'erase-now',message:'',requestId},{kind:'delete',message:''},{kind:'access',message:'x'.repeat(1001),requestId}]){
    const result=await call({method:'POST',body});assert.equal(result.code,400);assert.equal(result.calls.length,0);
  }
});
test('only administrators can write a privacy response, and completion needs actual guidance',async()=>{
  const body={id:requestId,status:'완료',response:'요청한 상담 기록을 확인했습니다.',updatedAt:'2026-10-28T00:00:00Z'};
  const member=await call({method:'PATCH',body});assert.equal(member.code,403);assert.equal(member.calls.length,0);
  const missing=await call({method:'PATCH',administrator:true,body:{...body,response:''}});assert.equal(missing.code,400);assert.equal(missing.calls.length,0);
  const saved=await call({method:'PATCH',administrator:true,body,fetcher:()=>json([{id:requestId,updated_at:'2026-10-28T01:00:00Z'}])});
  assert.equal(saved.code,200);assert.equal(saved.data.request.id,requestId);
  assert.equal(new URL(saved.calls[0].url).searchParams.get('updated_at'),'eq.'+body.updatedAt);
  const stale=await call({method:'PATCH',administrator:true,body});assert.equal(stale.code,409);
});
