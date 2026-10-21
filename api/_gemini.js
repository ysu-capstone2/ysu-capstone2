import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

/**
 * .env.local에서 환경변수가 아직 로드되지 않은 경우 안전하게 읽어옵니다.
 */
function loadEnvLocalIfNeeded() {
  if (process.env.GEMINI_API_KEY) return;
  try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // 파일 접근 불가 시 무시 (Vercel 서버 환경에서는 process.env에 자동 주입됨)
  }
}

export function getGeminiApiKey() {
  loadEnvLocalIfNeeded();
  return (process.env.GEMINI_API_KEY || '').trim();
}

export function getGeminiModel() {
  loadEnvLocalIfNeeded();
  return (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    matchedKnowledgeId: {
      type: 'integer',
      nullable: true,
      description: '참조한 행정지식베이스(admin_knowledge) 항목의 id. 일치하는 항목이 없으면 null',
    },
    confidenceScore: {
      type: 'integer',
      description: '지식베이스 근거 일치 및 답변 확신도 점수 (0~98). 단순·정형 민원은 65~98, 복합·분쟁·근거부족 민원은 15~64',
    },
    isTransferred: {
      type: 'boolean',
      description: 'confidenceScore가 65 미만이거나 법령 유권해석·분쟁 조정이 필요해 공무원 상담 이관이 필요한 경우 true',
    },
    category: {
      type: 'string',
      description: '민원 분류 코드 또는 분류명 (예: 주민/인감, 여권/민원, 청소/환경, 건축/분쟁, 일반행정)',
    },
    title: {
      type: 'string',
      description: '민원 답변의 공식 제목',
    },
    answer: {
      type: 'string',
      description: '구민에게 안내할 공식적이고 정중한 한국어 답변 본문',
    },
    requiredDocs: {
      type: 'string',
      description: '구비서류 및 지참물 안내 (없으면 빈 문자열)',
    },
    fee: {
      type: 'string',
      description: '발급 수수료 및 처리 요건 안내 (없으면 빈 문자열)',
    },
    suggestedAction: {
      type: 'string',
      description: '구민이 다음에 취해야 할 권장 행동 안내',
    },
  },
  required: [
    'confidenceScore',
    'isTransferred',
    'category',
    'title',
    'answer',
    'requiredDocs',
    'fee',
    'suggestedAction',
  ],
};

/**
 * Gemini GenerateContent API를 호출하여
 * 행복구청 RAG 지식베이스 기반 민원 응답을 생성합니다.
 */
export async function generateCivilResponseWithGemini(query, knowledges = []) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const model = getGeminiModel();
  if (!/^[a-zA-Z0-9.-]+$/.test(model)) throw new Error('Invalid Gemini model');

  const ragContext = knowledges
    .map(
      (k) =>
        `[ID: ${k.id}] 분류: ${k.category_code || '일반'} | 제목: ${k.title}\n` +
        `- 안내내용: ${k.content}\n` +
        `- 구비서류: ${k.required_docs || '해당없음'}\n` +
        `- 수수료: ${k.fee || '해당없음'}\n` +
        `- 키워드: ${Array.isArray(k.keywords) ? k.keywords.join(', ') : ''}`
    )
    .join('\n\n');

  const systemInstruction = [
    '당신은 대한민국 행복구청의 24시 스마트 전자민원 안내 AI "행복톡톡"입니다.',
    '반드시 아래 원칙을 준수하여 JSON 스키마 형식으로만 응답하십시오:',
    '1. [근거 기반 팩트 안내 (FR-1)]: 제공된 [행복구청 공인 행정지식베이스]의 사실(구비서류, 수수료, 운영시간 등)에 근거하여 공손하고 명확한 공공기관 어조(~하십시오, ~안내해 드립니다)로 답변하십시오.',
    '2. [환각(오안내) 제로 및 저확신 이관 (FR-2)]: 이웃 간 분쟁(불법건축물 철거 요구, 일조권·층간소음 분쟁 등), 법령 유권해석, 예외적 인허가 판단, 또는 지식베이스에 명확한 근거가 없는 복합 민원인 경우 절대 추측하여 답변하지 마십시오.',
    '3. 복합·분쟁·불확실 민원은 반드시 confidenceScore를 65 미만(예: 28~55)으로 부여하고 isTransferred를 true로 설정한 뒤, 소관 부서 담당 공무원 전문상담 예약을 안내하십시오.',
    '4. 지식베이스로 명확히 안내 가능한 정형 민원(주민등록등본, 인감증명서, 여권 야간창구, 대형폐기물 등)은 confidenceScore를 65 이상(예: 85~96)으로 부여하고 isTransferred를 false로 설정하십시오.',
  ].join('\n');

  const promptInput = `[행복구청 공인 행정지식베이스]\n${ragContext}\n\n[구민 질의 내용]\n${query}`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: promptInput }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1536, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    const error = new Error('Gemini generation failed');
    error.status = res.status;
    throw error;
  }
  const response = await res.json();
  const candidate = response.candidates?.[0];
  const outputText = candidate?.content?.parts?.filter((part) => !part.thought).map((part) => part.text || '').join('').trim();
  if (!outputText || candidate.finishReason !== 'STOP') throw new Error('Gemini returned an incomplete response');

  const parsed = JSON.parse(outputText);
  const score = Math.max(0, Math.min(98, Number(parsed.confidenceScore) || 0));
  const isTransferred = Boolean(parsed.isTransferred || score < 65);

  return {
    matchedKnowledgeId: parsed.matchedKnowledgeId || null,
    confidenceScore: score,
    isTransferred,
    category: parsed.category || '일반행정',
    title: parsed.title || (isTransferred ? '복합·전문 상담 대상 민원' : '민원 안내'),
    answer: parsed.answer || '',
    requiredDocs: parsed.requiredDocs || '',
    fee: parsed.fee || '',
    suggestedAction:
      parsed.suggestedAction ||
      '구비 서류를 확인하신 후 정부24 또는 관할 창구에서 신청하시기 바랍니다.',
    model,
  };
}
