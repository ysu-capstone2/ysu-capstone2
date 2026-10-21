import { randomUUID } from 'node:crypto';
import { faqs } from '../data/faq.js';
import { createChatService, ChatError } from '../lib/chat-service.js';
import { geminiBudget } from '../lib/gemini-budget.js';

const service = createChatService({ budget: geminiBudget });
const COOKIE = 'minwon_session';
const MAX_BODY = 20000;

export function validateMessage(body) {
  if (!body || typeof body !== 'object' || typeof body.message !== 'string') throw new ChatError(400, '질문을 입력해 주세요.');
  const message = body.message.trim();
  if (!message || message.length > 1000) throw new ChatError(400, '질문은 1자 이상 1,000자 이하로 입력해 주세요.');
  const history = body.history ?? [];
  if (!Array.isArray(history) || history.length > 6) throw new ChatError(400, '대화 내역 형식이 올바르지 않습니다. 새 대화를 시작해 주세요.');
  for (let index = 0; index < history.length; index++) {
    const turn = history[index];
    if (!turn || turn.role !== (index % 2 ? 'model' : 'user') || typeof turn.text !== 'string' || !turn.text.trim() || turn.text.length > 4000) throw new ChatError(400, '대화 내역 형식이 올바르지 않습니다.');
  }
  if (history.length % 2 || history.reduce((sum, turn) => sum + turn.text.length, 0) > 12000) throw new ChatError(400, '대화가 너무 깁니다. 새 대화를 시작해 주세요.');
  return { message, history };
}

export async function readBody(req) {
  if (Number(req.headers?.['content-length']) > MAX_BODY) throw new ChatError(413, '요청 내용이 너무 깁니다.');
  if (req.body !== undefined) {
    if (Buffer.byteLength(typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) > MAX_BODY) throw new ChatError(413, '요청 내용이 너무 깁니다.');
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY) throw new ChatError(413, '요청 내용이 너무 깁니다.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({
    ok: true, geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    suggestions: faqs.map(({ id, question }) => ({ id, question })),
  });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, message: '지원하지 않는 요청입니다.' });
  }
  const origin = req.headers?.origin;
  const host = req.headers?.host;
  if (origin && (!host || !['http', 'https'].some((scheme) => origin === `${scheme}://${host}`))) return res.status(403).json({ ok: false, message: '이 페이지에서 직접 질문해 주세요.' });
  if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) return res.status(415).json({ ok: false, message: 'JSON 형식으로 질문해 주세요.' });
  try {
    const input = validateMessage(await readBody(req));
    const cookies = req.headers?.cookie || '';
    let sessionId = cookies.match(/(?:^|;\s*)minwon_session=([0-9a-f-]{36})(?:;|$)/)?.[1];
    if (!sessionId) {
      sessionId = randomUUID();
      const secure = req.headers?.['x-forwarded-proto'] === 'https' || req.socket?.encrypted;
      res.setHeader('Set-Cookie', `${COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secure ? '; Secure' : ''}`);
    }
    const result = await service.answer({ ...input, sessionId });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ChatError) {
      if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
      return res.status(error.status).json({ ok: false, message: error.message });
    }
    return res.status(error instanceof SyntaxError ? 400 : 500).json({ ok: false, message: error instanceof SyntaxError ? '질문 형식을 확인해 주세요.' : '답변을 준비하지 못했어요. 잠시 후 다시 질문해 주세요.' });
  }
}
