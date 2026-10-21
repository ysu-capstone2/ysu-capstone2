import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatService } from '../lib/chat-service.js';
import { findFaq } from '../data/faq.js';
import handler, { validateMessage } from '../api/guide.js';

const good = (text = '공식 안내 창구에서 민원 종류와 지역을 확인해 주세요.') => ({
  ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] }),
});
function setup(options = {}) {
  let calls = 0;
  let last;
  const env = { GEMINI_API_KEY: 'test-secret-key', GEMINI_DAILY_LIMIT: '100', GEMINI_MINUTE_LIMIT: '100', ...options.env };
  const service = createChatService({
    ...options, env,
    fetchImpl: async (...args) => { calls++; last = args; return options.fetchImpl ? options.fetchImpl(...args) : good(); },
  });
  return { ...service, calls: () => calls, request: () => last };
}
const question = { message: '소음 민원을 준비할 때 어떤 내용을 적으면 좋을까요', sessionId: 'session-a' };

test('FAQ replies do not call Gemini and work without a key', async () => {
  const service = setup({ env: { GEMINI_API_KEY: '' } });
  const reply = await service.answer({ message: '민원 신청 방법?', sessionId: 'a' });
  assert.equal(reply.source, 'faq'); assert.equal(reply.savedCall, true);
  assert.ok(reply.sources.length); assert.equal(service.calls(), 0);
});

test('FAQ matching does not confuse cancellation, negation, multiple intents, or specific document requests', () => {
  for (const text of ['민원 신청 취소 방법', '민원 신청 방법 말고 취소 방법', '민원 신청 방법과 취소 방법', '여권 민원 신청 필요 서류', '그럼 필요한 서류는?']) assert.equal(findFaq(text), undefined);
});

test('unmatched questions require a Gemini key without making an external request', async () => {
  const service = setup({ env: { GEMINI_API_KEY: '' } });
  await assert.rejects(service.answer(question), (error) => error.status === 503);
  assert.equal(service.calls(), 0);
});

test('same question is cached and a consecutive repeated question reuses original context', async () => {
  const service = setup();
  const first = await service.answer(question);
  assert.equal(first.source, 'gemini');
  const again = await service.answer({ ...question, message: `${question.message}?` });
  assert.equal(again.source, 'cache');
  const history = [{ role: 'user', text: question.message }, { role: 'model', text: first.answer }];
  assert.equal((await service.answer({ ...question, history })).source, 'cache');
  assert.equal(service.calls(), 1);
  const [url, request] = service.request();
  assert.ok(!url.includes('test-secret-key'));
  assert.equal(request.headers['x-goog-api-key'], 'test-secret-key');
  assert.equal(JSON.parse(request.body).generationConfig.maxOutputTokens, 768);
  assert.ok(!JSON.stringify(again).includes('test-secret-key'));
});

test('cache is separated by user session, conversation context, and model', async () => {
  const env = { GEMINI_API_KEY: 'test', GEMINI_MODEL: 'gemini-3.1-flash-lite', GEMINI_MINUTE_LIMIT: '100' };
  const service = createChatService({ env, fetchImpl: async () => good() });
  assert.equal((await service.answer(question)).source, 'gemini');
  assert.equal((await service.answer({ ...question, sessionId: 'session-b' })).source, 'gemini');
  const history = [{ role: 'user', text: '서울의 도로 문제입니다' }, { role: 'model', text: '어떤 문제인가요?' }];
  assert.equal((await service.answer({ ...question, history })).source, 'gemini');
  env.GEMINI_MODEL = 'another-valid-model';
  assert.equal((await service.answer(question)).source, 'gemini');
});

test('cache expires and has a bounded capacity', async () => {
  let now = 1800000000000;
  const service = setup({ now: () => now, ttlMs: 1000, maxEntries: 1 });
  await service.answer(question);
  assert.equal((await service.answer(question)).source, 'cache');
  now += 1001;
  assert.equal((await service.answer(question)).source, 'gemini');
  await service.answer({ ...question, message: '다른 민원에 관한 질문입니다' });
  assert.equal((await service.answer(question)).source, 'gemini');
});

