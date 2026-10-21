(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  const date = value => value ? new Date(value).toLocaleString('ko-KR') : '미정';
  const badge = value => `<span class="status-badge ${value === '완료' ? 'done' : ''}">${esc(value)}</span>`;
  function message(text, error = false) { const el = $('accountMessage'); if (el) { el.textContent = text; el.classList.toggle('error',error); } }
  async function api(path, options = {}) {
    const response = await fetch(path, {...options, headers:{'Content-Type':'application/json',...options.headers},cache:'no-store'});
    const data = await response.json();
    if (!response.ok || !data.ok) { const e = new Error(data.message || '요청을 처리하지 못했어요.'); e.status=response.status; throw e; }
    return data;
  }
  function safeNext() {
    const input = new URLSearchParams(location.search).get('next');
    if (!input || !input.startsWith('/')) return null;
    try { const url = new URL(input,location.origin); return url.origin===location.origin && !['/login.html','/signup.html'].includes(url.pathname) ? url.pathname+url.search+url.hash : null; } catch { return null; }
  }
  function loginUrl(next = location.pathname+location.search) { return ['/login.html','/signup.html'].includes(location.pathname) && next === location.pathname+location.search ? '/login.html' : '/login.html?next='+encodeURIComponent(next); }
  const auth = window.portalAuth = { user:null, ready:null, api, loginUrl };
  function renderNav() {
    const el = $('accountNav'); if (!el) return;
    el.innerHTML = auth.user
      ? `<a href="/mypage.html">마이페이지</a>${auth.user.isAdmin ? '<a href="/admin.html">관리자</a>' : ''}<button type="button" id="logoutButton">로그아웃</button>`
      : `<a href="${esc(loginUrl())}">로그인</a><a href="/signup.html">회원가입</a>`;
    $('logoutButton')?.addEventListener('click', async event => {
      event.target.disabled=true;
      try { await api('/api/auth',{method:'POST',body:JSON.stringify({action:'logout'})}); location.replace('/login.html'); }
      catch(error) { message(error.message,true); alert(error.message); event.target.disabled=false; }
    });
  }
  auth.ready = api('/api/auth').then(data => { auth.user=data.user; renderNav(); return data.user; }).catch(error => { renderNav(); message(error.message,true); return null; });
  async function protectedPage(admin = false) {
    await auth.ready;
    if (!auth.user) { location.replace(loginUrl()); return false; }
    if (admin && !auth.user.isAdmin) { message('관리자만 이용할 수 있는 페이지입니다.',true); return false; }
    return true;
  }
  const next = safeNext();
  if ($('signupLink') && next) $('signupLink').href='/signup.html?next='+encodeURIComponent(next);
  if ($('loginLink') && next) $('loginLink').href=loginUrl(next);
  // Supabase's default confirmation email may return fragment tokens. Do not persist them in browser storage.
  if (location.hash.includes('access_token=') || location.hash.includes('error=')) {
    const error = new URLSearchParams(location.hash.slice(1)).get('error_description');
    history.replaceState(null,'',location.pathname+location.search);
    message(error ? '이메일 인증 링크가 만료되었거나 올바르지 않습니다.' : '이메일 인증을 완료했어요. 이메일과 비밀번호로 로그인해 주세요.',Boolean(error));
  }
  for (const action of ['login','signup']) {
    $(action+'Form')?.addEventListener('submit',async event => {
      event.preventDefault();
      if (action==='signup' && $('password').value!==$('passwordConfirm').value) return message('비밀번호가 일치하지 않습니다.',true);
      const button=event.target.querySelector('button[type=submit]'); button.disabled=true; message('');
      try {
        const data=await api('/api/auth',{method:'POST',body:JSON.stringify({action,email:$('email').value,password:$('password').value,...(action==='signup'?{name:$('name').value}:{})})});
        $('password').value=''; if ($('passwordConfirm')) $('passwordConfirm').value='';
        if (data.requiresConfirmation) { message(data.message); return; }
        location.replace(next || (data.user.isAdmin ? '/admin.html' : '/mypage.html'));
      } catch(error) { message(error.message,true); }
      finally { button.disabled=false; }
    });
  }
  let receipts=[];
  function receiptView(c) {
    return `<article class="receipt-card"><div class="receipt-top"><span class="receipt-no">${esc(c.complaintNo)}</span>${badge(c.processStatus)}</div><h3>${esc(c.summary)}</h3><p class="receipt-meta">${esc(c.deptName)} · ${esc(c.consultType)}<br>접수 ${date(c.createdAt)} · 담당자 ${esc(c.officerName)}${c.dueDate ? '<br>처리 예정일 '+esc(c.dueDate) : ''}</p><p class="receipt-result">${esc(c.result || '담당자 확인을 기다리고 있어요.')}</p></article>`;
  }
  function renderReceipts() {
    const q=$('receiptFilter').value.trim().toLowerCase();
    const rows=receipts.filter(c=>(c.complaintNo+' '+c.summary).toLowerCase().includes(q));
    $('myReceipts').innerHTML=rows.map(receiptView).join('') || '<div class="account-empty">접수 내역이 없어요.<br><a href="/?tab=chat">민원 상담 시작하기 →</a></div>';
  }
  async function loadReceipts() {
    try { receipts=(await api('/api/lookup')).complaints; renderReceipts(); }
    catch(error) { $('myReceipts').textContent=error.message; }
  }
  async function loadTickets() {
    try {
      const data=await api('/api/counters?mine=1');
      $('myTickets').innerHTML=data.tickets.map(t=>`<article class="receipt-card"><div class="receipt-top"><h3>${esc(data.counters.find(c=>c.id===t.counter_id)?.counterName || '창구')}</h3>${badge(t.status)}</div><p class="receipt-meta">내 번호 <strong>${t.ticket_no}번</strong> · 발급 ${date(t.created_at)}</p></article>`).join('') || '<p class="account-empty">현재 대기 중인 번호표가 없어요.</p>';
    } catch(error) { $('myTickets').textContent=error.message; }
  }
  if (document.body.dataset.page==='mypage') (async()=>{
    if (!await protectedPage()) return;
    $('memberContent').hidden=false; $('welcomeName').textContent=(auth.user.name||'회원')+'님, 반가워요';
    $('profileEmail').value=auth.user.email; $('profileName').value=auth.user.name; $('profilePhone').value=auth.user.phone;
    await Promise.all([loadReceipts(),loadTickets()]);
    $('receiptFilter').addEventListener('input',renderReceipts);
    $('refreshReceipts').addEventListener('click',()=>Promise.all([loadReceipts(),loadTickets()]));
    $('profileForm').addEventListener('submit',async event=>{
      event.preventDefault(); const button=event.target.querySelector('button');button.disabled=true;
      try { const data=await api('/api/auth',{method:'PATCH',body:JSON.stringify({name:$('profileName').value,phone:$('profilePhone').value})}); auth.user=data.user;$('welcomeName').textContent=data.user.name+'님, 반가워요'; message('내 정보를 저장했어요.'); }
      catch(error) { message(error.message,true); } finally {button.disabled=false;}
    });
  })();
  let adminRows=[];
  function renderAdminReceipts() {
    const q=$('adminFilter').value.trim().toLowerCase();
    $('adminReceipts').innerHTML=adminRows.filter(c=>(c.complaint_no+' '+c.citizen_name+' '+c.summary).toLowerCase().includes(q)).map(c=>`<article class="receipt-card"><div class="receipt-top"><span class="receipt-no">${esc(c.complaint_no)}</span>${badge(c.process_status)}</div><h3>${esc(c.summary)}</h3><p class="receipt-meta">${esc(c.citizen_name)} · ${esc(c.citizen_tel)} · ${esc(c.dept_name)} · ${esc(c.consult_type)}<br>${date(c.created_at)}</p><form class="admin-form" data-receipt-id="${esc(c.id)}"><div class="form-field"><label>처리 상태<select class="form-select" name="status">${['접수','처리중','보완요청','완료'].map(s=>`<option ${s===c.process_status?'selected':''}>${s}</option>`).join('')}</select></label></div><div class="form-field"><label>담당자<input class="text-input" name="officer" maxlength="50" value="${esc(c.officer_name)}" placeholder="담당자 이름"></label></div><div class="form-field span-all"><label>안내·처리 결과<textarea name="result" class="form-textarea" maxlength="2000" rows="2">${esc(c.result)}</textarea></label></div><button class="btn-primary span-all">변경 내용 저장</button><p class="admin-mini span-all" role="status"></p></form></article>`).join('') || '<p class="account-empty">접수 내역이 없습니다.</p>';
  }
  async function loadAdmin() {
    try {
      const data=await api('/api/stats'); adminRows=data.complaints;
      $('adminMetrics').innerHTML=[['전체 접수',data.summary.totalComplaints],['접수 대기',data.summary.pending],['처리 중·보완',data.summary.processing],['처리 완료',data.summary.completed]].map(([label,value])=>`<div class="gov-metric-card"><div class="gov-metric-lbl">${label}</div><div class="gov-metric-val">${value}건</div></div>`).join('');
      renderAdminReceipts();
      $('adminChats').innerHTML=data.recentSessions.map(c=>`<article class="receipt-card"><div class="receipt-top"><p class="receipt-meta">${date(c.created_at)}</p>${badge(c.status)}</div><h3>${esc(c.query)}</h3></article>`).join('')||'<p class="account-empty">저장된 상담 기록이 없습니다.</p>';
      await loadAdminCounters();
    } catch(error) { message(error.message,true); }
  }
  async function loadAdminCounters() {
    const data=await api('/api/counters');
    $('adminCounters').innerHTML=data.counters.map(c=>`<article class="admin-counter-card"><div class="receipt-top"><h3>${esc(c.orgName)} · ${esc(c.counterName)}</h3>${badge(c.isOpen?'운영 중':'운영 중지')}</div><p class="admin-mini">${esc(c.location)}</p><div class="admin-counter-numbers"><span>호출 <strong>${c.currentCallingNo ?? '—'}</strong>번</span><span>대기 <strong>${c.waitingCount}</strong>명</span></div><div class="counter-actions"><button class="btn-primary" data-counter-action="next" data-id="${c.id}" ${c.isOpen?'':'disabled'}>다음 번호 호출</button><button class="btn-secondary" data-counter-action="toggle" data-id="${c.id}" data-open="${!c.isOpen}">${c.isOpen?'운영 중지':'운영 시작'}</button></div><p class="counter-update">마지막 변경 ${date(c.updatedAt)}</p></article>`).join('') || '<p class="account-empty">등록된 창구가 없습니다. 위에서 실제 운영할 창구를 등록해 주세요.</p>';
  }
  if (document.body.dataset.page==='admin') (async()=>{
    if (!await protectedPage(true)) return;
    $('adminContent').hidden=false; await loadAdmin();
    $('refreshAdmin').addEventListener('click',loadAdmin);
    $('adminFilter').addEventListener('input',renderAdminReceipts);
    document.querySelectorAll('[data-admin-tab]').forEach(button=>button.addEventListener('click',()=>{
      document.querySelectorAll('[data-admin-tab]').forEach(b=>{const selected=b===button;b.setAttribute('aria-pressed',String(selected));$('admin-'+b.dataset.adminTab).hidden=!selected;});
    }));
    $('adminReceipts').addEventListener('submit',async event=>{
      const form=event.target.closest('[data-receipt-id]'); if (!form) return;event.preventDefault();
      const button=form.querySelector('button');button.disabled=true;
      try {await api('/api/admin',{method:'PATCH',body:JSON.stringify({id:form.dataset.receiptId,...Object.fromEntries(new FormData(form))})});message('처리 상태를 저장했어요.');await loadAdmin();}
      catch(error){form.querySelector('[role=status]').textContent=error.message;}finally{button.disabled=false;}
    });
    $('counterForm').addEventListener('submit',async event=>{
      event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
      try {await api('/api/counters',{method:'POST',body:JSON.stringify({action:'create',orgName:$('orgName').value,counterName:$('counterName').value,location:$('counterLocation').value})});event.target.reset();await loadAdminCounters();message('창구를 등록했어요.');}
      catch(error){message(error.message,true);}finally{button.disabled=false;}
    });
    $('adminCounters').addEventListener('click',async event=>{
      const button=event.target.closest('[data-counter-action]');if(!button)return;button.disabled=true;
      try {await api('/api/counters',{method:'PATCH',body:JSON.stringify({action:button.dataset.counterAction,counterId:button.dataset.id,isOpen:button.dataset.open==='true'})});await loadAdminCounters();}
      catch(error){message(error.message,true);}finally{button.disabled=false;}
    });
    setInterval(()=>{if(!document.hidden)loadAdminCounters().catch(error=>message(error.message,true));},30000);
  })();
})();
