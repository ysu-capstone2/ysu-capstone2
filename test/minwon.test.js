import test from 'node:test';
import assert from 'node:assert/strict';

let version = 0;
async function setup(t, fetcher) {
  const previous = process.env.DATA_GO_KR_SERVICE_KEY;
  process.env.DATA_GO_KR_SERVICE_KEY = 'test-secret';
  t.after(() => {
    if (previous === undefined) delete process.env.DATA_GO_KR_SERVICE_KEY;
    else process.env.DATA_GO_KR_SERVICE_KEY = previous;
  });
  t.mock.method(globalThis, 'fetch', fetcher || (() => { throw new Error('Unexpected upstream request'); }));
  const { default: handler } = await import(`../api/minwon.js?test=${++version}`);
  return async (query, method = 'GET') => {
    const res = {
      headers: {}, setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; },
    };
    await handler({ method, url: `/api/minwon?${query}` }, res);
    return res;
  };
}
const jsonResponse = (body, ok = true) => ({ ok, text: async () => JSON.stringify(body) });
const query = 'type=pothole&from=2024-01-07&to=2024-01-07';

test('rejects invalid dates, reversed dates, and inclusive ranges above 15 days before any API request', async (t) => {
  const request = await setup(t);
  for (const value of [
    'from=2024-02-30&to=2024-03-01',
    'from=2024-01-09&to=2024-01-07',
    'from=2024-01-01&to=2024-01-16',
    'from=invalid&to=2024-01-07',
  ]) assert.equal((await request(value)).code, 400);
});

test('requires a keyword and institution for region queries and rejects unsupported methods', async (t) => {
  const request = await setup(t);
  assert.equal((await request('type=region&from=2024-01-07&to=2024-01-07')).code, 400);
  assert.equal((await request(`${query}&type=invalid`, 'POST')).code, 405);
});

test('reports a missing server key', async (t) => {
  const request = await setup(t);
  delete process.env.DATA_GO_KR_SERVICE_KEY;
  assert.equal((await request(query)).code, 503);
});

test('normalizes actual wrapped items, keeps key server-side, and caches duplicate queries', async (t) => {
  let calls = 0;
  const request = await setup(t, async (url) => {
    calls++;
    const params = new URL(url).searchParams;
    assert.equal(params.get('serviceKey'), 'test-secret');
    assert.equal(params.get('dateFrom'), '20240107');
    return jsonResponse({ header: { resultCode: '00' }, body: { totalCount: 1, items: [{ item: { create_dt: '20240107', event_lat: '37.1', event_lon: '127.1' } }] } });
  });
  const res = await request(query);
  assert.equal(res.code, 200);
  assert.deepEqual(res.data.items, [{ date: '20240107', latitude: 37.1, longitude: 127.1 }]);
  assert.ok(!JSON.stringify(res.data).includes('test-secret'));
  await request(query);
  assert.equal(calls, 1);
});

test('accepts exactly 15 inclusive days and handles empty results', async (t) => {
  const request = await setup(t, async () => jsonResponse({ header: { resultCode: '00' }, body: { totalCount: 0, items: [] } }));
  const res = await request('from=2024-01-01&to=2024-01-15');
  assert.equal(res.code, 200);
  assert.deepEqual(res.data.items, []);
  assert.equal(res.data.totalCount, 0);
});

test('encodes keyword queries and normalizes region responses', async (t) => {
  const request = await setup(t, async (url) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get('searchword'), '불법주차');
    assert.equal(params.get('mainSubCode'), '6410000');
    assert.equal(params.get('target'), 'pttn');
    return jsonResponse({ response: { header: { resultCode: '00' }, body: { totalCount: 1, items: { item: [{ label: '테스트 지역', hits: '12' }] } } } });
  });
  const res = await request('type=region&from=2024-01-07&to=2024-01-07&keyword=불법주차&institution=6410000');
  assert.equal(res.code, 200);
  assert.deepEqual(res.data.items, [{ region: '테스트 지역', count: 12 }]);
});

test('rejects provider business errors even on HTTP 200', async (t) => {
  const request = await setup(t, async () => jsonResponse({ header: { resultCode: '30', resultMsg: 'echoed test-secret' } }));
  const res = await request(query);
  assert.equal(res.code, 502);
  assert.ok(!JSON.stringify(res.data).includes('test-secret'));
});

test('handles XML quota errors and connection failures without leaking upstream content', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  const request = await setup(t, async () => {
    if (++calls === 1) return { ok: false, text: async () => '<returnReasonCode>22</returnReasonCode>test-secret' };
    throw new Error('network error with test-secret');
  });
  const xml = await request(query);
  assert.equal(xml.code, 502);
  assert.match(xml.data.message, /한도/);
  now += 62000;
  const network = await request(query);
  assert.equal(network.code, 502);
  assert.ok(!JSON.stringify([xml.data, network.data]).includes('test-secret'));
});

test('detects provider request throttling even when HTTP is 200', async (t) => {
  const request = await setup(t, async () => jsonResponse({ header: { resultMsg: '{code:200, msg:같은 인증키로 요청이 연속되어 잠시 제한되었습니다.}' } }));
  const res = await request(query);
  assert.equal(res.code, 429);
  assert.equal(res.headers['Retry-After'], '61');
});

test('prevents a second distinct upstream request within one minute', async (t) => {
  const request = await setup(t, async () => jsonResponse({ header: {}, body: { items: [] } }));
  assert.equal((await request(query)).code, 200);
  const res = await request('from=2024-01-08&to=2024-01-08');
  assert.equal(res.code, 429);
});
