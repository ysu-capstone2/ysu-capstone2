import { supabaseRequest } from './_supabase.js';
import { getGeminiApiKey, generateCivilResponseWithGemini } from './_gemini.js';

function evaluateByKeywordRag(cleanQuery, knowledges) {
  let bestMatch = null;
  let highestScore = 0;

  for (const item of knowledges) {
    let score = 0;
    const qLower = cleanQuery.toLowerCase();
    const titleLower = (item.title || '').toLowerCase();
    const contentLower = (item.content || '').toLowerCase();
    const keywords = item.keywords || [];

    for (const kw of keywords) {
      if (qLower.includes(kw.toLowerCase())) {
        score += 35;
      }
    }

    if (titleLower.includes(qLower) || qLower.includes(titleLower)) {
      score += 40;
    } else {
      const titleTokens = titleLower.split(/\s+/);
      for (const token of titleTokens) {
        if (token.length > 1 && qLower.includes(token)) score += 15;
      }
    }

    const words = qLower.split(/\s+/);
    for (const w of words) {
      if (w.length > 1 && contentLower.includes(w)) score += 8;
    }

    const normalizedScore = Math.min(Math.round(score), 98);

    if (normalizedScore > highestScore) {
      highestScore = normalizedScore;
      bestMatch = item;
    }
  }

  return { bestMatch, highestScore };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: '지원하지 않는 메서드입니다.' });
  }

  const { query, citizenId = 'CITIZEN-GUEST' } = req.body || {};

  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ ok: false, message: '질문 내용을 입력해 주세요.' });
  }

  const cleanQuery = query.trim();

  try {
    // 1. 행정지식베이스 전체 목록 로드 (Supabase RAG 컨텍스트)
    const knowledges = await supabaseRequest('admin_knowledge?select=*');

    const CONFIDENCE_THRESHOLD = 65;
    let responseData = {};
    let sessionStatus = '자체완결';
    let matchedKnowledgeId = null;

    const hasGeminiKey = Boolean(getGeminiApiKey());
    let usedGemini = false;

    // 2-A. GEMINI_API_KEY가 설정되어 있으면 Gemini (gemini-3.8-flash) + RAG로 응답 생성
    if (hasGeminiKey) {
      try {
        const geminiResult = await generateCivilResponseWithGemini(cleanQuery, knowledges);
        usedGemini = true;

        const validKnowledge = knowledges.find((k) => k.id === geminiResult.matchedKnowledgeId);
        matchedKnowledgeId = validKnowledge ? validKnowledge.id : null;

        if (!geminiResult.isTransferred && geminiResult.confidenceScore >= CONFIDENCE_THRESHOLD) {
          sessionStatus = '자체완결';
          responseData = {
            ok: true,
            aiEngine: geminiResult.model,
            isTransferred: false,
            confidenceScore: geminiResult.confidenceScore,
            knowledgeId: matchedKnowledgeId,
            category: geminiResult.category || (validKnowledge ? validKnowledge.category_code : '일반행정'),
            title: geminiResult.title,
            answer: geminiResult.answer,
            requiredDocs: geminiResult.requiredDocs || (validKnowledge ? validKnowledge.required_docs : ''),
            fee: geminiResult.fee || (validKnowledge ? validKnowledge.fee : ''),
            suggestedAction: geminiResult.suggestedAction,
          };
        } else {
          sessionStatus = '상담연계대기';
          const depts = await supabaseRequest('department_info?select=*&limit=5');
          responseData = {
            ok: true,
            aiEngine: geminiResult.model,
            isTransferred: true,
            confidenceScore: Math.min(geminiResult.confidenceScore, 64),
            title: geminiResult.title || '복합·전문 상담 대상 민원',
            answer:
              geminiResult.answer ||
              '질의하신 내용은 정확한 사실관계 및 법령 검토가 필요한 복합 민원입니다.\n\n오안내 방지 원칙에 따라 행복구청 전문 민원 담당자에게 연결해 드립니다. 아래에서 원하시는 상담 방식을 선택해 주세요.',
            departments: depts,
            consultTypes: [
              { type: '전화상담', desc: '담당 공무원이 확인 후 직접 전화 연락 (평일 09:00~18:00)' },
              { type: '방문상담', desc: '본청 및 주민센터 사전 예약 후 대기 없이 대면 상담' },
              { type: '채팅상담', desc: '실시간 1:1 온라인 채팅 상담실 대기' },
            ],
          };
        }
      } catch (geminiError) {
        console.warn('Gemini API 호출 실패, 키워드 RAG 엔진으로 대체합니다:', geminiError.message);
      }
    }

    // 2-B. GEMINI_API_KEY가 없거나 호출 실패 시 키워드 기반 RAG 폴백
    if (!usedGemini) {
      const { bestMatch, highestScore } = evaluateByKeywordRag(cleanQuery, knowledges);
      const isSelfResolved = highestScore >= CONFIDENCE_THRESHOLD && bestMatch !== null;
      sessionStatus = isSelfResolved ? '자체완결' : '상담연계대기';
      matchedKnowledgeId = isSelfResolved ? bestMatch.id : null;

      if (isSelfResolved) {
        responseData = {
          ok: true,
          aiEngine: 'rule-rag-fallback',
          isTransferred: false,
          confidenceScore: highestScore,
          knowledgeId: bestMatch.id,
          category: bestMatch.category_code,
          title: bestMatch.title,
          answer: bestMatch.content,
          requiredDocs: bestMatch.required_docs,
          fee: bestMatch.fee,
          suggestedAction: '구비 서류를 확인하신 후 온라인(정부24) 또는 관할 기관 창구에서 발급받으세요.',
        };
      } else {
        const depts = await supabaseRequest('department_info?select=*&limit=5');
        responseData = {
          ok: true,
          aiEngine: 'rule-rag-fallback',
          isTransferred: true,
          confidenceScore: Math.max(highestScore, 28),
          title: '복합·전문 상담 대상 민원',
          answer:
            '질의하신 내용은 정확한 사실관계 및 법령 검토가 필요한 복합 민원입니다.\n\n오안내 방지 원칙에 따라 행복구청 전문 민원 담당자에게 연결해 드립니다. 아래에서 원하시는 상담 방식을 선택해 주세요.',
          departments: depts,
          consultTypes: [
            { type: '전화상담', desc: '담당 공무원이 확인 후 직접 전화 연락 (평일 09:00~18:00)' },
            { type: '방문상담', desc: '본청 및 주민센터 사전 예약 후 대기 없이 대면 상담' },
            { type: '채팅상담', desc: '실시간 1:1 온라인 채팅 상담실 대기' },
          ],
        };
      }
    }

    // 3. 민원대화기록 테이블(chat_session)에 적재
    const sessionRecord = await supabaseRequest('chat_session', {
      method: 'POST',
      body: JSON.stringify({
        knowledge_id: matchedKnowledgeId,
        citizen_id: citizenId,
        channel: 'WEB',
        query: cleanQuery,
        answer: responseData.answer,
        confidence_score: responseData.confidenceScore,
        status: sessionStatus,
      }),
    });

    const sessionId = sessionRecord && sessionRecord[0] ? sessionRecord[0].id : null;
    responseData.sessionId = sessionId;

    return res.status(200).json(responseData);
  } catch (error) {
    console.error('Chat API Error:', error);
    return res.status(500).json({ ok: false, message: '챗봇 응답 처리 중 오류가 발생했습니다.' });
  }
}
