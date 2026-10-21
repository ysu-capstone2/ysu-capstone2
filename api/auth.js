import { authRequest, config, session, setSession, profile, jsonBody, fail, method, ApiError } from './_auth.js';

export function signupRedirect(req) {
  const configured = process.env.PORTAL_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  let base;
  try {
    if (configured) base = new URL(configured);
    else {
      const host = req.headers?.host || '';
      if (!/^[a-z0-9.-]+(?::[0-9]+)?$/i.test(host)) throw new Error('Invalid host');
      const local = /^(?:localhost|127\.0\.0\.1)(?::[0-9]+)?$/.test(host);
      base = new URL(`${local ? 'http' : 'https'}://${host}`);
    }
    if (base.username || base.password || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost','127.0.0.1'].includes(base.hostname)))) throw new Error('Invalid callback');
  } catch { throw new ApiError(503, '사이트 인증 주소 설정을 확인해 주세요.'); }
  return new URL('/login.html', base).href;
}

export default async function handler(req, res) {
  try {
    method(req, res, ['GET', 'POST', 'PATCH']);
    if (req.method === 'GET') {
      config();
      const current = await session(req, res, { optional: true });
      return res.status(200).json({ ok: true, user: current ? profile(current.user) : null });
    }
    const body = await jsonBody(req);
    if (req.method === 'PATCH') {
      const current = await session(req, res);
      const name = String(body.name || '').trim(), phone = String(body.phone || '').trim();
      if (!name || name.length > 50 || phone.length > 30) throw new ApiError(400, '이름은 1~50자, 연락처는 30자 이하로 입력해 주세요.');
      const user = await authRequest('user', { method: 'PUT', token: current.token, body: JSON.stringify({ data: { name, phone } }) });
      return res.status(200).json({ ok: true, user: profile(user) });
    }
    if (body.action === 'logout') {
      const current = await session(req, res, { optional: true });
      if (current) await authRequest('logout?scope=local', { method: 'POST', token: current.token });
      setSession(req, res, null);
      return res.status(200).json({ ok: true });
    }
    if (body.action === 'resend') {
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new ApiError(400, '인증 메일을 받을 이메일을 확인해 주세요.');
      await authRequest(`resend?redirect_to=${encodeURIComponent(signupRedirect(req))}`, {method:'POST',body:JSON.stringify({type:'signup',email})});
      return res.status(200).json({ok:true,retryAfter:60,message:'미인증 계정이라면 새 인증 메일을 보냈어요. 가장 최근 메일의 링크를 한 번만 눌러 주세요. 이미 인증을 완료했다면 이메일과 비밀번호로 로그인할 수 있어요.'});
    }
    if (!['login', 'signup'].includes(body.action)) throw new ApiError(400, '인증 요청을 확인해 주세요.');
    const email = String(body.email || '').trim(), password = body.password;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof password !== 'string' || password.length > 128 || password.length < (body.action === 'signup' ? 10 : 1)) throw new ApiError(400, '이메일과 비밀번호를 확인해 주세요. 가입 비밀번호는 10~128자입니다.');
    const name = String(body.name || '').trim();
    if (body.action === 'signup' && (!name || name.length > 50)) throw new ApiError(400, '이름을 1~50자로 입력해 주세요.');
    const result = await authRequest(body.action === 'login' ? 'token?grant_type=password' : `signup?redirect_to=${encodeURIComponent(signupRedirect(req))}`, { method: 'POST', body: JSON.stringify({ email, password, ...(body.action === 'signup' ? { data: { name } } : {}) }) });
    if (result.access_token) {
      setSession(req, res, result);
      return res.status(200).json({ ok: true, user: profile(result.user) });
    }
    return res.status(200).json({ ok: true, requiresConfirmation: true, message: '가입 요청을 처리했어요. 인증 메일이 도착했다면 가장 최근 링크를 한 번만 눌러 주세요. 이미 가입·인증한 이메일이면 기존 비밀번호로 로그인할 수 있어요.' });
  } catch (error) { return fail(res, error); }
}
