export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: '지원하지 않는 요청입니다.' });
  }

  const projectUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!projectUrl || !publishableKey) {
    return res.status(503).json({ ok: false, message: 'Supabase 환경변수가 설정되지 않았습니다.' });
  }

  try {
    const baseUrl = new URL(projectUrl);
    if (baseUrl.protocol !== 'https:') throw new Error('Invalid Supabase URL');

    const response = await fetch(new URL('/rest/v1/', baseUrl), {
      headers: { apikey: publishableKey },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return res.status(502).json({ ok: false, message: 'Supabase Data API에서 오류 응답을 받았습니다.' });
    }

    return res.status(200).json({ ok: true, service: 'supabase-data-api' });
  } catch {
    return res.status(502).json({ ok: false, message: 'Supabase에 연결하지 못했습니다. URL과 공개 키를 확인해 주세요.' });
  }
}
