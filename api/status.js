export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, message: '지원하지 않는 요청입니다.' });
  }

  const projectUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!projectUrl || (!serviceKey && !publicKey)) {
    return res.status(503).json({ ok: false, message: 'Supabase 환경변수가 설정되지 않았습니다.' });
  }

  try {
    const baseUrl = new URL(projectUrl);
    if (baseUrl.protocol !== 'https:') throw new Error('Invalid Supabase URL');

    // 1. serviceKey가 있으면 Data API(/rest/v1/)로 확인
    if (serviceKey) {
      const response = await fetch(new URL('/rest/v1/', baseUrl), {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        signal: AbortSignal.timeout(8000),
      });

      if (response.ok) {
        return res.status(200).json({ ok: true, service: 'supabase-data-api' });
      }
    }

    // 2. publicKey가 있거나 fallback으로 Auth Health API 확인
    const authResponse = await fetch(new URL('/auth/v1/health', baseUrl), {
      headers: publicKey ? { apikey: publicKey } : {},
      signal: AbortSignal.timeout(8000),
    });

    if (authResponse.ok) {
      return res.status(200).json({ ok: true, service: 'supabase-auth-api' });
    }

    return res.status(502).json({ ok: false, message: 'Supabase API에서 오류 응답을 받았습니다.' });
  } catch (error) {
    return res.status(502).json({ ok: false, message: error.message || 'Supabase에 연결하지 못했습니다.' });
  }
}
