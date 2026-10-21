import { authRequest, config, session, setSession, profile, jsonBody, fail, method, ApiError } from './_auth.js';

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
    if (!['login', 'signup'].includes(body.action)) throw new ApiError(400, '인증 요청을 확인해 주세요.');
    const email = String(body.email || '').trim(), password = body.password;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof password !== 'string' || password.length > 128 || password.length < (body.action === 'signup' ? 10 : 1)) throw new ApiError(400, '이메일과 비밀번호를 확인해 주세요. 가입 비밀번호는 10~128자입니다.');
    const name = String(body.name || '').trim();
    if (body.action === 'signup' && (!name || name.length > 50)) throw new ApiError(400, '이름을 1~50자로 입력해 주세요.');
    const result = await authRequest(body.action === 'login' ? 'token?grant_type=password' : 'signup', { method: 'POST', body: JSON.stringify({ email, password, ...(body.action === 'signup' ? { data: { name } } : {}) }) });
    if (result.access_token) {
      setSession(req, res, result);
      return res.status(200).json({ ok: true, user: profile(result.user) });
    }
    return res.status(200).json({ ok: true, requiresConfirmation: true, message: '인증 메일을 보냈습니다. 메일에서 인증한 뒤 로그인해 주세요. 이미 가입한 이메일이면 기존 계정으로 로그인해 주세요.' });
  } catch (error) { return fail(res, error); }
}
