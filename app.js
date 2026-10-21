const form = document.querySelector('#chat-form');
const input = document.querySelector('#message');
const messages = document.querySelector('#messages');
const status = document.querySelector('#status');
const send = document.querySelector('#send');
const newChat = document.querySelector('#new-chat');
const suggestions = document.querySelector('#suggestions');
let history = [];
let busy = false;
let saved = 0;
let generated = 0;

function appendMessage(role, text, result) {
  const article = document.createElement('article'); article.className = `message ${role}`;
  const name = document.createElement('div'); name.className = 'message-name'; name.textContent = role === 'user' ? '나' : '민원 길잡이';
  const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = text;
  article.append(name, bubble);
  if (result?.source === 'gemini') {
    const badge = document.createElement('div'); badge.className = 'badge gemini'; badge.textContent = 'AI 참고 안내'; article.append(badge);
  }
  if (result?.sources?.length) {
    const refs = document.createElement('div'); refs.className = 'references';
    const title = document.createElement('span'); title.textContent = '공식 확인 창구'; refs.append(title);
    for (const source of result.sources) {
      let url; try { url = new URL(source.url); } catch { continue; }
      if (url.protocol !== 'https:' || !['www.gov.kr', 'www.epeople.go.kr', 'www.safetyreport.go.kr'].includes(url.hostname)) continue;
      const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `${source.title} ↗`; refs.append(link);
    }
    article.append(refs);
  }
  messages.append(article); messages.scrollTop = messages.scrollHeight;
  return article;
}
function welcome() {
  appendMessage('assistant', '안녕하세요, 민원 길잡이입니다.\n민원 신청 방법과 공식 확인 창구를 안내해 드려요.\n\n어떤 민원이 궁금하신가요? 지역과 민원 종류를 함께 알려주시면 더 도움이 돼요.');
}
function setBusy(value) {
  busy = value; send.disabled = value; newChat.disabled = value; input.readOnly = value;
  for (const button of suggestions.querySelectorAll('button')) button.disabled = value;
  send.textContent = value ? '답변 중' : '보내기';
}
function boundedHistory(message) {
  let recent = history.slice(-6);
  while (recent.length && (recent.reduce((sum, turn) => sum + turn.text.length, 0) > 12000 || new TextEncoder().encode(JSON.stringify({ message, history: recent })).length > 19000)) recent = recent.slice(2);
  return recent;
}
input.addEventListener('input', () => { document.querySelector('#length').textContent = `${input.value.length.toLocaleString('ko-KR')} / 1,000`; });
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!busy && input.value.trim()) form.requestSubmit(); }
});
newChat.addEventListener('click', () => {
  history = []; saved = 0; generated = 0;
  messages.replaceChildren(); welcome(); status.textContent = ''; input.value = '';
  document.querySelector('#saved-count').textContent = '0회'; document.querySelector('#ai-count').textContent = '0회';
  input.dispatchEvent(new Event('input')); input.focus();
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (busy || !message) return;
  appendMessage('user', message); input.value = ''; input.dispatchEvent(new Event('input'));
  setBusy(true); status.textContent = '답변을 준비하고 있어요…';
  const thinking = appendMessage('assistant thinking', '질문을 확인하고 있어요…');
  try {
    const response = await fetch('/api/guide', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: boundedHistory(message) }), signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || '답변을 받지 못했어요. 다시 질문해 주세요.');
    thinking.remove(); appendMessage('assistant', result.answer, result);
    history.push({ role: 'user', text: message }, { role: 'model', text: result.answer });
    if (result.savedCall) saved++; else generated++;
    document.querySelector('#saved-count').textContent = `${saved}회`;
    document.querySelector('#ai-count').textContent = `${generated}회`;
    status.textContent = result.source === 'gemini' ? 'AI 안내의 세부 내용은 공식 창구에서 확인해 주세요.' : '';
  } catch (error) {
    thinking.remove(); appendMessage('error', error.name === 'TimeoutError' ? '답변 시간이 초과됐어요. 잠시 후 다시 질문해 주세요.' : error.message);
    input.value = message; input.dispatchEvent(new Event('input')); status.textContent = '질문을 다시 보내거나 자주 묻는 질문을 이용해 주세요.';
  } finally { setBusy(false); input.focus(); }
});
welcome();
async function initialize() {
  try {
    const response = await fetch('/api/guide', { signal: AbortSignal.timeout(5000) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error('Configuration unavailable');
    document.querySelector('#connection').textContent = data.geminiConfigured ? '기본 안내 + AI 추가 답변 이용 가능' : '기본 안내 이용 가능 · AI 추가 답변 준비 중';
    suggestions.replaceChildren();
    for (const { question } of data.suggestions) {
      const button = document.createElement('button'); button.className = 'suggestion'; button.type = 'button'; button.textContent = question;
      button.disabled = busy;
      button.addEventListener('click', () => { if (!busy) { input.value = question; input.dispatchEvent(new Event('input')); form.requestSubmit(); } });
      suggestions.append(button);
    }
  } catch {
    document.querySelector('#connection').textContent = '연결 상태를 확인해 주세요.';
    suggestions.replaceChildren();
    const text = document.createElement('p'); text.className = 'hint'; text.textContent = '질문 목록을 불러오지 못했어요. 아래에서 다시 시도해 주세요.';
    const retry = document.createElement('button'); retry.className = 'secondary'; retry.type = 'button'; retry.textContent = '목록 다시 불러오기'; retry.addEventListener('click', initialize);
    suggestions.append(text, retry);
  }
}
initialize();
