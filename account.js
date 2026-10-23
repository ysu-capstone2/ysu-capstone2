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
  function loginUrl(next = location.pathname+location.search) { return ['/login.html','/signup.html'].includes(location.pathname) && next === location.pathname+location.search ? '/login.html' : '/login.html?next='+encodeURIComponent(next); }
  const auth = window.portalAuth = { user:null, ready:null, error:null, api, loginUrl, notify:message };
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
      try { await api('/api/auth',{method:'POST',body:JSON.stringify({action:'logout'})}); location.replace('/login.html'); }
      catch(error) { message(error.message,true); alert(error.message); event.target.disabled=false; }
    });
  }
  auth.ready = api('/api/auth').then(data => { auth.user=data.user; renderNav(); return data.user; }).catch(error => { auth.error=error; renderNav(); message(error.message,true); return null; });
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
  // Supabase's default confirmation email may return fragment tokens. Do not persist them in browser storage.
  if (/access_token=|error=|error_code=/.test(location.hash)) {
    const fragment = new URLSearchParams(location.hash.slice(1));
    const error = fragment.has('error') || fragment.has('error_code');
    history.replaceState(null,'',location.pathname+location.search);
    if(error && $('resendArea'))$('resendArea').hidden=false;
    message(error ? '링크가 만료되었거나 이미 사용됐어요. 이미 인증했다면 로그인해 주세요. 인증하지 못했다면 새 메일을 요청하고 가장 최근 링크만 눌러 주세요.' : '이메일 인증을 완료했어요. 이메일과 비밀번호로 로그인해 주세요.',Boolean(error));
  }
  for (const action of ['login','signup']) {
    $(action+'Form')?.addEventListener('submit',async event => {
      event.preventDefault();
      if (action==='signup' && $('password').value!==$('passwordConfirm').value) return message('비밀번호가 일치하지 않습니다.',true);
      const button=event.target.querySelector('button[type=submit]'); button.disabled=true; message('');
      try {
        const data=await api('/api/auth',{method:'POST',body:JSON.stringify({action,email:$('email').value,password:$('password').value,...(action==='signup'?{name:$('name').value}:{})})});
        $('password').value=''; if ($('passwordConfirm')) $('passwordConfirm').value='';
        if (data.requiresConfirmation) { message(data.message); if($('resendArea'))$('resendArea').hidden=false; return; }
        location.replace(data.user.isAdmin ? '/admin.html' : (next || '/mypage.html'));
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
  function receiptView(c) {
    const canEdit = c.processStatus === '접수';
    const canSupplement = c.processStatus === '보완요청';
    return `<article class="receipt-card"><div class="receipt-top"><span class="receipt-no">${esc(c.complaintNo)}</span>${badge(c.processStatus)}</div>${c.isOverdue ? `<div style="padding:8px 10px;margin:8px 0;background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;border-radius:6px;font-size:0.82rem;"><b>⏰ [처리기한 경과 자동 재안내]</b> 법정 처리기한(${esc(c.dueDate)})이 경과하여 담당 부서에서 우선 검토 중입니다.</div>` : ''}<h3 style="white-space:pre-line">${esc(c.summary)}</h3><p class="receipt-meta">${esc(c.deptName)} · ${esc(c.consultType)}${c.citizenTel ? ' · '+esc(c.citizenTel) : ''}<br>접수 ${date(c.createdAt)} · 담당자 ${esc(c.officerName)}${c.dueDate ? '<br>처리 예정일 '+esc(c.dueDate) : ''}</p><p class="receipt-result" style="white-space:pre-line">${esc(c.result || '담당자 확인을 기다리고 있어요.')}</p>${canSupplement ? `<form class="admin-form" data-supplement-id="${esc(c.id)}" style="margin-top:12px;"><div class="form-field span-all"><label>보완 자료 및 추가 설명 등록 (프로세스 16)<textarea name="supplement" class="form-textarea" rows="2" required maxlength="800" placeholder="담당자가 요청한 추가 사실관계나 증빙 내용을 입력해 주세요."></textarea></label></div><button class="btn-primary span-all" type="submit">보완 내용 제출하기</button></form>` : ''}${canEdit ? `<details style="margin-top:12px;"><summary style="cursor:pointer;font-size:0.85rem;font-weight:700;color:var(--gov-blue);">상담 내용·일정·방식 수정 또는 예약 취소 (프로세스 07~09)</summary><form class="admin-form" data-edit-receipt="${esc(c.id)}" style="margin-top:10px;"><div class="form-field"><label>상담 방식 변경<select class="form-select" name="consultType">${['전화상담','방문상담','채팅상담'].map(t=>`<option ${t===c.consultType?'selected':''}>${t}</option>`).join('')}</select></label></div><div class="form-field"><label>연락처 수정<input class="text-input" name="citizenTel" value="${esc(c.citizenTel || auth.user?.phone || '')}" maxlength="30" required></label></div><div class="form-field span-all"><label>상담 내용 및 희망 일시 수정<textarea class="form-textarea" name="summary" rows="2" maxlength="2000" required>${esc(c.summary)}</textarea></label></div><div class="counter-actions span-all"><button class="btn-primary" type="submit">수정 내용 저장</button><button class="btn-secondary" type="button" data-cancel-receipt="${esc(c.id)}">상담 예약·접수 취소</button></div></form></details>` : ''}</article>`;
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
      $('myTickets').innerHTML=data.tickets.map(t=>`<article class="receipt-card"><div class="receipt-top"><h3>${esc(data.counters.find(c=>c.id===t.counter_id)?.counterName || '창구')}</h3>${badge(t.status)}</div><p class="receipt-meta">내 번호 <strong>${t.ticket_no}번</strong> · 발급 ${date(t.created_at)}</p>${t.status==='대기'?`<button type="button" class="btn-secondary" data-cancel-ticket="${t.id}">번호표 취소</button>`:''}</article>`).join('') || '<p class="account-empty">현재 대기 중인 번호표가 없어요.</p>';
    } catch(error) { $('myTickets').textContent=error.message; }
  }
  if (document.body.dataset.page==='mypage') (async()=>{
    if (!await protectedPage()) return;
    $('memberContent').hidden=false; $('welcomeName').textContent=(auth.user.name||'회원')+'님, 반가워요';
    $('profileEmail').value=auth.user.email; $('profileName').value=auth.user.name; $('profilePhone').value=auth.user.phone;
    await Promise.all([loadReceipts(),loadTickets()]);
    $('myTickets')?.addEventListener('click',async event=>{
      const button=event.target.closest('[data-cancel-ticket]'); if(!button)return;
      button.disabled=true;
      try {await api('/api/counters',{method:'POST',body:JSON.stringify({action:'cancel',ticketId:button.dataset.cancelTicket})});message('대기 번호표를 취소했어요.');await loadTickets();}
      catch(error){message(error.message,true);await loadTickets();}
      finally{button.disabled=false;}
    });
    $('myReceipts')?.addEventListener('submit',async event=>{
      const editForm=event.target.closest('[data-edit-receipt]');
      const suppForm=event.target.closest('[data-supplement-id]');
      if(!editForm && !suppForm) return;
      event.preventDefault();
      const form = editForm || suppForm;
      const button = form.querySelector('button[type=submit]');
      if(button) button.disabled=true;
      try {
        const fd = Object.fromEntries(new FormData(form));
        const payload = editForm
          ? { action:'edit', id:editForm.dataset.editReceipt, ...fd }
          : { action:'supplement', id:suppForm.dataset.supplementId, ...fd };
        const res = await api('/api/lookup',{method:'PATCH',body:JSON.stringify(payload)});
        message(res.message || '변경 사항을 반영했어요.');
        await loadReceipts();
      } catch(error) { message(error.message,true); }
      finally { if(button) button.disabled=false; }
    });
    $('myReceipts')?.addEventListener('click',async event=>{
      const cancelBtn=event.target.closest('[data-cancel-receipt]');
      if(!cancelBtn) return;
      cancelBtn.disabled=true;
      try {
        const res = await api('/api/lookup',{method:'PATCH',body:JSON.stringify({action:'cancel',id:cancelBtn.dataset.cancelReceipt})});
        message(res.message || '접수를 취소했어요.');
        await loadReceipts();
      } catch(error) { message(error.message,true); }
      finally { cancelBtn.disabled=false; }
    });
    $('receiptFilter')?.addEventListener('input',renderReceipts);
    $('refreshReceipts')?.addEventListener('click',()=>Promise.all([loadReceipts(),loadTickets()]));
    $('profileForm')?.addEventListener('submit',async event=>{
      event.preventDefault(); const button=event.target.querySelector('button');button.disabled=true;
      try { const data=await api('/api/auth',{method:'PATCH',body:JSON.stringify({name:$('profileName').value,phone:$('profilePhone').value})}); auth.user=data.user;$('welcomeName').textContent=data.user.name+'님, 반가워요'; message('내 정보를 저장했어요.'); }
      catch(error) { message(error.message,true); } finally {button.disabled=false;}
    });
  })();
  let adminRows=[];
  function renderAdminReceipts() {
    const q=$('adminFilter').value.trim().toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    $('adminReceipts').innerHTML=adminRows.filter(c=>(c.complaint_no+' '+c.citizen_name+' '+c.summary).toLowerCase().includes(q)).map(c=>{
      const lines = String(c.summary || '').split('\n');
      const aiLine = lines.find(l => l.includes('[AI 대화 요약]')) || '';
      const mainSummary = lines.filter(l => !l.includes('[AI 대화 요약]')).join('\n');
      const isOverdue = Boolean(c.due_date && c.due_date < today && c.process_status !== '완료');
      return `<article class="receipt-card"><div class="receipt-top"><span class="receipt-no">${esc(c.complaint_no)}</span>${badge(c.process_status)}</div>${isOverdue ? `<div style="padding:6px 10px;margin:6px 0;background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;border-radius:4px;font-size:0.8rem;font-weight:700;">⏰ 법정 처리기한(${esc(c.due_date)}) 초과 — 처리 예정일 재산정 및 안내 필요 (프로세스 06-E1)</div>` : ''}<h3 style="white-space:pre-line">${esc(mainSummary || c.summary)}</h3>${aiLine ? `<div style="padding:10px 12px;margin:8px 0;background:#f0f9ff;border:1px solid #bae6fd;border-left:4px solid #0284c7;border-radius:4px;font-size:0.84rem;color:#0c4a6e;"><b>🤖 AI 대화 요약본 및 사전 맥락 (프로세스 08 / FR-3)</b><br>${esc(aiLine)}</div>` : ''}<p class="receipt-meta">${esc(c.citizen_name)} · ${esc(c.citizen_tel)} · ${esc(c.dept_name)} · ${esc(c.consult_type)}<br>접수일 ${date(c.created_at)}${c.due_date ? ' · 법정처리기한 '+esc(c.due_date) : ''}</p><form class="admin-form" data-receipt-id="${esc(c.id)}"><div class="form-field"><label>처리 상태<select class="form-select" name="status">${['접수','처리중','보완요청','완료'].map(s=>`<option ${s===c.process_status?'selected':''}>${s}</option>`).join('')}</select></label></div><div class="form-field"><label>담당 주무관<input class="text-input" name="officer" maxlength="50" value="${esc(c.officer_name)}" placeholder="예: 정민우 주무관"></label></div><div class="form-field"><label>처리 예정일 (법정기한 관리)<input class="text-input" type="date" name="dueDate" value="${esc(c.due_date || '')}"></label></div><div class="form-field"><label>사전 검토 메모 (대응 시나리오)<input class="text-input" name="reviewMemo" maxlength="200" placeholder="상담 전 법령·쟁점 체크 메모"></label></div><div class="form-field span-all"><label>사실관계 검토 · 보완 요구 · 최종 처리 결과 (프로세스 11·12)<textarea name="result" class="form-textarea" maxlength="2000" rows="2">${esc(c.result)}</textarea></label></div><button class="btn-primary span-all">변경 내용 저장 및 통보</button><p class="admin-mini span-all" role="status"></p></form></article>`;
    }).join('') || '<p class="account-empty">접수 내역이 없습니다.</p>';
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
        <div class="gov-metric-card"><div class="gov-metric-lbl">챗봇 자체 완결률 (프로세스 13)</div><div class="gov-metric-val">${a.selfResolveRate ?? 0}%</div><p class="admin-mini">자체완결 ${a.selfResolvedCount ?? 0}건 / 이관 ${a.transferredCount ?? 0}건</p></div>
        <div class="gov-metric-card"><div class="gov-metric-lbl">야간·공휴일 24시 응대</div><div class="gov-metric-val">${a.nightHolidayCount ?? 0}건</div><p class="admin-mini">일과시간(09~18시) 외 인입</p></div>
        <div class="gov-metric-card"><div class="gov-metric-lbl">평균 RAG 검색 신뢰도</div><div class="gov-metric-val">${a.avgConfidence ?? 0}점</div><p class="admin-mini">65점 미만 시 자동 담당자 이관</p></div>
        <div class="gov-metric-card"><div class="gov-metric-lbl">법정기한 경과(재안내 대상)</div><div class="gov-metric-val">${a.overdueCount ?? 0}건</div><p class="admin-mini">처리기한 경과 미결 민원</p></div>
      </div>
      ${a.surgeDetected ? `<div style="padding:12px 14px;background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;border-radius:6px;font-size:0.88rem;"><b>🚨 [민원 급증 자동 감지 경보 (프로세스 16-E1)]</b> 직전 주기 대비 민원 접수량이 2배 이상 급증했습니다. 창구 인력 재배치 및 빈출 질의 지식베이스 갱신을 권장합니다.</div>` : ''}
      <div class="receipt-card">
        <h3>🔍 미해결·저확신 질의 키워드 군집 및 오답 위험 모니터링 (프로세스 14-E1)</h3>
        <p class="admin-mini" style="margin-bottom:12px;">신뢰도 기준치(65점) 미달 또는 담당자 이관 질의에서 자동 추출된 키워드 군집입니다. 동일 키워드가 2건 이상 반복되면 지식 누락 경보가 표시됩니다.</p>
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
          <h3>🏛️ 소관 부서별 민원 이관 분포 (프로세스 16)</h3>
          ${deptEntries.length ? `<div style="display:grid;gap:6px;margin-top:10px;">${deptEntries.map(([dept, cnt]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;"><span>${esc(dept)}</span><strong>${cnt}건</strong></div>`).join('')}</div>` : '<p class="account-empty">집계된 부서별 접수 건이 없습니다.</p>'}
        </div>
        <div class="receipt-card">
          <h3>📞 상담 채널·방식별 선호도 (FR-2)</h3>
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
    try {
      const data=await api('/api/stats'); adminRows=data.complaints;
      $('adminMetrics').innerHTML=[['전체 접수',data.summary.totalComplaints],['접수 대기',data.summary.pending],['처리 중·보완',data.summary.processing],['처리 완료',data.summary.completed]].map(([label,value])=>`<div class="gov-metric-card"><div class="gov-metric-lbl">${label}</div><div class="gov-metric-val">${value}건</div></div>`).join('');
      renderAdminReceipts();
      $('adminChats').innerHTML=data.recentSessions.map(c=>`<article class="receipt-card"><div class="receipt-top"><p class="receipt-meta">${date(c.created_at)} · 신뢰도 <strong>${c.confidence_score ?? 'FAQ'}</strong>${c.confidence_score != null ? '점' : ''}</p>${badge(c.status)}</div><h3>${esc(c.query)}</h3>${c.answer ? `<p class="receipt-result" style="margin-top:8px;white-space:pre-line;">${esc(c.answer)}</p>` : ''}</article>`).join('')||'<p class="account-empty">저장된 상담 기록이 없습니다.</p>';
      renderLeaderDashboard(data);
      await Promise.all([loadAdminCounters(), loadAdminKnowledges()]);
    } catch(error) { message(error.message,true); }
  }
  async function loadAdminCounters() {
    const data=await api('/api/counters');
    const crowded = data.counters.filter(c => c.isCrowded);
    if ($('adminCounterAlert')) {
      $('adminCounterAlert').innerHTML = crowded.length
        ? `<div style="padding:12px;background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;border-radius:6px;font-size:0.86rem;"><b>🚨 [창구 과밀 경보 (프로세스 15-E1)]</b> 혼잡 기준(10명) 초과 창구: <b>${crowded.map(c => `${esc(c.orgName)} ${esc(c.counterName)}(대기 ${c.waitingCount}명)`).join(', ')}</b> — 현장 지원 인력 탄력 배치가 필요합니다.</div>`
        : '';
    }
    $('adminCounters').innerHTML=data.counters.map(c=>`<article class="admin-counter-card"><div class="receipt-top"><h3>${esc(c.orgName)} · ${esc(c.counterName)}</h3>${badge(c.isOpen?(c.isCrowded?'혼잡(인력지원필요)':'운영 중'):'운영 중지')}</div><p class="admin-mini">${esc(c.location)}</p><div class="admin-counter-numbers"><span>호출 <strong>${c.currentCallingNo ?? '—'}</strong>번</span><span>대기 <strong>${c.waitingCount}</strong>명 (예상 ${(c.estimatedWaitMinutes ?? c.waitingCount * 5)}분)</span></div><div class="counter-actions"><button class="btn-primary" data-counter-action="next" data-id="${c.id}" ${c.isOpen?'':'disabled'}>다음 번호 호출</button><button class="btn-secondary" data-counter-action="toggle" data-id="${c.id}" data-open="${!c.isOpen}">${c.isOpen?'운영 중지':'운영 시작'}</button></div><p class="counter-update">마지막 변경 ${date(c.updatedAt)}</p></article>`).join('') || '<p class="account-empty">등록된 창구가 없습니다. 위에서 실제 운영할 창구를 등록해 주세요.</p>';
  }
  if (document.body.dataset.page==='admin') (async()=>{
    if (!await protectedPage(true)) return;
    $('adminContent').hidden=false; await loadAdmin();
    $('refreshAdmin').addEventListener('click',loadAdmin);
    $('adminFilter').addEventListener('input',renderAdminReceipts);
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
