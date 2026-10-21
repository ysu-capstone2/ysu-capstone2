// Explicit login/session verification. Credentials are read only from ignored local files.
// node scripts/check-login.mjs https://your-site.example
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = new URL(process.argv[2] || 'http://localhost:3000');
if (base.username || base.password || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost','127.0.0.1'].includes(base.hostname)))) throw new Error('Use HTTPS, or localhost for local verification.');
for (const label of ['test','admin']) {
  const account = JSON.parse(await readFile(`.local/${label}-account.json`, 'utf8'));
  const jar = new Map();
  async function request(path, method = 'GET', body) {
    const response = await fetch(new URL(path, base), {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Origin: base.origin, 'Content-Type': 'application/json', Cookie: [...jar].map(([key,value]) => `${key}=${value}`).join('; ') },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0], index = pair.indexOf('=');
      if (cookie.includes('Max-Age=0')) jar.delete(pair.slice(0,index));
      else jar.set(pair.slice(0,index),pair.slice(index+1));
    }
    return { status: response.status, data: await response.json() };
  }
  try {
    const login = await request('/api/auth', 'POST', { action:'login', email:account.email, password:account.password });
    assert.equal(login.status,200,`${label}: login failed`);
    const current = await request('/api/auth');
    assert.equal(current.status,200,`${label}: session check failed`);
    assert.equal(current.data.user?.id,account.id,`${label}: account belongs to another project`);
    assert.equal(current.data.user?.isAdmin,label === 'admin',`${label}: unexpected role`);
    const data = await request(label === 'admin' ? '/api/stats' : '/api/lookup');
    assert.equal(data.status,200,`${label}: login succeeded but member database is not ready`);
    assert.equal((await request('/api/counters?mine=1')).status,200,`${label}: ticket query failed`);
    if (label === 'test') assert.equal((await request('/api/stats')).status,403,'Member must not access administrator data');
    assert.equal((await request('/api/auth','POST',{action:'logout'})).status,200,`${label}: logout failed`);
    assert.equal((await request('/api/lookup')).status,401,`${label}: logout did not clear authentication`);
    console.log(`PASS ${label}: login, session, role, member data and logout`);
  } finally {
    if (jar.has('portal_access') || jar.has('portal_refresh')) await request('/api/auth','POST',{action:'logout'}).catch(() => {});
  }
}
