// Run: node --env-file=.env.local scripts/create-admin.mjs admin@example.com
// Creates a confirmed local administrator without sending email. Never changes an existing account.
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const email = process.argv[2] || 'admin@ysu-capstone2.local';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid administrator email is required');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Supabase server credentials are required');
async function request(path, options={}) {
  const response=await fetch(`${url}/auth/v1/${path}`,{...options,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw new Error(`Admin setup failed (HTTP ${response.status}). No credentials were printed.`);
  return response.json();
}
for(let page=1;;page++){
 const data=await request(`admin/users?page=${page}&per_page=100`);
 if(data.users.some(user=>user.email===email))throw new Error('This account already exists; no password or role was changed.');
 if(data.users.length<100)break;
}
const password=randomBytes(24).toString('base64url');
const user=await request('admin/users',{method:'POST',body:JSON.stringify({email,password,email_confirm:true,app_metadata:{role:'admin'},user_metadata:{name:'운영 관리자'}})});
await mkdir('.local',{recursive:true,mode:0o700});
await writeFile('.local/admin-account.json',JSON.stringify({email,password,id:user.id},null,2)+'\n',{mode:0o600,flag:'wx'});
await writeFile('.local/admin-account.txt',`관리자 로그인: http://localhost:3000/login.html\n관리자 페이지: http://localhost:3000/admin.html\n이메일: ${email}\n비밀번호: ${password}\n\n이 파일은 Git에서 제외됩니다.\n`,{mode:0o600,flag:'wx'});
console.log('Administrator created. Credentials saved in .local/admin-account.txt (Git ignored).');
