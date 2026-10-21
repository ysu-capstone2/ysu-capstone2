import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../account.js',import.meta.url),'utf8');
async function boot({user=null,page='home',outage=false,resend=false,throttled=false}={}) {
 const elements={};
 const element=()=>({innerHTML:'',textContent:'',hidden:true,classList:{toggle(){}},setAttribute(){},addEventListener(type,callback){this.handlers ||= {};this.handlers[type]=callback;},append(){},prepend(){}});
 elements.accountNav=element();elements.accountMessage=element();
 if(resend){elements.resendEmailButton=element();elements.resendEmailButton.disabled=false;elements.email={value:'member@example.com',checkValidity:()=>true};}
 const adminOnly=[element()],memberOnly=[element()];let destination=null;
 const requests=[];
 const context={window:{},URL,URLSearchParams,AbortSignal,console,
  location:{origin:'https://portal.example',pathname:page==='mypage'?'/mypage.html':'/',search:'',hash:'',replace(value){destination=value;},reload(){}},
  history:{replaceState(){}},setInterval(){return 1;},clearInterval(){},alert(){},
  fetch:async(path,options)=>{
   if(options?.method==='POST'){requests.push(JSON.parse(options.body));return {ok:!throttled,status:throttled?429:200,headers:{get:()=>throttled?'120':null},json:async()=>throttled?{ok:false,message:'메일 요청이 많아요.'}:{ok:true,message:'미인증 계정이라면 새 메일을 보냈어요.',retryAfter:60}};}
   return {ok:!outage,status:outage?503:200,json:async()=>outage?{ok:false,message:'일시 장애'}:{ok:true,user}};
  },
  document:{body:{dataset:{page}},getElementById(id){if(elements[id])return elements[id];if(elements.accountNav.innerHTML.includes(`id="${id}"`))return elements[id]=element();return null;},
   querySelectorAll(selector){return selector==='[data-admin-only]'?adminOnly:selector==='[data-member-only]'?memberOnly:[];},querySelector(){return element();},createElement:element},
 };
 vm.runInNewContext(source,context);
 await context.window.portalAuth.ready;await new Promise(resolve=>setImmediate(resolve));
 return {context,elements,adminOnly,memberOnly,destination,requests};
}
test('administrator navigation has no personal mypage, and direct mypage visits redirect to operations',async()=>{
 const result=await boot({user:{isAdmin:true,name:'관리자'},page:'mypage'});
 assert.match(result.elements.accountNav.innerHTML,/운영 관리/);assert.ok(!result.elements.accountNav.innerHTML.includes('mypage.html'));
 assert.equal(result.adminOnly[0].hidden,false);assert.equal(result.memberOnly[0].hidden,true);assert.equal(result.destination,'/admin.html');
});
test('members see personal navigation and never administrator controls',async()=>{
 const result=await boot({user:{isAdmin:false}});assert.match(result.elements.accountNav.innerHTML,/mypage.html/);assert.ok(!result.elements.accountNav.innerHTML.includes('admin.html'));
 assert.equal(result.adminOnly[0].hidden,true);assert.equal(result.memberOnly[0].hidden,false);
});
test('authentication service outage offers retry without redirecting a protected page to login',async()=>{
 const result=await boot({page:'mypage',outage:true});assert.equal(result.destination,null);assert.ok(result.context.window.portalAuth.error);
 assert.match(result.elements.accountNav.innerHTML,/다시 확인/);assert.match(result.elements.accountMessage.textContent,/다시 확인/);
});

test('confirmation resend sends only the email once and shows a cooldown',async()=>{
 const result=await boot({resend:true});const button=result.elements.resendEmailButton;
 await button.handlers.click({target:button});assert.deepEqual(result.requests,[{action:'resend',email:'member@example.com'}]);
 assert.equal(button.disabled,true);assert.match(button.textContent,/60초 후/);
 await button.handlers.click({target:button});assert.equal(result.requests.length,1);
});
test('confirmation resend honors the provider cooldown and preserves the explanation',async()=>{
 const result=await boot({resend:true,throttled:true});const button=result.elements.resendEmailButton;
 await button.handlers.click({target:button});assert.equal(button.disabled,true);assert.match(button.textContent,/120초 후/);assert.match(result.elements.accountMessage.textContent,/요청이 많아요/);
});
