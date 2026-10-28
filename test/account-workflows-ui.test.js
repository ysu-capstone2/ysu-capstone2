import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../account.js',import.meta.url),'utf8');
const id='11111111-1111-4111-8111-111111111111';
const initialRevision='2026-10-28T00:00:01.000001+00:00';
const laterRevision='2026-10-28T00:00:02.000002+00:00';
const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));};

async function boot(page='mypage'){
 const elements=new Map(),requests=[],intervals=[],listeners={},forms=new Map();let failList=false,failMutation=false,revision=initialRevision;
 const make=()=>({value:'',textContent:'',hidden:true,disabled:false,dataset:{},handlers:{},attributes:{},classList:{toggle(){}},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,v){this.handlers[k]=v;},querySelector(){return make();},querySelectorAll(){return [];},closest(){return null;},append(){},prepend(){}});
 function form(kind){
  const f=make();f.dataset=kind==='member'?{id,complaintAction:'supplement'}:{receiptId:id,updatedAt:initialRevision};
  f.fields=kind==='member'?{text:{value:''}}:{status:{value:'보완요청'},officer:{value:'담당자'},result:{value:'추가 내용 요청'}};
  f.elements={namedItem:name=>f.fields[name]};f.button=make();f.querySelector=()=>f.button;f.closest=selector=>selector==='details'?null:f;
  return f;
 }
 function get(name){
  if(!elements.has(name)){
   const element=make();let html='';
   Object.defineProperty(element,'innerHTML',{get:()=>html,set:value=>{html=value;if(name==='myReceipts'||name==='adminReceipts')forms.set(name,[form(name==='myReceipts'?'member':'admin')]);}});
   element.querySelectorAll=()=>forms.get(name)||[];elements.set(name,element);
  }
  return elements.get(name);
 }
 const member={id,email:'qa@example.com',name:'회원',phone:'010-0000-0000',isAdmin:page==='admin'};
 const complaint={id,complaint_no:'YSU-1',summary:'도로 상담',process_status:'보완요청',created_at:initialRevision,updated_at:initialRevision,supplements:[]};
 const response=(data,ok=true)=>({ok,status:ok?200:503,headers:{get:()=>null},json:async()=>data});
 let sequence=0;
 const context={window:{},URL,URLSearchParams,AbortSignal,Date,console,
  crypto:{randomUUID:()=>`99999999-9999-4999-8999-${String(++sequence).padStart(12,'0')}`},
  FormData:class {constructor(f){this.entries=Object.entries(f.fields).map(([k,v])=>[k,v.value]);}[Symbol.iterator](){return this.entries[Symbol.iterator]();}},
  location:{origin:'https://portal.example',pathname:`/${page}.html`,search:'',hash:'',replace(){},reload(){}},history:{replaceState(){}},
  setInterval(callback){intervals.push(callback);return intervals.length;},clearInterval(){},setTimeout(callback){listeners.timer=callback;return 1;},clearTimeout(){},alert(){},confirm:()=>true,
  document:{body:{dataset:{page}},hidden:false,getElementById:get,querySelectorAll:()=>[],querySelector:make,createElement:make,addEventListener(k,v){listeners[k]=v;}},
  fetch:async(path,options={})=>{
   const body=options.body?JSON.parse(options.body):null;requests.push({path,body,method:options.method||'GET'});
   if(path==='/api/auth')return response({ok:true,user:member});
   if(options.method==='PATCH'){
    if(failMutation){failMutation=false;if(path==='/api/counters')revision=laterRevision;throw new Error('lost response');}
    return response({ok:true,replayed:true});
   }
   if(path.startsWith('/api/lookup')||path.startsWith('/api/stats')){
    if(failList){failList=false;return response({ok:false,message:'일시 장애'},false);}
    const pagination={page:1,pageSize:20,hasNext:true};
    return response(page==='admin'?{ok:true,complaints:[complaint],pagination,summary:{totalComplaints:1,pending:0,processing:1,completed:0},recentSessions:[]}:{ok:true,complaints:[{id,complaintNo:'YSU-1',summary:'도로 상담',processStatus:'보완요청',supplements:[]}],pagination});
   }
   if(path.startsWith('/api/counters'))return response({ok:true,counters:[{id,counterName:'테스트 창구',isOpen:true,updatedAt:revision,currentCallingNo:1,waitingCount:1}],tickets:[]});
   throw new Error('unexpected request '+path);
  },
 };
 vm.runInNewContext(source,context);await context.window.portalAuth.ready;await flush();
 return {get,requests,intervals,listeners,forms,context,failList:()=>{failList=true;},failMutation:()=>{failMutation=true;},counterButton:()=>Object.assign(make(),{dataset:{counterAction:'next',id,updatedAt:revision},closest(){return this;}})};
}