test('simultaneous identical requests are sent to Gemini once', async () => {
  let release;
  const service = setup({ fetchImpl: () => new Promise((resolve) => { release = resolve; }) });
  const a = service.answer(question);
  const b = service.answer(question);
  release(good());
  const replies = await Promise.all([a, b]);
  assert.equal(service.calls(), 1);
  assert.deepEqual(replies.map((reply) => reply.source), ['gemini', 'cache']);
});

test('potential identifiers are not cached', async () => {
  const service = setup();
  const input = { ...question, message: '연락처 010-1234-5678은 어디에 적나요' };
  await service.answer(input);
  assert.equal((await service.answer(input)).source, 'gemini');
  assert.equal(service.calls(), 2);
});

test('daily budget stops new calls while cached replies and FAQ still work', async () => {
  const service = setup({ env: { GEMINI_DAILY_LIMIT: '1' } });
  await service.answer(question);
  assert.equal((await service.answer(question)).source, 'cache');
  await assert.rejects(service.answer({ ...question, message: '다른 민원 질문입니다' }), (error) => error.status === 429);
  assert.equal((await service.answer({ ...question, message: '민원 처리 기간' })).source, 'faq');
  assert.equal(service.calls(), 1);
});

test('zero budget disables generation and the daily budget resets on the next UTC day', async () => {
  const disabled = setup({ env: { GEMINI_DAILY_LIMIT: '0' } });
  await assert.rejects(disabled.answer(question), (error) => error.status === 429);
  assert.equal(disabled.calls(), 0);
  let now = Date.UTC(2026, 9, 21);
  const service = setup({ now: () => now, env: { GEMINI_DAILY_LIMIT: '1' } });
  await service.answer(question);
  now += 86400000;
  assert.equal((await service.answer(question)).source, 'gemini');
});

test('provider throttling is not retried automatically and errors do not leak secrets', async () => {
  const service = setup({ fetchImpl: async () => ({ ok: false, status: 429 }) });
  for (let i = 0; i < 2; i++) await assert.rejects(service.answer(question), (error) => error.status === 429 && !error.message.includes('test-secret-key'));
  assert.equal(service.calls(), 1);
});

test('truncated or blocked AI replies are not cached as completed answers', async () => {
  const service = setup({ fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '미완성' }] } }] }) }) });
  await assert.rejects(service.answer(question), (error) => error.status === 502);
  await assert.rejects(service.answer(question), (error) => error.status === 502);
  assert.equal(service.calls(), 2);
});

test('invalid keys and network failures return safe, actionable errors', async () => {
  const auth = setup({ fetchImpl: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(auth.answer(question), (error) => error.status === 503);
  const network = setup({ fetchImpl: async () => { throw new Error('contains test-secret-key'); } });
  await assert.rejects(network.answer(question), (error) => error.status === 502 && !error.message.includes('test-secret-key'));
});

test('message validation rejects oversized inputs and malformed history', () => {
  for (const body of [null, { message: '' }, { message: 'x'.repeat(1001) }, { message: '질문', history: [{ role: 'model', text: '답' }] }, { message: '질문', history: [{ role: 'user', text: '질문' }] }]) assert.throws(() => validateMessage(body));
  assert.equal(validateMessage({ message: ' 질문 ', history: [] }).message, '질문');
});

function response() { return { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } }; }
test('HTTP config never returns a key; FAQ POST sets a private session cookie', async () => {
  let res = response();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 200); assert.equal(res.data.suggestions.length, 7);
  assert.deepEqual(Object.keys(res.data).sort(), ['geminiConfigured', 'ok', 'suggestions']);
  res = response();
  await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { message: '민원 신청 방법' } }, res);
  assert.equal(res.code, 200); assert.equal(res.data.source, 'faq');
  assert.match(res.headers['Set-Cookie'], /HttpOnly; SameSite=Strict/);
});

test('HTTP endpoint rejects cross-origin requests, wrong media types, invalid JSON and large bodies', async () => {
  const cases = [
    [{ method: 'POST', headers: { origin: 'https://other.invalid', host: 'localhost:3000' } }, 403],
    [{ method: 'POST', headers: { 'content-type': 'text/plain' } }, 415],
    [{ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }, 400],
    [{ method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(20001) }, 413],
    [{ method: 'DELETE' }, 405],
  ];
  for (const [req, expected] of cases) { const res = response(); await handler(req, res); assert.equal(res.code, expected); }
});
