import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortalChatService } from '../lib/portal-chat.js';
import { createGeminiBudget } from '../lib/gemini-budget.js';
import { createChatService } from '../lib/chat-service.js';
import { createChatHandler } from '../api/chat.js';
import { generateCivilResponseWithGemini } from '../api/_gemini.js';

const knowledge = { id: 1, title: '주민등록등본', content: '공식 안내', category_code: '주민', required_docs: '확인된 서류', fee: '확인된 수수료' };
const generated = { matchedKnowledgeId: 1, confidenceScore: 90, isTransferred: false, title: '민원 답변', answer: '공식 안내를 확인해 주세요.', model: 'test-model' };
function setup(options = {}) {
  let calls = 0; let reserves = 0;
  const service = createPortalChatService({
    getKey: () => 'test-key', getModel: () => 'test-model',
    request: async (path) => path.startsWith('admin_knowledge') ? [knowledge] : [{ dept_code: 'D01' }],
    budget: { reserve() { reserves++; }, block() {} },
    ...options,
    generate: async (...args) => { calls++; return options.generate ? options.generate(...args) : { ...generated }; },
  });
  return { ...service, calls: () => calls, reserves: () => reserves };
}
const input = { message: '주민등록등본 발급 절차를 안내해 주세요', sessionId: 'browser-a' };

test('portal FAQ works when both Supabase and Gemini are unavailable', async () => {
  const service = setup({ getKey: () => '', request: async () => { throw new Error('DB unavailable'); } });
  const value = await service.answer({ ...input, message: '민원 신청 방법' });
  assert.equal(value.source, 'faq'); assert.equal(value.isTransferred, false);
  assert.equal(value.confidenceScore, null); assert.equal(service.calls(), 0);
});

test('complete knowledge title matches avoid Gemini while keeping legacy metadata', async () => {
  const service = setup();
  const value = await service.answer({ ...input, message: '주민등록등본' });
  assert.equal(value.source, 'knowledge'); assert.equal(value.knowledgeId, 1);
  assert.equal(value.requiredDocs, knowledge.required_docs); assert.equal(service.calls(), 0); assert.equal(service.reserves(), 0);
  assert.equal((await service.answer({ ...input, message: '주민등록등본 취소 방법' })).source, 'gemini');
});

test('portal cache avoids repeated generation and separates sessions', async () => {
  const service = setup();
  assert.equal((await service.answer(input)).source, 'gemini');
  assert.equal((await service.answer(input)).source, 'cache');
  assert.equal((await service.answer({ ...input, sessionId: 'browser-b' })).source, 'gemini');
  assert.equal(service.calls(), 2);
});

test('portal cache expires and does not retain questions containing identifiers', async () => {
  let now = 1800000000000;
  const service = setup({ now: () => now, ttlMs: 1000 });
  await service.answer(input); now += 1001;
  assert.equal((await service.answer(input)).source, 'gemini');
  const personal = { ...input, message: '주민등록등본 연락처 010-1234-5678 문의' };
  await service.answer(personal); await service.answer(personal);
  assert.equal(service.calls(), 4);
});

test('portal simultaneous duplicates generate once', async () => {
  let release;
  const service = setup({ generate: () => new Promise((resolve) => { release = resolve; }) });
  const a = service.answer(input);
  const b = service.answer(input);
  await Promise.resolve();
  release({ ...generated });
  const values = await Promise.all([a, b]);
  assert.equal(service.calls(), 1); assert.deepEqual(values.map((value) => value.source), ['gemini', 'cache']);
});

test('low-confidence answers retain department and consultation fields', async () => {
  const service = setup({ generate: async () => ({ ...generated, confidenceScore: 40, isTransferred: true }) });
  const value = await service.answer(input);
  assert.equal(value.isTransferred, true); assert.equal(value.departments[0].dept_code, 'D01');
  assert.equal(value.consultTypes.length, 3);
  assert.equal((await service.answer(input)).source, 'cache');
});

test('missing Gemini key falls back to a department and database failures stay actionable', async () => {
  const fallback = setup({ getKey: () => '' });
  assert.equal((await fallback.answer(input)).isTransferred, true); assert.equal(fallback.calls(), 0);
  const failed = setup({ request: async () => { throw new Error('private DB details'); } });
  await assert.rejects(failed.answer(input), (error) => error.status === 503 && !error.message.includes('private'));
});

test('a fresh empty knowledge base offers consultation without generating unsupported facts', async () => {
  const service = setup({ request: async () => [] });
  const value = await service.answer(input);
  assert.equal(value.isTransferred, true); assert.deepEqual(value.departments, []);
  assert.equal(service.calls(), 0); assert.equal(service.reserves(), 0);
});

test('provider errors are not cached or automatically retried', async () => {
  const service = setup({ generate: async () => { const error = new Error('test-key'); error.status = 429; throw error; } });
  await assert.rejects(service.answer(input), (error) => error.status === 429 && !error.message.includes('test-key'));
  assert.equal(service.calls(), 1);
});

test('both chat engines share the same Gemini generation budget', async () => {
  const env = { GEMINI_API_KEY: 'test', GEMINI_DAILY_LIMIT: '1' };
  const budget = createGeminiBudget({ env });
  const guide = createChatService({ env, budget, fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '안내' }] } }] }) }) });
  await guide.answer(input);
  const portal = setup({ budget });
  await assert.rejects(portal.answer(input), (error) => error.status === 429);
  assert.equal(portal.calls(), 0);
  assert.equal((await portal.answer({ ...input, message: '민원 신청 방법' })).source, 'faq');
});

function response() { return { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } }; }
const request = () => ({ method: 'POST', headers: { 'content-type': 'application/json', cookie: 'minwon_session=12345678-1234-1234-1234-123456789012' }, body: { query: input.message } });
test('portal HTTP query contract preserves fields and allocates fresh reservation session IDs on cache hits', async () => {
  let id = 0;
  const service = setup();
  const handler = createChatHandler({ service, request: async () => [{ id: ++id }] });
  const first = response(); const second = response();
  await handler(request(), first); await handler(request(), second);
  assert.equal(first.code, 200); assert.equal(second.data.source, 'cache');
  assert.equal(first.data.sessionId, 1); assert.equal(second.data.sessionId, 2);
  assert.equal(first.data.isTransferred, false); assert.equal(service.calls(), 1);
});

test('portal FAQ response survives a chat-session logging outage', async () => {
  const handler = createChatHandler({ service: setup(), request: async () => { throw new Error('outage'); } });
  const req = request(); req.body.query = '민원 처리 기간'; const res = response();
  await handler(req, res); assert.equal(res.code, 200); assert.equal(res.data.source, 'faq'); assert.equal(res.data.sessionId, null);
});

test('structured Gemini adapter uses one bounded REST call and retains the existing response shape', async (t) => {
  const previousKey = process.env.GEMINI_API_KEY; const previousModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = 'test-secret'; process.env.GEMINI_MODEL = 'gemini-3.1-flash-lite';
  t.after(() => {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = previousModel;
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++; assert.ok(url.endsWith(':generateContent')); assert.ok(!url.includes('test-secret'));
    const body = JSON.parse(options.body); assert.equal(body.generationConfig.maxOutputTokens, 1536);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(generated) }] } }] }) };
  });
  const result = await generateCivilResponseWithGemini(input.message, [knowledge]);
  assert.equal(result.answer, generated.answer); assert.equal(result.confidenceScore, 90); assert.equal(calls, 1);
});
