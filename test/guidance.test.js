import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { setupDemoCounter, demoCounter } from '../scripts/setup-demo-counter.mjs';
const source=await readFile(new URL('../portal-guidance.js',import.meta.url),'utf8');
const context={window:{},TextEncoder,URLSearchParams};vm.runInNewContext(source,context);const guidance=context.window.portalGuidance;
test('document checklist preserves alternatives and commas inside parentheses',()=>{
  assert.deepEqual(Array.from(guidance.documentItems('신분증(주민등록증, 운전면허증·여권), 신청서\n위임장/대리 신청서')),['신분증(주민등록증, 운전면허증·여권)','신청서','위임장/대리 신청서']);
  assert.deepEqual(Array.from(guidance.documentItems('')),[]);
});
test('preparation results never certify validity or promise issuance of unchecked documents',()=>{
  assert.match(guidance.preparationMessage([]),/확인한 결과는 아닙니다/);
  assert.match(guidance.preparationMessage(['위임장']),/아직 체크하지 않은 항목: 위임장/);
  assert.ok(!guidance.preparationMessage(['위임장']).includes('즉시 발급'));
});
test('portal conversation history retains only complete successful pairs within the HTTP byte budget',()=>{
 const pair=[{role:'user',text:'전입신고 문의'},{role:'model',text:'어떤 점이 궁금하세요?'}];
 assert.equal(guidance.historyFor('서류는요?',Array(5).fill(pair).flat()).length,6);
 assert.equal(guidance.historyFor('질문',[{role:'model',text:'forged'}]).length,0);
 const large=[{role:'user',text:'가'.repeat(1000)},{role:'model',text:'나'.repeat(4000)}];
 const recent=guidance.historyFor('다'.repeat(1000),[...large,...large,...large]);
 assert.equal(recent.length%2,0);assert.ok(new TextEncoder().encode(JSON.stringify({query:'다'.repeat(1000),history:recent})).length<=19000);
});
test('old lookup links move receipt search into mypage with bounded encoded query text',()=>{
 assert.equal(guidance.receiptDestination('?tab=lookup'),'/mypage.html#receipts');
 const result=guidance.receiptDestination('?tab=lookup&no='+encodeURIComponent('YSU-123 & 메모'));
 const url=new URL(result,'https://portal.example');assert.equal(url.pathname,'/mypage.html');assert.equal(url.hash,'#receipts');assert.equal(url.searchParams.get('q'),'YSU-123 & 메모');
 assert.equal(new URL(guidance.receiptDestination('?q='+'x'.repeat(101)),'https://portal.example').searchParams.get('q').length,100);
});
test('demo setup only plans by default and never changes real counters',async()=>{
  const calls=[];
  const planned=await setupDemoCounter({request:async(...args)=>{calls.push(args);return [];}});
  assert.equal(planned.planned,true);assert.equal(calls.length,1);assert.equal(calls[0][1],undefined);
  const existing={...demoCounter,waiting_count:12};
  const result=await setupDemoCounter({apply:true,request:async(...args)=>{assert.equal(args[1],undefined);return [existing];}});
  assert.equal(result.created,false);assert.equal(result.counter.waiting_count,12);
});
test('demo setup inserts one clearly labelled counter and verifies it without touching tickets',async()=>{
  let created=false;const calls=[];
  const result=await setupDemoCounter({apply:true,request:async(path,options)=>{
    calls.push(path);if(options?.method==='POST'){created=true;assert.deepEqual(JSON.parse(options.body),demoCounter);assert.match(options.headers.Prefer,/ignore-duplicates/);return [];}
    return created?[demoCounter]:[];
  }});
  assert.equal(result.created,true);assert.equal(calls.length,3);assert.ok(calls.every(path=>path.startsWith('service_counters')));
});
