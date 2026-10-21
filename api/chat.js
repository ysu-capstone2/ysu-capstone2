import { randomUUID } from 'node:crypto';
import guideHandler, { readBody, validateMessage } from './guide.js';
import { supabaseRequest } from './_supabase.js';
import { createPortalChatService } from '../lib/portal-chat.js';
import { ChatError } from '../lib/chat-error.js';

export function createChatHandler({ service = createPortalChatService(), request = supabaseRequest } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') return guideHandler(req, res);
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, message: '지원하지 않는 요청입니다.' });
    }
    const origin = req.headers?.origin;
    if (origin && !['http', 'https'].some((scheme) => origin === `${scheme}://${req.headers?.host}`)) return res.status(403).json({ ok: false, message: '이 페이지에서 직접 질문해 주세요.' });
    if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) return res.status(415).json({ ok: false, message: 'JSON 형식으로 질문해 주세요.' });
    try {
      const body = await readBody(req);
      // Retain both the existing portal's query contract and the new guide's message contract.
      if (body?.query === undefined) { req.body = body; return guideHandler(req, res); }
      const { message } = validateMessage({ message: body.query });
      const cookies = req.headers?.cookie || '';
      let sessionId = cookies.match(/(?:^|;\s*)minwon_session=([0-9a-f-]{36})(?:;|$)/)?.[1];
      if (!sessionId) {
        sessionId = randomUUID();
        const secure = req.headers?.['x-forwarded-proto'] === 'https' || req.socket?.encrypted;
        res.setHeader('Set-Cookie', `minwon_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secure ? '; Secure' : ''}`);
      }
      const citizenId = 'CITIZEN-GUEST'; // Client supplied identities never grant access to records.
      const result = await service.answer({ message, sessionId: `${sessionId}:${citizenId}` });
      let recordId = null;
      try {
        const records = await request('chat_session', { method: 'POST', body: JSON.stringify({
          knowledge_id: result.knowledgeId || null, citizen_id: citizenId, channel: 'WEB',
          query: message, answer: result.answer, confidence_score: result.confidenceScore ?? 0,
          status: result.isTransferred ? '상담연계대기' : '자체완결',
        }) });
        recordId = records?.[0]?.id || null;
      } catch {
        // A logging outage must not prevent a valid FAQ or cached answer.
      }
      return res.status(200).json({ ok: true, ...result, sessionId: recordId });
    } catch (error) {
      if (error instanceof ChatError) {
        if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
        return res.status(error.status).json({ ok: false, message: error.message });
      }
      return res.status(error instanceof SyntaxError ? 400 : 500).json({ ok: false, message: error instanceof SyntaxError ? '질문 형식을 확인해 주세요.' : '챗봇 응답 처리 중 오류가 발생했습니다.' });
    }
  };
}
export default createChatHandler();
