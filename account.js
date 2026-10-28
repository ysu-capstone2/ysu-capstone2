(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const date = value => value ? new Date(value).toLocaleString('ko-KR') : '미정';
  const badge = value => `<span class="status-badge ${value === '완료' ? 'done' : ''}">${esc(value)}</span>`;
  function message(text, error = false) {
    let el = $('accountMessage');
    if (!el) { el=document.createElement('div'); el.id='accountMessage'; el.className='account-message container'; el.setAttribute('role','status'); document.querySelector('main')?.prepend(el); }
    el.textContent=text; el.classList.toggle('error',error);
  }
  async function api(path, options = {}) {
    let response;
    try { response = await fetch(path, {...options, headers:{'Content-Type':'application/json',...options.headers},cache:'no-store',signal:options.signal || AbortSignal.timeout(15000)}); }
    catch { throw new Error('연결을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    let data;
    try { data=await response.json(); } catch { throw new Error('서버 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    if (!response.ok || !data.ok) { const e = new Error(data.message || '요청을 처리하지 못했어요.'); e.status=response.status; e.code=data.code; e.retryAfter=Number(response.headers?.get('Retry-After'))||0; throw e; }
    return data;
  }
  function safeNext() {
    const input = new URLSearchParams(location.search).get('next');
    if (!input || !input.startsWith('/')) return null;
    try { const url = new URL(input,location.origin); return url.origin===location.origin && !['/login.html','/signup.html'].includes(url.pathname) ? url.pathname+url.search+url.hash : null; } catch { return null; }
  }
  function loginUrl(next = location.pathname+location.search+location.hash) { return ['/login.html','/signup.html'].includes(location.pathname) && next === location.pathname+location.search+location.hash ? '/login.html' : '/login.html?next='+encodeURIComponent(next); }
  const auth = window.portalAuth = { user:null, ready:null, error:null, api, loginUrl, notify:message };
  const actionRequests = new Map();
  const formDrafts = new Map();
  function mutationBody(key, body) {
    const signature=JSON.stringify(body);
    if(actionRequests.get(key)?.signature!==signature)actionRequests.set(key,{signature,requestId:crypto.randomUUID()});
    return {...body,requestId:actionRequests.get(key).requestId};
  }
  async function loadPrivacy(administrator = false) {
    const container = $(administrator ? 'adminPrivacyRequests' : 'myPrivacyRequests');
    if (!container) return;
    try {
      const data = await api('/api/auth?resource=privacy');
      container.innerHTML = data.requests.map(row => `<article class="receipt-card"><div class="receipt-top"><h3>${row.kind === 'delete' ? '개인정보·계정 삭제 요청' : '저장 정보 확인 요청'}</h3>${badge(row.status)}</div><p class="receipt-meta">${esc(date(row.created_at))}${administrator?'<br>회원 식별자 '+esc(row.user_id):''}</p><p class="receipt-result">${esc(row.message || '추가 내용 없음')}</p><p class="receipt-result">${esc(row.response || '운영팀 확인을 기다리고 있어요.')}</p>${administrator?`<form class="receipt-action-form" data-privacy-id="${esc(row.id)}" data-updated-at="${esc(row.updated_at)}"><label>처리 상태<select name="status" class="form-select">${['접수','처리중','완료'].map(status=>`<option ${status===row.status?'selected':''}>${status}</option>`).join('')}</select></label><label>실제 처리 결과·안내<textarea name="response" class="form-textarea" rows="3" maxlength="2000">${esc(row.response)}</textarea></label><button type="submit" class="btn-primary">처리 안내 저장</button><p role="status" aria-live="polite"></p></form>`:''}</article>`).join('') || '<p class="account-empty">접수된 개인정보 요청이 없습니다.</p>';
    } catch (error) { message('개인정보 요청을 불러오지 못했어요. '+error.message, true); }
  }
  async function initPrivacy() {
    await auth.ready;
    const administrator = document.body.dataset.page === 'admin';
    if (!auth.user || auth.user.isAdmin !== administrator) return;
    $(administrator ? 'refreshAdminPrivacy' : 'refreshPrivacy')?.addEventListener('click', () => loadPrivacy(administrator));
    $('privacyRequestForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.target, button = form.querySelector('button[type=submit]'), notice = $('privacyRequestMessage');
      if (button.disabled) return; button.disabled = true;
      try {
        const body = mutationBody('privacy-request', {kind:$('privacyKind').value, message:$('privacyText').value});
        await api('/api/auth?resource=privacy', {method:'POST', body:JSON.stringify(body)});
        actionRequests.delete('privacy-request'); form.reset();
        notice.textContent = '요청을 남겼어요. 운영팀이 확인한 후 이 화면에 안내합니다. 제출 즉시 삭제되지는 않습니다.';
        await loadPrivacy();
      } catch (error) { notice.textContent = error.message+' 입력 내용은 유지됩니다. 같은 내용으로 다시 시도해 주세요.'; }
      finally { button.disabled = false; }
    });
    $('adminPrivacyRequests')?.addEventListener('submit', async event => {
      const form = event.target.closest('[data-privacy-id]'); if (!form) return; event.preventDefault();
      const button = form.querySelector('button'), notice = form.querySelector('[role=status]');
      if (button.disabled) return; button.disabled = true;
      try {
        const data = await api('/api/auth?resource=privacy', {method:'PATCH', body:JSON.stringify({id:form.dataset.privacyId, updatedAt:form.dataset.updatedAt, ...Object.fromEntries(new FormData(form))})});
        form.dataset.updatedAt = data.request.updated_at;
        notice.textContent = '처리 안내를 저장했어요.';
      } catch (error) { notice.textContent = error.message; }
      finally { button.disabled = false; }
    });
    await loadPrivacy(administrator);
  }
  function formKey(form) { return form.dataset.receiptId ? 'admin:'+form.dataset.receiptId : form.dataset.id+':'+form.dataset.complaintAction; }
  function rememberForm(event) {
    const form=event.target.closest('[data-complaint-action], [data-receipt-id]');
    if(form)formDrafts.set(formKey(form),Object.fromEntries(new FormData(form)));
  }
  function restoreForms(container) {
    for(const form of container.querySelectorAll('[data-complaint-action], [data-receipt-id]')){
      const draft=formDrafts.get(formKey(form));if(!draft)continue;
      for(const [name,value] of Object.entries(draft)){const field=form.elements.namedItem(name);if(field)field.value=value;}
      const details=form.closest('details');if(details)details.open=true;
    }
  }
  function listError(prefix,error) {
    $(prefix+'LoadError').hidden=false;
    $(prefix+'LoadMessage').textContent=error.message+' 입력 내용과 이전 조회 결과는 유지됩니다.';
  }
  function renderNav() {
    document.querySelectorAll('[data-admin-only]').forEach(el=>{el.hidden=!auth.user?.isAdmin;});
    document.querySelectorAll('[data-member-only]').forEach(el=>{el.hidden=Boolean(auth.user?.isAdmin);});
    const el = $('accountNav'); if (!el) return;
    if (auth.error) { el.innerHTML='<button type="button" id="retryAuthNav">계정 연결 다시 확인</button>'; $('retryAuthNav').addEventListener('click',()=>location.reload()); return; }
    el.innerHTML = auth.user
      ? `<a href="${auth.user.isAdmin ? '/admin.html' : '/mypage.html'}">${auth.user.isAdmin ? '운영 관리' : '마이페이지'}</a><button type="button" id="logoutButton">로그아웃</button>`
      : `<a href="${esc(loginUrl())}">로그인</a><a href="/signup.html">회원가입</a>`;
    $('logoutButton')?.addEventListener('click', async event => {
      event.target.disabled=true;
      try { await api('/api/auth',{method:'POST',body:JSON.stringify({action:'logout'})}); try { sessionStorage.removeItem('portal-reservation-draft'); } catch {} location.replace('/login.html'); }
      catch(error) { message(error.message,true); alert(error.message); event.target.disabled=false; }
    });
  }
  auth.ready = api('/api/auth').then(data => { auth.user=data.user; renderNav(); return data.user; }).catch(error => { auth.error=error; renderNav(); message(error.message,true); return null; });
  if (['mypage','admin'].includes(document.body.dataset.page)) initPrivacy();
  async function protectedPage(admin = false) {
    await auth.ready;
    if (auth.error) {
      message('계정 연결을 확인하지 못했어요. 입력 정보는 유지됩니다. 새로고침해 다시 확인해 주세요.',true);
      const button=document.createElement('button'); button.className='btn-secondary'; button.textContent='다시 확인'; button.addEventListener('click',()=>location.reload()); $('accountMessage')?.append(document.createElement('br'),button);
      return false;
    }
    if (!auth.user) { location.replace(loginUrl()); return false; }
    if (!admin && auth.user.isAdmin) { location.replace('/admin.html'); return false; }
    if (admin && !auth.user.isAdmin) { message('관리자만 이용할 수 있는 페이지입니다.',true); return false; }
    return true;
  }
  auth.requireUser = async (nextPage) => {
    await auth.ready;
    if (auth.error) { message(auth.error.message,true); return false; }
    if (!auth.user) { location.href=loginUrl(nextPage); return false; }
    if (auth.user.isAdmin) { location.href='/admin.html'; return false; }
    return true;
  };
  const next = safeNext();
  if ($('signupLink') && next) $('signupLink').href='/signup.html?next='+encodeURIComponent(next);
  if ($('loginLink') && next) $('loginLink').href=loginUrl(next);
  let recoveryToken = null;
  // Keep recovery credentials only in memory and remove them from the URL immediately.
  if (/access_token=|error=|error_code=/.test(location.hash)) {
    const fragment = new URLSearchParams(location.hash.slice(1));
    const error = fragment.has('error') || fragment.has('error_code');
    history.replaceState(null,'',location.pathname+location.search);
    if(error && $('resendArea'))$('resendArea').hidden=false;
    if (!error && fragment.get('type') === 'recovery' && fragment.get('access_token') && $('recoveryForm')) {
      recoveryToken = fragment.get('access_token');
      $('loginForm').hidden = true; $('recoveryForm').hidden = false;
      $('resendArea').hidden = true; $('recoverPasswordButton').hidden = true;
      message('새 비밀번호를 입력해 주세요.');
    } else message(error ? '링크가 만료되었거나 이미 사용됐어요. 이미 인증했다면 로그인해 주세요. 인증하지 못했다면 새 메일을 요청하고 가장 최근 링크만 눌러 주세요.' : '이메일 인증을 완료했어요. 이메일과 비밀번호로 로그인해 주세요.',Boolean(error));
  }
  let recoverTimer = null;
  $('recoveryBackButton')?.addEventListener('click', () => {
    recoveryToken=null; $('recoveryForm').reset(); $('recoveryForm').hidden=true; $('loginForm').hidden=false; $('recoverPasswordButton').hidden=false; $('resendArea').hidden=false; message('새 재설정 메일을 요청하거나 로그인해 주세요.');
  });
  $('recoverPasswordButton')?.addEventListener('click', async event => {
    const email = $('email'), button = event.target;
    if (button.disabled) return;
    if (!email?.value.trim() || !email.checkValidity()) { message('이메일 입력란에 가입한 이메일을 입력해 주세요.', true); email?.focus(); return; }
    button.disabled = true;
    const startCooldown = seconds => {
      const until = Date.now() + seconds * 1000;
      const update = () => { const left = Math.max(0, Math.ceil((until - Date.now()) / 1000)); button.disabled = left > 0; button.textContent = left ? `재설정 메일 (${left}초 후)` : '비밀번호를 잊으셨나요?'; if (!left) { clearInterval(recoverTimer); recoverTimer = null; } };
      recoverTimer = setInterval(update, 1000); update();
    };
    try { const data = await api('/api/auth', { method:'POST', body:JSON.stringify({ action:'recover', email:email.value }) }); message(data.message); startCooldown(data.retryAfter || 60); }
    catch (error) { message(error.message, true); if (error.status === 429) startCooldown(error.retryAfter || 60); }
    finally { if (!recoverTimer) button.disabled = false; }
  });
  $('recoveryForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    if ($('newPassword').value !== $('newPasswordConfirm').value) return message('비밀번호가 일치하지 않습니다.', true);
    if (!recoveryToken) return message('새 비밀번호 재설정 메일을 요청해 주세요.', true);
    const button = event.target.querySelector('button[type=submit]'); if (button.disabled) return; button.disabled = true;
    try {
      const data = await api('/api/auth', {method:'POST',body:JSON.stringify({action:'reset-password',accessToken:recoveryToken,password:$('newPassword').value})});
      recoveryToken = null; event.target.reset(); event.target.hidden = true; $('loginForm').hidden = false; $('recoverPasswordButton').hidden = false;
      auth.user=null; auth.error=null; renderNav();
      message(data.message);
    } catch (error) { message(error.message + ' 링크가 만료됐다면 로그인 화면에서 새 재설정 메일을 요청해 주세요.', true); }
    finally { button.disabled = false; }
  });
  for (const action of ['login','signup']) {
    $(action+'Form')?.addEventListener('submit',async event => {
      event.preventDefault();
      if (action==='signup' && $('password').value!==$('passwordConfirm').value) return message('비밀번호가 일치하지 않습니다.',true);
      const button=event.target.querySelector('button[type=submit]'); button.disabled=true; message('');
      try {
        const data=await api('/api/auth',{method:'POST',body:JSON.stringify({action,email:$('email').value,password:$('password').value,...(action==='signup'?{name:$('name').value}:{})})});
        $('password').value=''; if ($('passwordConfirm')) $('passwordConfirm').value='';
        if (data.requiresConfirmation) { message(data.message); if($('resendArea'))$('resendArea').hidden=false; return; }
        location.replace(data.user.isAdmin ? '/admin.html' : (next || '/'));
      } catch(error) { message(error.message,true); if(error.code==='email_not_confirmed' && $('resendArea'))$('resendArea').hidden=false; }
      finally { button.disabled=false; }
    });
  }
  let resendTimer=null;
  function cooldown(seconds) {
    const button=$('resendEmailButton'); if(!button)return;
    if(resendTimer)clearInterval(resendTimer);
    const until=Date.now()+Math.max(1,seconds)*1000;
    const update=()=>{const remaining=Math.max(0,Math.ceil((until-Date.now())/1000));button.disabled=remaining>0;button.textContent=remaining?`인증 메일 재발송 (${remaining}초 후)`:'인증 메일 다시 받기';if(!remaining){clearInterval(resendTimer);resendTimer=null;}};
    resendTimer=setInterval(update,1000);update();
  }
  $('resendEmailButton')?.addEventListener('click',async event=>{
    const email=$('email');
    if(!email?.value.trim() || !email.checkValidity()){message('이메일 입력란에 가입한 이메일을 정확히 입력해 주세요.',true);email?.focus();return;}
    const button=event.target;if(button.disabled)return;button.disabled=true;
    try {const data=await api('/api/auth',{method:'POST',body:JSON.stringify({action:'resend',email:email.value})});message(data.message);cooldown(data.retryAfter||60);}
    catch(error){message(error.message,true);if(error.status===429)cooldown(error.retryAfter||60);}
    finally{if(!resendTimer)button.disabled=false;}
  });
  let receipts=[];
  let receiptPage=1, receiptRequest=0;
  const localDateTime = value => { if(!value)return '';const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
  const supplementsView = values => (values || []).map(item=>`<div class="receipt-result"><strong>추가 제출 · ${esc(date(item.submittedAt))}</strong><br>${esc(item.text)}</div>`).join('');
  function pager(prefix, pagination) {
    $(prefix+'Prev').disabled=pagination.page<=1;
    $(prefix+'Next').disabled=!pagination.hasNext;
    $(prefix+'Page').textContent=pagination.page+'페이지';
  }
  function receiptActions(c) {
    const editable=['접수','보완요청'].includes(c.processStatus);
    return `${c.processStatus==='보완요청'?`<form class="receipt-action-form" data-complaint-action="supplement" data-id="${esc(c.id)}"><label>보완 내용<textarea name="text" class="form-textarea" required maxlength="2000" rows="3" placeholder="담당자가 요청한 추가 내용을 입력해 주세요."></textarea></label><button class="btn-primary" type="submit">보완 내용 제출</button><p class="admin-mini">제출하면 처리 중으로 변경됩니다. 첨부파일은 지원하지 않습니다.</p></form>`:''}${editable?`<details class="receipt-options"><summary>예약 변경·취소</summary><form class="receipt-action-form" data-complaint-action="reschedule" data-id="${esc(c.id)}"><label>상담 희망 일시<input name="preferredAt" type="datetime-local" class="text-input" required step="60" min="${localDateTime(Date.now()+60000)}" max="${localDateTime(Date.now()+90*86400000)}" value="${localDateTime(c.preferredAt)}"></label><button class="btn-secondary" type="submit">희망 일시 변경</button><p class="admin-mini">기기 시간 기준 · 담당자 협의 후 확정됩니다.</p></form><button type="button" class="btn-secondary" data-cancel-complaint="${esc(c.id)}">예약 취소</button></details>`:''}`;
  }
  function receiptView(c) {
    return `<article class="receipt-card"><div class="receipt-top"><span class="receipt-no">${esc(c.complaintNo)}</span>${badge(c.processStatus)}</div>${c.isOverdue?`<p class="account-message error">처리 예정일(${esc(c.dueDate)})이 지났습니다. 담당자에게 확인해 주세요.</p>`:''}<h3 style="white-space:pre-line">${esc(c.summary)}</h3><p class="receipt-meta">${esc(c.deptName)} · ${esc(c.consultType)}<br>접수 ${date(c.createdAt)} · 담당자 ${esc(c.officerName)}${c.preferredAt ? '<br>상담 희망 '+esc(date(c.preferredAt))+' (협의 후 확정)' : ''}${c.dueDate ? '<br>처리 예정일 '+esc(c.dueDate) : ''}</p><p class="receipt-result">${esc(c.result || '담당자 확인을 기다리고 있어요.')}</p>${supplementsView(c.supplements)}${receiptActions(c)}${c.processStatus==='접수'?`<details class="receipt-options"><summary>상담 내용·방식·연락처 수정</summary><form class="receipt-action-form" data-complaint-action="edit" data-id="${esc(c.id)}"><label>상담 방식<select class="form-select" name="consultType">${['전화상담','방문상담','채팅상담'].map(value=>`<option ${value===c.consultType?'selected':''}>${value}</option>`).join('')}</select></label><label>연락처<input class="text-input" name="citizenTel" value="${esc(c.citizenTel || auth.user?.phone || '')}" maxlength="30" required></label><label>상담 내용<textarea class="form-textarea" name="summary" maxlength="2000" rows="3" required>${esc(c.summary)}</textarea></label><button type="submit" class="btn-primary">수정 내용 저장</button></form></details>`:''}</article>`;
  }
  function renderReceipts() {
    $('myReceipts').innerHTML=receipts.map(receiptView).join('') || '<div class="account-empty">접수 내역 또는 검색 결과가 없어요.<br><a href="/?tab=chat">민원 상담 시작하기 →</a></div>';
    restoreForms($('myReceipts'));
  }
  async function loadReceipts() {
    const version=++receiptRequest;
    $('receiptPrev').disabled=true; $('receiptNext').disabled=true;
    $('receiptLoadError').hidden=true;$('myReceipts').setAttribute('aria-busy','true');
    try {
      const data=await api('/api/lookup?'+new URLSearchParams({page:String(receiptPage),q:$('receiptFilter').value.trim(),status:$('receiptStatus').value}));
      if(version!==receiptRequest)return;
      receipts=data.complaints; renderReceipts(); pager('receipt',data.pagination);
    } catch(error) { if(version===receiptRequest)listError('receipt',error); }
    finally {if(version===receiptRequest)$('myReceipts').setAttribute('aria-busy','false');}
  }
  let ticketVersion=0,ticketMutation=false;
  async function loadTickets() {
    const version=++ticketVersion;
    try {
      const data=await api('/api/counters?mine=1');
      if(version!==ticketVersion)return;
      $('myTickets').innerHTML=data.tickets.map(t=>`<article class="receipt-card"><div class="receipt-top"><h3>${esc(data.counters.find(c=>c.id===t.counter_id)?.counterName || '창구')}</h3>${badge(t.status)}</div><p class="receipt-meta">내 번호 <strong>${t.ticket_no}번</strong> · 발급 ${date(t.created_at)}</p>${t.status==='대기'?`<button type="button" class="btn-secondary" data-cancel-ticket="${t.id}">번호표 취소</button>`:''}</article>`).join('') || '<p class="account-empty">현재 대기 중인 번호표가 없어요.</p>';
      $('myTicketStatus').textContent='마지막 확인 '+date(Date.now())+' · 30초마다 확인합니다.';
    } catch(error) { if(version===ticketVersion)$('myTicketStatus').textContent=error.message+' 이전 번호표를 표시하고 있어요. 새로고침으로 다시 확인해 주세요.'; }
  }
  if (document.body.dataset.page==='mypage') (async()=>{
    if (!await protectedPage()) return;
    $('memberContent').hidden=false; $('welcomeName').textContent=(auth.user.name||'회원')+'님, 반가워요';
    $('profileEmail').value=auth.user.email; $('profileName').value=auth.user.name; $('profilePhone').value=auth.user.phone;
    const receiptQuery=new URLSearchParams(location.search);
    $('receiptFilter').value=(receiptQuery.get('q')||receiptQuery.get('no')||'').trim().slice(0,100);
    await Promise.all([loadReceipts(),loadTickets()]);
    if(location.hash==='#receipts')$('receipts')?.scrollIntoView?.({block:'start'});
    $('myTickets')?.addEventListener('click',async event=>{
      const button=event.target.closest('[data-cancel-ticket]'); if(!button)return;
      if(button.disabled||ticketMutation)return;button.disabled=true;ticketMutation=true;ticketVersion++;
      try {await api('/api/counters',{method:'POST',body:JSON.stringify({action:'cancel',ticketId:button.dataset.cancelTicket})});message('대기 번호표를 취소했어요.');await loadTickets();}
      catch(error){message(error.message,true);await loadTickets();}
      finally{button.disabled=false;ticketMutation=false;}
    });
    let searchTimer;
    $('receiptFilter').addEventListener('input',()=>{clearTimeout(searchTimer);$('receiptPrev').disabled=true;$('receiptNext').disabled=true;searchTimer=setTimeout(()=>{receiptPage=1;loadReceipts();},300);});
    $('receiptStatus').addEventListener('change',()=>{clearTimeout(searchTimer);receiptPage=1;loadReceipts();});
    $('receiptRetry').addEventListener('click',loadReceipts);
    $('myReceipts').addEventListener('input',rememberForm);
    $('myReceipts').addEventListener('change',rememberForm);
    $('receiptPrev').addEventListener('click',()=>{if(receiptPage>1){receiptPage--;loadReceipts();}});
    $('receiptNext').addEventListener('click',()=>{receiptPage++;loadReceipts();});
    $('myReceipts').addEventListener('submit',async event=>{
      const form=event.target.closest('[data-complaint-action]'); if(!form)return;event.preventDefault();
      const button=form.querySelector('button');if(button.disabled)return;button.disabled=true;
      try {
        const body={id:form.dataset.id,action:form.dataset.complaintAction,...Object.fromEntries(new FormData(form))};
        if(body.preferredAt)body.preferredAt=new Date(body.preferredAt).toISOString();
        const key=formKey(form);
        await api(body.action==='edit'?'/api/lookup':'/api/complaints',{method:'PATCH',body:JSON.stringify(mutationBody(key,body))});
        actionRequests.delete(key);formDrafts.delete(key);
        message(body.action==='supplement'?'보완 내용을 제출했어요.':body.action==='edit'?'상담 정보를 수정했어요.':'상담 희망 일시를 변경했어요.');await loadReceipts();
      } catch(error){message(error.message,true);}finally{button.disabled=false;}
    });
    $('myReceipts').addEventListener('click',async event=>{
      const button=event.target.closest('[data-cancel-complaint]');if(!button||button.disabled)return;
      if(!confirm('이 상담 예약을 취소할까요?'))return;
      button.disabled=true;
      const key=button.dataset.cancelComplaint+':cancel';
      try{await api('/api/complaints',{method:'PATCH',body:JSON.stringify(mutationBody(key,{id:button.dataset.cancelComplaint,action:'cancel'}))});actionRequests.delete(key);message('예약을 취소했어요.');await loadReceipts();}
      catch(error){message(error.message,true);}finally{button.disabled=false;}
    });
    $('refreshReceipts').addEventListener('click',()=>Promise.all([loadReceipts(),loadTickets()]));
    setInterval(()=>{if(!document.hidden&&!ticketMutation)loadTickets();},30000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!ticketMutation)loadTickets();});
    $('profileForm').addEventListener('submit',async event=>{
      event.preventDefault(); const button=event.target.querySelector('button');button.disabled=true;
      try { const data=await api('/api/auth',{method:'PATCH',body:JSON.stringify({name:$('profileName').value,phone:$('profilePhone').value})}); auth.user=data.user;$('welcomeName').textContent=data.user.name+'님, 반가워요'; message('내 정보를 저장했어요.'); }
      catch(error) { message(error.message,true); } finally {button.disabled=false;}
    });
  })();
  let adminRows=[], adminPage=1, adminRequest=0;
  const counterOperations=new Map();
  let counterReadVersion=0;
  function renderAdminReceipts() {
    $('adminReceipts').innerHTML=adminRows.map(c=>`<article class="receipt-card"><div class="receipt-top"><span class="receipt-no">${esc(c.complaint_no)}</span>${badge(c.process_status)}</div><h3 style="white-space:pre-line">${esc(c.summary)}</h3><p class="receipt-meta">${esc(c.citizen_name)} · ${esc(c.citizen_tel)} · ${esc(c.dept_name)} · ${esc(c.consult_type)}<br>${date(c.created_at)}${c.preferred_at?'<br>상담 희망 '+esc(date(c.preferred_at))+' (협의 후 확정)':''}</p>${supplementsView(c.supplements)}${c.due_date?`<p class="receipt-meta">처리 예정일 ${esc(c.due_date)}</p>`:''}${c.process_status==='취소'?'<p class="admin-mini">사용자가 취소한 접수입니다.</p>':`<form class="admin-form" data-receipt-id="${esc(c.id)}" data-updated-at="${esc(c.updated_at)}"><div class="form-field"><label>처리 상태<select class="form-select" name="status">${['접수','처리중','보완요청','완료'].map(s=>`<option ${s===c.process_status?'selected':''}>${s}</option>`).join('')}</select></label></div><div class="form-field"><label>담당자<input class="text-input" name="officer" maxlength="50" value="${esc(c.officer_name)}" placeholder="담당자 이름"></label></div><div class="form-field"><label>처리 예정일<input class="text-input" type="date" name="dueDate" value="${esc(c.due_date || '')}"></label></div><div class="form-field"><label>사전 검토 메모<input class="text-input" name="reviewMemo" maxlength="200" placeholder="담당자 검토 메모"></label></div><div class="form-field span-all"><label>안내·처리 결과<textarea name="result" class="form-textarea" maxlength="2000" rows="2">${esc(c.result)}</textarea></label></div><button class="btn-primary span-all">변경 내용 저장</button><p class="admin-mini span-all" role="status"></p></form>`}</article>`).join('') || '<p class="account-empty">접수 내역 또는 검색 결과가 없습니다.</p>';
    restoreForms($('adminReceipts'));
  }
  function renderLeaderDashboard(data) {
    const el = $('adminLeaderReport');
    if (!el) return;
    const a = data.analytics || {};
    const deptEntries = Object.entries(a.byDepartment || {});
    const typeEntries = Object.entries(a.byConsultType || {});
    const dateEntries = a.byDate || [];
    const clusters = a.lowConfidenceClusters || [];
    el.innerHTML = `
      <div class="metrics-row" style="margin-bottom:8px;">
        <div class="gov-metric-card"><div class="gov-metric-lbl">챗봇 자체 완결률</div><div class="gov-metric-val">${a.selfResolveRate ?? 0}%</div><p class="admin-mini">자체완결 ${a.selfResolvedCount ?? 0}건 / 이관 ${a.transferredCount ?? 0}건</p></div>
        <div class="gov-metric-card"><div class="gov-metric-lbl">야간·공휴일 24시 응대</div><div class="gov-metric-val">${a.nightHolidayCount ?? 0}건</div><p class="admin-mini">일과시간(09~18시) 외 인입</p></div>
        <div class="gov-metric-card"><div class="gov-metric-lbl">기존 기록의 모델 참고 점수</div><div class="gov-metric-val">${a.avgConfidence>0?`${a.avgConfidence}점`:'미산출'}</div><p class="admin-mini">정답률이 아닙니다. 새 안내는 승인 자료와의 연결 여부를 확인합니다.</p></div>
        <div class="gov-metric-card"><div class="gov-metric-lbl">법정기한 경과(재안내 대상)</div><div class="gov-metric-val">${a.overdueCount ?? 0}건</div><p class="admin-mini">처리기한 경과 미결 민원</p></div>
      </div>
      ${a.surgeDetected ? `<div style="padding:12px 14px;background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;border-radius:6px;font-size:0.88rem;"><b>🚨 [민원 급증 자동 감지 경보]</b> 직전 주기 대비 민원 접수량이 2배 이상 급증했습니다. 창구 인력 재배치 및 빈출 질의 지식베이스 갱신을 권장합니다.</div>` : ''}
      <div class="receipt-card">
        <h3>🔍 미해결·저확신 질의 키워드 군집 및 오답 위험 모니터링</h3>
        <p class="admin-mini" style="margin-bottom:12px;">기존 저점수 기록 또는 담당자 상담 연결 질의에서 추출한 키워드입니다. 동일 키워드가 2건 이상 반복되면 지식 누락 경보가 표시됩니다.</p>
        ${clusters.length ? `<div style="display:grid;gap:8px;">${clusters.map(item => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:${item.needsKnowledgeUpdate ? '#fff1f2' : '#f8fafc'};border:1px solid ${item.needsKnowledgeUpdate ? '#fecdd3' : '#e2e8f0'};border-radius:6px;">
            <div>
              <strong>#${esc(item.keyword)}</strong> <span class="status-badge">${item.count}건 이관</span>
              ${item.needsKnowledgeUpdate ? `<span class="status-badge" style="background:#ffe4e6;color:#be123c;margin-left:6px;">⚠️ 반복 이관 · 지식베이스 보완 권장</span>` : ''}
              <p class="admin-mini" style="margin-top:4px;">대표 질의: "${esc(item.sampleQuery)}"</p>
            </div>
            <button type="button" class="btn-secondary" data-draft-knowledge="${esc(item.keyword)}" data-sample-query="${esc(item.sampleQuery)}">지식베이스 추가 →</button>
          </div>
        `).join('')}</div>` : '<p class="account-empty">현재 저확신 이관 질의 군집이 없습니다.</p>'}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;">
        <div class="receipt-card">
          <h3>🏛️ 소관 부서별 민원 이관 분포</h3>
          ${deptEntries.length ? `<div style="display:grid;gap:6px;margin-top:10px;">${deptEntries.map(([dept, cnt]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;"><span>${esc(dept)}</span><strong>${cnt}건</strong></div>`).join('')}</div>` : '<p class="account-empty">집계된 부서별 접수 건이 없습니다.</p>'}
        </div>
        <div class="receipt-card">
          <h3>📞 상담 채널·방식별 선호도</h3>
          ${typeEntries.length ? `<div style="display:grid;gap:6px;margin-top:10px;">${typeEntries.map(([t, cnt]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;"><span>${esc(t)}</span><strong>${cnt}건</strong></div>`).join('')}</div>` : '<p class="account-empty">집계된 상담 방식 데이터가 없습니다.</p>'}
        </div>
        <div class="receipt-card">
          <h3>📅 일자별 민원 접수 추이 (최근 7일)</h3>
          ${dateEntries.length ? `<div style="display:grid;gap:6px;margin-top:10px;">${dateEntries.map(d => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;"><span>${esc(d.date)}</span><strong>${d.count}건</strong></div>`).join('')}</div>` : '<p class="account-empty">집계된 일자별 데이터가 없습니다.</p>'}
        </div>
      </div>
    `;
  }
  async function loadAdminKnowledges() {
    const container = $('adminKnowledges');
    if (!container) return;
    try {
      const data = await api('/api/admin');
      const rows = data.knowledges || [];
      container.innerHTML = rows.map(k => `<article class="receipt-card"><div class="receipt-top"><span class="receipt-no">[#${k.id}] ${esc(k.category_code || '일반행정')}</span>${badge(k.approval_status || '승인완료')}</div><h3>${esc(k.title)}</h3><p class="receipt-result" style="white-space:pre-line;margin:8px 0;">${esc(k.content)}</p><p class="receipt-meta">구비서류: ${esc(k.required_docs || '해당없음')} · 수수료: ${esc(k.fee || '해당없음')}${k.revised_at ? ' · 제·개정일: '+esc(k.revised_at) : ''}</p></article>`).join('') || '<p class="account-empty">등록된 행정지식베이스 항목이 없습니다. 위 양식에서 첫 지식을 등록해 보세요.</p>';
    } catch {
      container.innerHTML = '<p class="account-empty">행정지식베이스 목록을 불러오지 못했습니다.</p>';
    }
  }
  async function loadAdmin() {
    const version=++adminRequest;
    $('adminPrev').disabled=true;$('adminNext').disabled=true;
    $('adminLoadError').hidden=true;$('adminReceipts').setAttribute('aria-busy','true');
    try {
      const data=await api('/api/stats?'+new URLSearchParams({page:String(adminPage),q:$('adminFilter').value.trim(),status:$('adminStatus').value}));
      if(version!==adminRequest)return;
      adminRows=data.complaints;pager('admin',data.pagination);
      $('adminMetrics').innerHTML=[['전체 접수',data.summary.totalComplaints],['접수 대기',data.summary.pending],['처리 중·보완',data.summary.processing],['처리 완료',data.summary.completed],['취소',data.summary.cancelled ?? 0]].map(([label,value])=>`<div class="gov-metric-card"><div class="gov-metric-lbl">${label}</div><div class="gov-metric-val">${value}건</div></div>`).join('');
      renderAdminReceipts();
      $('adminChats').innerHTML=data.recentSessions.map(c=>`<article class="receipt-card"><div class="receipt-top"><p class="receipt-meta">${date(c.created_at)}</p>${badge(c.status)}</div><h3>${esc(c.query)}</h3><details class="receipt-options"><summary>답변 보기</summary><p class="receipt-result">${esc(c.answer || '저장된 답변이 없습니다.')}</p></details></article>`).join('')||'<p class="account-empty">저장된 상담 기록이 없습니다.</p>';
      renderLeaderDashboard(data);
      Promise.all([loadAdminCounters(),loadAdminKnowledges()]).catch(error=>message(error.message,true));
    } catch(error) { if(version===adminRequest)listError('admin',error); }
    finally{if(version===adminRequest)$('adminReceipts').setAttribute('aria-busy','false');}
  }
  async function loadAdminCounters() {
    const version=++counterReadVersion;
    const data=await api('/api/counters');
    if(version!==counterReadVersion)return;
    const crowded = data.counters.filter(c => c.isCrowded);
    if ($('adminCounterAlert')) {
      $('adminCounterAlert').innerHTML = crowded.length
        ? `<div style="padding:12px;background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;border-radius:6px;font-size:0.86rem;"><b>🚨 [창구 과밀 경보]</b> 혼잡 기준(10명) 초과 창구: <b>${crowded.map(c => `${esc(c.orgName)} ${esc(c.counterName)}(대기 ${c.waitingCount}명)`).join(', ')}</b> — 현장 지원 인력 탄력 배치가 필요합니다.</div>`
        : '';
    }
    $('adminCounters').innerHTML=data.counters.map(c=>`<article class="admin-counter-card"><div class="receipt-top"><h3>${esc(c.orgName)} · ${esc(c.counterName)}</h3>${badge(c.isOpen?(c.isCrowded?'혼잡(인력지원필요)':'운영 중'):'운영 중지')}</div><p class="admin-mini">${esc(c.location)}</p><div class="admin-counter-numbers"><span>호출 <strong>${c.currentCallingNo ?? '—'}</strong>번</span><span>대기 <strong>${c.waitingCount}</strong>명${c.estimatedWaitMinutes!=null?` (예상 ${c.estimatedWaitMinutes}분 · 1건 5분 가정)`:""}</span></div><div class="counter-actions"><button class="btn-primary" data-counter-action="next" data-id="${c.id}" data-updated-at="${esc(c.updatedAt)}" ${c.isOpen&&!counterOperations.get(c.id)?.busy?'':'disabled'}>${counterOperations.has(c.id)?'호출 결과 다시 확인':'다음 번호 호출'}</button><button class="btn-secondary" data-counter-action="toggle" data-id="${c.id}" data-open="${!c.isOpen}">${c.isOpen?'운영 중지':'운영 시작'}</button></div><p class="counter-update">마지막 변경 ${date(c.updatedAt)}</p></article>`).join('') || '<p class="account-empty">등록된 창구가 없습니다. 위에서 실제 운영할 창구를 등록해 주세요.</p>';
  }
  if (document.body.dataset.page==='admin') (async()=>{
    if (!await protectedPage(true)) return;
    $('adminContent').hidden=false; await loadAdmin();
    $('refreshAdmin').addEventListener('click',loadAdmin);
    let searchTimer;
    $('adminFilter').addEventListener('input',()=>{clearTimeout(searchTimer);$('adminPrev').disabled=true;$('adminNext').disabled=true;searchTimer=setTimeout(()=>{adminPage=1;loadAdmin();},300);});
    $('adminStatus').addEventListener('change',()=>{clearTimeout(searchTimer);adminPage=1;loadAdmin();});
    $('adminRetry').addEventListener('click',loadAdmin);
    $('adminReceipts').addEventListener('input',rememberForm);
    $('adminReceipts').addEventListener('change',rememberForm);
    $('adminPrev').addEventListener('click',()=>{if(adminPage>1){adminPage--;loadAdmin();}});
    $('adminNext').addEventListener('click',()=>{adminPage++;loadAdmin();});
    document.querySelectorAll('[data-admin-tab]').forEach(button=>button.addEventListener('click',()=>{
      document.querySelectorAll('[data-admin-tab]').forEach(b=>{const selected=b===button;b.setAttribute('aria-pressed',String(selected));$('admin-'+b.dataset.adminTab).hidden=!selected;});
    }));
    $('adminLeaderReport')?.addEventListener('click', event => {
      const btn = event.target.closest('[data-draft-knowledge]');
      if (!btn) return;
      const kw = btn.dataset.draftKnowledge || '';
      const sq = btn.dataset.sampleQuery || '';
      const tabBtn = document.querySelector('[data-admin-tab="knowledge"]');
      tabBtn?.click();
      if ($('knowledgeTitle')) $('knowledgeTitle').value = sq || `${kw} 관련 민원 처리 절차 안내`;
      if ($('knowledgeKeywords')) $('knowledgeKeywords').value = kw;
      $('knowledgeContent')?.focus();
    });
    $('knowledgeForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const button = event.target.querySelector('button[type=submit]');
      if (button) button.disabled = true;
      try {
        await api('/api/admin', {
          method: 'POST',
          body: JSON.stringify({
            action: 'knowledge',
            knowledgeId: $('knowledgeId')?.value || undefined,
            categoryCode: $('knowledgeCategory')?.value,
            title: $('knowledgeTitle')?.value,
            content: $('knowledgeContent')?.value,
            requiredDocs: $('knowledgeDocs')?.value,
            fee: $('knowledgeFee')?.value,
            keywords: $('knowledgeKeywords')?.value,
          }),
        });
        event.target.reset();
        message('행정지식베이스 갱신안을 승인하고 반영했어요.');
        await loadAdminKnowledges();
      } catch (error) { message(error.message, true); }
      finally { if (button) button.disabled = false; }
    });
    $('adminReceipts').addEventListener('submit',async event=>{
      const form=event.target.closest('[data-receipt-id]'); if (!form) return;event.preventDefault();
      const button=form.querySelector('button');button.disabled=true;
      try {await api('/api/admin',{method:'PATCH',body:JSON.stringify({id:form.dataset.receiptId,updatedAt:form.dataset.updatedAt,...Object.fromEntries(new FormData(form))})});formDrafts.delete(formKey(form));message('처리 상태를 저장했어요.');await loadAdmin();}
      catch(error){form.querySelector('[role=status]').textContent=error.message;}finally{button.disabled=false;}
    });
    $('counterForm').addEventListener('submit',async event=>{
      event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
      try {await api('/api/counters',{method:'POST',body:JSON.stringify({action:'create',orgName:$('orgName').value,counterName:$('counterName').value,location:$('counterLocation').value})});event.target.reset();await loadAdminCounters();message('창구를 등록했어요.');}
      catch(error){message(error.message,true);}finally{button.disabled=false;}
    });
    $('adminCounters').addEventListener('click',async event=>{
      const button=event.target.closest('[data-counter-action]');if(!button||button.disabled)return;
      const id=button.dataset.id,action=button.dataset.counterAction;
      if(action==='next'&&counterOperations.get(id)?.busy)return;
      button.disabled=true;
      let pending;
      if(action==='next'){
        pending=counterOperations.get(id)||{requestId:crypto.randomUUID(),updatedAt:button.dataset.updatedAt};
        pending.busy=true;counterOperations.set(id,pending);counterReadVersion++;
      }
      try {
        await api('/api/counters',{method:'PATCH',body:JSON.stringify({action,counterId:id,isOpen:button.dataset.open==='true',...(pending?{requestId:pending.requestId,updatedAt:pending.updatedAt}:{})})});
        if(pending)counterOperations.delete(id);
        message(action==='next'?'다음 번호 호출을 처리했어요.':'창구 운영 상태를 변경했어요.');
        await loadAdminCounters().catch(error=>message('변경은 처리됐지만 최신 현황을 확인하지 못했어요. '+error.message,true));
      } catch(error){
        if(pending&&error.status===409)counterOperations.delete(id);
        message(error.message+(pending&&error.status!==409?' 호출 결과 다시 확인을 누르면 같은 요청의 결과를 확인합니다.':''),true);
        if(pending)pending.busy=false;
        if(error.status===409)await loadAdminCounters().catch(()=>{});
        else if(pending)button.textContent='호출 결과 다시 확인';
      } finally{if(pending)pending.busy=false;button.disabled=false;}
    });
    setInterval(()=>{if(!document.hidden)loadAdminCounters().catch(error=>message(error.message,true));},30000);
  })();
})();