test('a failed list refresh preserves member input, offers retry and restores it after rendering',async()=>{
 const ui=await boot();const container=ui.get('myReceipts'),form=ui.forms.get('myReceipts')[0];
 form.fields.text.value='아직 제출하지 않은 보완 설명';container.handlers.input({target:{closest:()=>form}});
 const html=container.innerHTML;ui.failList();await ui.get('refreshReceipts').handlers.click();await flush();
 assert.equal(container.innerHTML,html);assert.equal(form.fields.text.value,'아직 제출하지 않은 보완 설명');assert.equal(ui.get('receiptLoadError').hidden,false);
 await ui.get('receiptRetry').handlers.click();await flush();
 assert.equal(ui.get('receiptLoadError').hidden,true);assert.equal(ui.forms.get('myReceipts')[0].fields.text.value,'아직 제출하지 않은 보완 설명');
});

test('member retries preserve their operation ID after a lost response',async()=>{
 const ui=await boot();const container=ui.get('myReceipts'),form=ui.forms.get('myReceipts')[0];form.fields.text.value='동일 보완 내용';
 ui.failMutation();const event={target:{closest:()=>form},preventDefault(){}};
 await container.handlers.submit(event);assert.equal(form.button.disabled,false);
 await container.handlers.submit(event);
 const mutations=ui.requests.filter(r=>r.path==='/api/complaints');assert.equal(mutations.length,2);assert.equal(mutations[0].body.requestId,mutations[1].body.requestId);assert.equal(mutations[0].body.text,mutations[1].body.text);
});

test('administrator retries reuse the observed revision even after an automatic refresh',async()=>{
 const ui=await boot('admin'),container=ui.get('adminCounters');ui.failMutation();
 await container.handlers.click({target:ui.counterButton()});
 assert.match(ui.get('accountMessage').textContent,/같은 요청/);
 await ui.intervals[0]();await flush();
 await container.handlers.click({target:ui.counterButton()});
 const mutations=ui.requests.filter(r=>r.path==='/api/counters'&&r.method==='PATCH');
 assert.equal(mutations.length,2);assert.equal(mutations[0].body.requestId,mutations[1].body.requestId);assert.equal(mutations[1].body.updatedAt,initialRevision);
});

test('administrator drafts survive a failed read and later successful refresh',async()=>{
 const ui=await boot('admin'),container=ui.get('adminReceipts'),form=ui.forms.get('adminReceipts')[0];form.fields.result.value='작성 중인 처리 결과';container.handlers.input({target:{closest:()=>form}});
 ui.failList();await ui.get('refreshAdmin').handlers.click();await flush();assert.equal(ui.get('adminLoadError').hidden,false);assert.equal(form.fields.result.value,'작성 중인 처리 결과');
 await ui.get('adminRetry').handlers.click();await flush();assert.equal(ui.forms.get('adminReceipts')[0].fields.result.value,'작성 중인 처리 결과');
});

test('status selection resets list paging and ticket polling leaves receipt drafts intact',async()=>{
 const ui=await boot();ui.get('receiptStatus').value='보완요청';await ui.get('receiptStatus').handlers.change();await flush();
 const lookup=ui.requests.filter(r=>r.path.startsWith('/api/lookup')).at(-1);assert.equal(new URL(lookup.path,'https://portal.example').searchParams.get('status'),'보완요청');
 const container=ui.get('myReceipts'),html=container.innerHTML;await ui.intervals[0]();await flush();assert.equal(container.innerHTML,html);assert.match(ui.get('myTicketStatus').textContent,/마지막 확인/);
});
