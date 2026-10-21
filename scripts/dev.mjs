import http from 'node:http';
import { readFile } from 'node:fs/promises';
import minwon from '../api/minwon.js';
import status from '../api/status.js';
import chat from '../api/chat.js';
import guide from '../api/guide.js';
import counters from '../api/counters.js';
import lookup from '../api/lookup.js';
import reserve from '../api/reserve.js';
import stats from '../api/stats.js';

const root = new URL('../', import.meta.url);
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/guide.html', ['guide.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const routes = new Map([['/api/chat', chat], ['/api/guide', guide], ['/api/minwon', minwon], ['/api/status', status], ['/api/counters', counters], ['/api/lookup', lookup], ['/api/reserve', reserve], ['/api/stats', stats]]);

http.createServer(async (req, res) => {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  try {
    const url = new URL(req.url, 'http://localhost');
    if (routes.has(url.pathname)) {
      req.query = Object.fromEntries(url.searchParams);
      if (req.method === 'POST' && ['/api/reserve'].includes(url.pathname)) {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 20000) return res.status(413).json({ ok: false, message: '요청 내용이 너무 깁니다.' });
        }
        try { req.body = JSON.parse(body); } catch { return res.status(400).json({ ok: false, message: 'JSON 형식을 확인해 주세요.' }); }
      }
      return await routes.get(url.pathname)(req, res);
    }
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
