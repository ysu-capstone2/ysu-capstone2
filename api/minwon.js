const BASE = 'https://apis.data.go.kr/1140100/minAnalsInfoView7/';
const DAY = 86400000;
const cache = new Map();
let nextRequestAt = 0;

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: 'GET 요청만 지원합니다.' });
  }
  const query = new URL(req.url, 'http://localhost').searchParams;
  const type = query.get('type') || 'pothole';
  const from = query.get('from') || '';
  const to = query.get('to') || '';
  const start = parseDate(from);
  const end = parseDate(to);
  if (!['pothole', 'region'].includes(type)) {
    return res.status(400).json({ ok: false, message: '지원하지 않는 조회 유형입니다.' });
  }
  if (!start || !end || start > end) {
    return res.status(400).json({ ok: false, message: '시작일과 종료일을 올바르게 입력해 주세요.' });
  }
  if (type === 'pothole' && (end - start) / DAY > 14) {
    return res.status(400).json({ ok: false, message: '포트홀 조회는 시작일과 종료일을 포함해 최대 15일입니다.' });
  }
  const params = new URLSearchParams({ dateFrom: from.replaceAll('-', ''), dateTo: to.replaceAll('-', '') });
  if (type === 'region') {
    const keyword = (query.get('keyword') || '').trim();
    const institution = (query.get('institution') || '').trim();
    if (!keyword || keyword.length > 100 || !/^\d{7}$/.test(institution)) {
      return res.status(400).json({ ok: false, message: '검색어(100자 이내)와 7자리 기관코드를 입력해 주세요.' });
    }
    params.set('target', 'pttn');
    params.set('searchword', keyword);
    params.set('mainSubCode', institution);
  }
  const key = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
  if (!key) return res.status(503).json({ ok: false, message: '서버에 공공데이터 인증키가 설정되지 않았습니다.' });

  const cacheKey = `${type}:${params}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return res.status(200).json(cached.result);
  if (Date.now() < nextRequestAt) {
    const seconds = Math.ceil((nextRequestAt - Date.now()) / 1000);
    res.setHeader('Retry-After', String(seconds));
    return res.status(429).json({ ok: false, message: `제공기관은 같은 인증키의 요청 사이에 약 1분 간격을 요구합니다. ${seconds}초 후 다시 조회해 주세요.` });
  }
  params.set('serviceKey', key);
  const operation = type === 'pothole' ? 'minPotholeLatLonInfo' : 'minPttnStstAddrInfo';
  try {
    nextRequestAt = Date.now() + 61000;
    const upstream = await fetch(`${BASE}${operation}?${params}`, { signal: AbortSignal.timeout(20000) });
    const raw = await upstream.text();
    let data;
    try { data = JSON.parse(raw); } catch {
      const code = raw.match(/<returnReasonCode>([^<]+)<\/returnReasonCode>/)?.[1];
      const message = code === '22' ? '공공데이터 API의 일일 호출 한도를 초과했습니다.'
        : ['20', '30', '31'].includes(code) ? '공공데이터 API 인증키 또는 서비스 이용 승인을 확인해 주세요.'
          : '공공데이터 API에서 정상 JSON을 받지 못했습니다. 잠시 후 다시 조회해 주세요.';
      return res.status(502).json({ ok: false, message });
    }
    data = data.response || data;
    if (/약 1분|잠시 제한|요청이 연속/.test(data.header?.resultMsg || '')) {
      res.setHeader('Retry-After', '61');
      return res.status(429).json({ ok: false, message: '동일 인증키의 연속 요청이 제한되었습니다. 약 1분 후 다시 조회해 주세요.' });
    }
    const code = String(data.header?.resultCode ?? '');
    if (!upstream.ok || (code && !['00', '0', '0000', '200'].includes(code)) || !data.body || typeof data.body !== 'object') {
      return res.status(502).json({ ok: false, message: '공공데이터 API 조회가 실패했습니다. 인증키, 이용 승인 및 조회 조건을 확인해 주세요.' });
    }
    const source = data.body?.items;
    const records = Array.isArray(source) ? source.map((row) => row.item ?? row)
      : Array.isArray(source?.item) ? source.item : source?.item ? [source.item] : [];
    const items = type === 'pothole' ? records.map((row) => ({
      date: String(row.create_dt ?? ''),
      latitude: row.event_lat === '' || row.event_lat == null ? null : Number(row.event_lat),
      longitude: row.event_lon === '' || row.event_lon == null ? null : Number(row.event_lon),
    })) : records.map((row) => ({ region: String(row.label ?? ''), count: Number(row.hits) || 0 }));
    const result = { ok: true, type, from, to, totalCount: Number(data.body?.totalCount) || items.length, items };
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { result, expires: Date.now() + 300000 });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(502).json({ ok: false, message: error.name === 'TimeoutError'
      ? '공공데이터 API 응답 시간이 초과되었습니다. 잠시 후 다시 조회해 주세요.'
      : '공공데이터 API에 연결하지 못했습니다. 잠시 후 다시 조회해 주세요.' });
  }
}
