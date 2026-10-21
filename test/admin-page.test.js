import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/admin-page.js';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const original=globalThis.fetch;
process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_PUBLISHABLE_KEY='test-key';
function res(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},getHeader(k){return this.headers[k];},end(body){this.body=body;}};}
async function run(user,method='GET'){
 const result=res();globalThis.fetch=async()=>new Response(JSON.stringify(user),{status:200});
 try{await handler({method,headers:user?{cookie:'portal_access=token'}:{}},result);return result;}finally{globalThis.fetch=original;}
}
test('administrator HTML is never returned to a guest or ordinary member',async()=>{
 const guest=await run(null);assert.equal(guest.statusCode,303);assert.equal(guest.headers.Location,'/login.html?next=%2Fadmin.html');assert.equal(guest.body,undefined);
 const member=await run({id:'member',app_metadata:{},user_metadata:{role:'admin'}});assert.equal(member.statusCode,403);assert.ok(!String(member.body).includes('adminReceipts'));
});
test('only a verified administrator receives the protected document and it is never cached',async()=>{
 const result=await run({id:'admin',app_metadata:{role:'admin'}});assert.equal(result.statusCode,200);assert.ok(String(result.body).includes('adminReceipts'));assert.match(result.headers['Cache-Control'],/no-store/);assert.equal(result.headers.Vary,'Cookie');
 assert.equal((await run({id:'admin',app_metadata:{role:'admin'}},'HEAD')).body,undefined);
});
test('authentication outage does not serve administrator HTML',async()=>{
 globalThis.fetch=async()=>new Response('{}',{status:503});const result=res();
 try{await handler({method:'GET',headers:{cookie:'portal_access=token'}},result);}finally{globalThis.fetch=original;}
 assert.equal(result.statusCode,503);assert.ok(!String(result.body).includes('adminReceipts'));
});
test('production output excludes administrator template, source, account credentials and environment files',async()=>{
 execFileSync(process.execPath,['scripts/build.mjs']);
 const {readdir}=await import('node:fs/promises');const files=await readdir('public');
 assert.ok(files.includes('index.html'));assert.ok(!files.includes('admin.html'));assert.equal(files.length,10);
 const config=JSON.parse(await readFile('vercel.json','utf8'));assert.equal(config.outputDirectory,'public');assert.ok(config.rewrites.some(r=>r.source==='/admin.html'&&r.destination==='/api/admin-page'));
});
