// Recreate provided test accounts after switching Supabase projects; no email is sent.
// Existing accounts never have their password or permissions changed.
// Preview by default. Add --apply to create missing accounts and verify passwords/roles.
import { readFile, writeFile, copyFile, chmod } from 'node:fs/promises';
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!url || !key || !publicKey) throw new Error('Supabase server and public settings are required.');
const base = new URL(url);
if (base.protocol !== 'https:' || base.username || base.password) throw new Error('A valid HTTPS Supabase URL is required.');
async function request(path, { token = key, ...options } = {}) {
  const response = await fetch(new URL('/auth/v1/'+path,base), {
    ...options, redirect:'error', signal:AbortSignal.timeout(10000),
    headers: { apikey:token === key ? key : publicKey, Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
  });
  if (!response.ok) throw new Error(`Account verification failed (HTTP ${response.status}); no existing password or role was changed.`);
  return response.status === 204 ? null : response.json();
}
const users = [];
for (let page=1;;page++) {
  const data=await request(`admin/users?page=${page}&per_page=100`);
  users.push(...data.users);
  if (data.users.length<100) break;
}
for (const label of ['test','admin']) {
  const path=`.local/${label}-account.json`, account=JSON.parse(await readFile(path,'utf8'));
  let user=users.find(value=>value.email===account.email);
  if (!process.argv.includes('--apply')) { console.log(`${label}: ${user ? 'exists; password/role verification pending' : 'missing; would create without sending email'}`); continue; }
  if (!user) user=await request('admin/users',{method:'POST',body:JSON.stringify({
    email:account.email,password:account.password,email_confirm:true,
    user_metadata:{name:label==='admin'?'운영 관리자':'테스트 회원'},
    ...(label==='admin'?{app_metadata:{role:'admin'}}:{}),
  })});
  if ((user.app_metadata?.role==='admin') !== (label==='admin')) throw new Error(`${label}: existing role differs; no permissions were changed.`);
  const response=await fetch(new URL('/auth/v1/token?grant_type=password',base),{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{apikey:publicKey,'Content-Type':'application/json'},
    body:JSON.stringify({email:account.email,password:account.password}),
  });
  if (!response.ok) throw new Error(`${label}: saved credentials do not match; existing password was not reset.`);
  const session=await response.json();
  await request('logout?scope=local',{method:'POST',token:session.access_token});
  const backup=`.local/${label}-account.before-sync.json`;
  await copyFile(path,backup,1).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await chmod(backup,0o600);
  await writeFile(path,JSON.stringify({...account,id:user.id,projectUrl:base.origin},null,2)+'\n',{mode:0o600});
  console.log(`PASS ${label}: account verified; password and role unchanged`);
}
