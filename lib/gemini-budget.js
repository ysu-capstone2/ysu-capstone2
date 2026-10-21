import { ChatError } from './chat-error.js';

export function createGeminiBudget({ env = process.env, now = Date.now } = {}) {
  let windowStart = 0;
  let minuteCalls = 0;
  let day = '';
  let dailyCalls = 0;
  let blockedUntil = 0;
  const limit = (value, fallback) => /^\d+$/.test(value || '') ? Number(value) : fallback;
  return {
    reserve() {
      const timestamp = now();
      const today = new Date(timestamp).toISOString().slice(0, 10);
      if (day !== today) { day = today; dailyCalls = 0; }
      if (timestamp - windowStart >= 60000) { windowStart = timestamp; minuteCalls = 0; }
      if (timestamp < blockedUntil) throw new ChatError(429, 'Gemini 요청이 잠시 제한됐어요. 잠시 후 다시 질문해 주세요.', Math.ceil((blockedUntil - timestamp) / 1000));
      if (dailyCalls >= limit(env.GEMINI_DAILY_LIMIT, 30)) throw new ChatError(429, '오늘의 AI 호출 한도에 도달했어요. 자주 묻는 질문과 저장된 답변은 계속 사용할 수 있어요.');
      if (minuteCalls >= limit(env.GEMINI_MINUTE_LIMIT, 5)) throw new ChatError(429, '짧은 시간에 AI 요청이 많아요. 잠시 후 다시 질문해 주세요.', 60);
      minuteCalls++; dailyCalls++;
    },
    block() { blockedUntil = now() + 60000; },
  };
}

// Both chatbot endpoints share a single process-wide allowance.
export const geminiBudget = createGeminiBudget();
