import { readFile } from 'node:fs/promises';
import { adminSession, method } from './_auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    method(req, res, ['GET', 'HEAD']);
    await adminSession(req, res);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const html = await readFile(new URL('../admin.html', import.meta.url));
    res.statusCode = 200;
    return res.end(req.method === 'HEAD' ? undefined : html);
  } catch (error) {
    if (error.status === 401) {
      res.statusCode = 303;
      res.setHeader('Location', '/login.html?next=%2Fadmin.html');
      return res.end();
    }
    res.statusCode = error.status || 500;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const message = error.status === 403 ? '관리자 계정으로 로그인해야 이용할 수 있습니다.' : '접근 권한을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.';
    const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>접근 안내 · 행복톡톡</title><link rel="icon" type="image/svg+xml" sizes="any" href="/favicon.svg"><link rel="stylesheet" href="/portal.css"><main class="container" style="padding:80px 0"><h1>${message}</h1><p style="margin-top:24px"><a href="/">홈으로</a> · <a href="/login.html?next=%2Fadmin.html">다른 계정으로 로그인</a></p></main></html>`;
    return res.end(req.method === 'HEAD' ? undefined : html);
  }
}
