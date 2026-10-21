export const FAQ_VERSION = '2026-10-21-v2';

const epeople = { title: '국민신문고 민원 안내', url: 'https://www.epeople.go.kr/nep/pttn/pttnOnln/pttnOnlnContent.npaid' };
const gov = { title: '정부24', url: 'https://www.gov.kr/' };
const safety = { title: '안전신문고', url: 'https://www.safetyreport.go.kr/' };

export const faqs = [
  {
    id: 'apply', question: '민원은 어디에 신청하나요?',
    aliases: ['민원 신청 방법', '민원 어떻게 신청해', '민원 접수 방법', '민원 어디에 접수해', '민원은 어디에 신청하나요', '민원 신청은 어디서 하나요', '민원 접수 어떻게 해', '민원 신청 방법 알려줘', '민원 접수 방법 알려줘', '민원 어디에 넣어'],
    answer: '행정기관에 대한 질의·건의·고충민원은 국민신문고의 민원 안내를 확인해 신청할 수 있어요. 증명서 발급이나 개별 행정서비스 신청은 정부24에서 서비스명을 검색해 신청 방법을 확인해 주세요.\n\n민원 종류와 발생 지역을 알려주시면 어느 창구에서 확인하면 좋을지 더 구체적으로 안내할 수 있어요.',
    sources: [epeople, gov],
  },
  {
    id: 'status', question: '접수한 민원의 처리 상태는 어떻게 확인하나요?',
    aliases: ['민원 처리 상태 확인 방법', '민원 처리결과 확인 방법', '접수한 민원의 처리 상태는 어떻게 확인하나요', '내 민원 어디서 확인해', '민원 진행 상황 확인 방법'],
    answer: '민원을 접수한 공식 사이트에 로그인한 뒤 나의 민원·신청 내역에서 진행 상황과 처리 결과를 확인해 주세요. 국민신문고에 접수했다면 국민신문고에서, 정부24에서 신청했다면 정부24의 신청 내역에서 확인해야 해요.\n\n이 챗봇은 개인의 접수 내역이나 처리 상태를 직접 조회하지 않습니다. 접수번호와 개인정보를 대화창에 보내지 않아도 돼요.',
    sources: [{ title: '국민신문고', url: 'https://www.epeople.go.kr/' }, gov],
  },
  {
    id: 'documents', question: '민원 신청 전에 무엇을 준비하나요?',
    aliases: ['민원 신청 전에 무엇을 준비하나요', '민원 작성 방법', '민원 작성 시 준비할 것', '민원 접수 준비사항', '민원 신청 필요 서류'],
    answer: '일반적인 질의·신고 내용을 정리할 때는 발생 장소와 시각, 구체적인 상황, 요청 사항을 준비하면 좋아요. 사진이나 관련 자료가 있으면 사실을 설명하는 데 도움이 됩니다.\n\n행정서비스의 필수 구비서류는 민원마다 다릅니다. 정부24에서 정확한 서비스명을 검색해 해당 서비스의 구비서류와 신청 방법을 확인해 주세요. 어떤 민원인지 알려주시면 확인할 항목을 함께 정리해 드릴게요.',
    sources: [gov, epeople],
  },
  {
    id: 'duration', question: '민원 처리 기간은 얼마나 걸리나요?',
    aliases: ['민원 처리 기간', '민원 처리기간', '민원 처리 기간은 얼마나 걸리나요', '민원 처리 며칠 걸려', '민원 답변 언제 와', '민원 답변 언제 오나요', '민원 처리기간 알려줘', '민원 처리 기간 알려줘'],
    answer: '민원 처리 기간은 민원의 종류와 담당 기관에 따라 달라서 하나의 기간으로 안내하기 어려워요.\n\n이미 접수했다면 접수 사이트의 신청 내역에서 안내된 처리 예정일을 확인해 주세요. 행정서비스를 신청하기 전이라면 정부24의 해당 서비스 안내에서 처리 기간을 확인할 수 있어요. 민원 종류를 알려주시면 어떤 안내를 확인해야 할지 도와드릴게요.',
    sources: [gov, epeople],
  },
  {
    id: 'agency', question: '담당 기관을 모르면 어떻게 하나요?',
    aliases: ['담당 기관을 모르면 어떻게 하나요', '민원 담당 기관을 모르겠어요', '민원 담당 부서 찾는 방법', '어느 기관에 민원을 넣어야 하나요'],
    answer: '민원 내용과 발생 지역을 먼저 정리한 뒤 국민신문고의 민원 안내 또는 해당 지역 행정기관의 공식 안내를 확인해 주세요. 증명서·인허가 등 특정 행정서비스라면 정부24의 해당 서비스에서 접수·처리 기관을 확인할 수 있어요.\n\n어떤 일인지와 시·군·구 정도의 지역을 알려주시면 확인할 창구를 좁히는 데 도움을 드릴게요. 담당 부서를 확인 없이 확정해서 안내하지는 않습니다.',
    sources: [epeople, gov],
  },
  {
    id: 'safety', question: '도로 파손이나 포트홀은 어디에 신고하나요?',
    aliases: ['포트홀 신고 어디서 해', '포트홀 신고 방법', '도로 파손 신고 방법', '도로 파손이나 포트홀은 어디에 신고하나요', '안전 위험 신고 방법'],
    answer: '도로 파손이나 포트홀처럼 생활 속 안전 위험은 안전신문고에서 신고 방법을 확인해 주세요. 신고할 때 발생 위치와 위험 상황을 명확히 정리하고, 안전한 장소에서 확보한 사진이 있다면 함께 준비하면 좋아요.\n\n차도로 들어가거나 위험한 곳에 접근해서 사진을 촬영하지 마세요. 이 챗봇은 신고 내용을 접수하거나 출동을 요청하는 서비스는 아닙니다.',
    sources: [safety],
  },
  {
    id: 'capability', question: '이 챗봇에서 민원을 접수할 수 있나요?',
    aliases: ['민원 접수해 줘', '민원 접수해줘', '민원 신청해 줘', '민원 신청해줘', '이 챗봇에서 민원을 접수할 수 있나요', '이 챗봇은 뭘 할 수 있어', '챗봇 사용 방법'],
    answer: '여기서는 민원 신청 방법, 준비할 정보, 공식 확인 창구를 안내해 드려요. 실제 민원 접수, 개인 처리 상태 조회, 행정기관의 처분은 하지 않습니다.\n\n실제 접수와 본인확인은 국민신문고·정부24·안전신문고 등 해당 공식 서비스에서 진행해 주세요.',
    sources: [epeople, gov, safety],
  },
];

