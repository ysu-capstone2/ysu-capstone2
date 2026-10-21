import http from 'node:http';
import { readFile } from 'node:fs/promises';
import minwon from '../api/minwon.js';
import status from '../api/status.js';
import chat from '../api/chat.js';

const root = new URL('../', import.meta.url);
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const routes = new Map([['/api/chat', chat], ['/api/minwon', minwon], ['/api/status', status]]);

http.createServer(async (req, res) => {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  try {
    const url = new URL(req.url, 'http://localhost');
    if (routes.has(url.pathname)) return await routes.get(url.pathname)(req, res);
    const asset = assets.get(url.pathname);
    if (!asset) return res.status(404).json({ ok: false, message: '페이지를 찾을 수 없습니다.' });
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD');
      return res.status(405).json({ ok: false, message: '지원하지 않는 요청입니다.' });
    }
    const content = await readFile(new URL(asset[0], root));
    res.setHeader('Content-Type', asset[1]);
    res.setHeader('Cache-Control', 'no-store');
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    res.status(500).json({ ok: false, message: '서버 오류가 발생했습니다.' });
  }
}).listen(3000, '127.0.0.1', () => console.log('Local: http://localhost:3000'));
