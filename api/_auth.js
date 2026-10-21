import { randomUUID } from 'node:crypto';
import { readBody } from './guide.js';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function config() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new ApiError(503, 'Supabase 연결 설정이 필요합니다.');
  return { url, key };
}
export async function authRequest(path, { token, ...options } = {}) {
  const { url, key } = config();
  let response;
  try { response = await fetch(`${url}/auth/v1/${path}`, { ...options, headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(10000) }); }
  catch { throw new ApiError(503, '인증 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = data.code || data.error_code;
    const messages = { invalid_credentials: '이메일 또는 비밀번호를 확인해 주세요.', email_not_confirmed: '이메일 인증을 완료한 뒤 로그인해 주세요.', user_already_exists: '이미 가입한 이메일입니다.', weak_password: '더 강한 비밀번호를 입력해 주세요.', email_address_invalid: '올바른 이메일 주소를 입력해 주세요.', email_address_not_authorized: '이 프로젝트의 이메일 발송 설정을 확인해야 합니다. 관리자에게 문의해 주세요.', over_email_send_rate_limit: '인증 메일 요청이 많습니다. 잠시 후 다시 시도해 주세요.' };
    throw new ApiError(response.status === 429 ? 429 : response.status >= 500 ? 503 : 400, messages[code] || '인증 요청을 처리하지 못했어요. 입력 정보와 이메일 인증 여부를 확인해 주세요.');
  }
  return data;
}
export function cookies(req) {
  return Object.fromEntries((req.headers?.cookie || '').split(';').map(s => s.trim().split(/=(.*)/s)).filter(p => p.length >= 2).map(([k,v]) => [k,v]));
}
function appendCookies(res, values) {
  const old = res.getHeader?.('Set-Cookie');
  res.setHeader('Set-Cookie', [...(old ? Array.isArray(old) ? old : [old] : []), ...values]);
}
export function setSession(req, res, session) {
  const secure = process.env.NODE_ENV === 'production' || req.headers?.['x-forwarded-proto'] === 'https' || req.socket?.encrypted;
  const suffix = `; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  appendCookies(res, [
    `portal_access=${session?.access_token || ''}; Max-Age=${session ? 60 * 60 * 24 * 30 : 0}${suffix}`,
    `portal_refresh=${session?.refresh_token || ''}; Max-Age=${session ? 60 * 60 * 24 * 30 : 0}${suffix}`,
    `minwon_session=${randomUUID()}; Max-Age=86400${suffix}`,
  ]);
}
const refreshing = new Map();
export async function session(req, res, { optional = false } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.portalSession) return req.portalSession;
  const jar = cookies(req);
  if (!jar.portal_access && !jar.portal_refresh) {
    if (optional) return null;
    throw new ApiError(401, '로그인 후 이용해 주세요.');
  }
  let token = jar.portal_access;
  // Auth /user verifies the token with Supabase; never trust decoded cookie claims.
  const verify = async () => {
    const { url, key } = config();
    let r;
    try { r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }); }
    catch { throw new ApiError(503, '인증 서버에 연결하지 못했어요.'); }
    if (r.status >= 500 || r.status === 429) throw new ApiError(503, '인증 서버가 일시적으로 응답하지 않습니다.');
    if (!r.ok) return null;
    return r.json();
  };
  let user = token ? await verify() : null;
  if (!user && jar.portal_refresh) {
    let pending = refreshing.get(jar.portal_refresh);
    if (!pending) {
      pending = authRequest('token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: jar.portal_refresh }) });
      refreshing.set(jar.portal_refresh, pending);
      const timer = setTimeout(() => refreshing.delete(jar.portal_refresh), 10000); timer.unref?.();
    }
    try {
      const renewed = await pending;
      token = renewed.access_token;
      user = await verify();
      if (user) setSession(req, res, renewed);
    } catch (error) { if (error.status >= 500) throw error; }
  }
  if (!user?.id || user.is_anonymous) {
    setSession(req, res, null);
    if (optional) return null;
    throw new ApiError(401, '로그인이 만료됐어요. 다시 로그인해 주세요.');
  }
  return req.portalSession = { user, token };
}
export async function adminSession(req, res) {
  const value = await session(req, res);
  if (value.user.app_metadata?.role !== 'admin') throw new ApiError(403, '관리자만 이용할 수 있습니다.');
  return value;
}
export function profile(user) {
  return { id: user.id, email: user.email, name: user.user_metadata?.name || '', phone: user.user_metadata?.phone || '', isAdmin: user.app_metadata?.role === 'admin' };
}
export async function jsonBody(req) {
  const origin = req.headers?.origin;
  if (origin && !['http', 'https'].some(s => origin === `${s}://${req.headers?.host}`)) throw new ApiError(403, '현재 사이트에서 요청해 주세요.');
  if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) throw new ApiError(415, 'JSON 형식이 필요합니다.');
  const body = await readBody(req);
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new ApiError(400, '입력 형식을 확인해 주세요.');
  return body;
}
export function fail(res, error) {
  return res.status(error.status || (error instanceof SyntaxError ? 400 : 500)).json({ ok: false, message: error.status || error instanceof SyntaxError ? (error instanceof SyntaxError ? '입력 형식을 확인해 주세요.' : error.message) : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.' });
}
export async function userData(token, endpoint, options = {}) {
  const { url, key } = config();
  let response;
  try { response = await fetch(`${url}/rest/v1/${endpoint}`, { ...options, headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...options.headers }, signal: AbortSignal.timeout(10000) }); }
  catch { throw new ApiError(503, '데이터베이스에 연결하지 못했어요.'); }
  if (!response.ok) throw new ApiError(503, '데이터를 처리하지 못했어요. DB 설정 또는 연결 상태를 확인해 주세요.');
  return response.status === 204 ? null : response.json();
}
export function method(req, res, methods) {
  res.setHeader('Cache-Control', 'no-store');
  if (methods.includes(req.method)) return;
  res.setHeader('Allow', methods.join(', '));
  throw new ApiError(405, '지원하지 않는 요청입니다.');
}