// Exact questions take precedence. Supported conversational intents require both
// a concrete subject and a problem, and reject unrelated or conflicting requests.
export function normalizeQuestion(value) {
  return value.normalize('NFKC').toLowerCase().trim().replace(/[?？!！。~]+$/gu, '').replace(/\s+/gu, ' ').trim();
}

const faqIndex = new Map(faqs.flatMap((faq) => [faq.question, ...faq.aliases].map((question) => [normalizeQuestion(question), faq])));
export function findFaq(question) {
  const normalized = normalizeQuestion(question);
  const exact = faqIndex.get(normalized);
  if (exact) return exact;
  // Whitespace and common spelling variants do not change road-damage intent.
  const text = normalized.replace(/\s+/gu, '').replace(/포트[호힐]/gu, '포트홀');
  if (text.length > 160) return undefined;
  const differentIntent = /취소|철회|정정|수정|삭제|취하|변경|조회|내역|통계|현황|보상|배상|보험|사고|부상|다쳤|출동|긴급|공사|일정|예산|소음|쓰레기|불법주차|가로등|신호등|여권|전입|등본|세금|과태료|그리고|동시에|말고|아니|아닌|않|안파|없어|없는데|없음|없습|뜻|의미|원인|왜|영어|번역|프롬프트|무시|지시|처리(?:상태|결과|기간)/u;
  if (differentIntent.test(text)) return undefined;
  const road = /도로|차도|인도|보도|골목길|보행로|아스팔트|노면|길바닥|길에|길이/u.test(text);
  const damage = /파손|파였|파여|패였|패여|패인|파인|깨졌|깨져|구멍|움푹|꺼졌|꺼져|갈라졌|균열/u.test(text);
  const pothole = /포트홀|pothole/u.test(text);
  if ((road && damage) || (pothole && /신고|어디|어떻게|발견|있어|있네|있습|생겼|생겨|났어|위험|보여|접수/u.test(text))) {
    return faqs.find(faq => faq.id === 'safety');
  }
  return undefined;
}
