# YSU Capstone 2 · 민원 길잡이

기존 행복구청 민원 포털(`/`)의 UI·예약·조회·통계 기능과 전국 공통 민원 길잡이(`/guide.html`)를 함께 제공합니다. 원격 `hong` 및 `main`의 변경을 통합했습니다.

민원 길잡이는 전국 공통 민원 안내 챗봇입니다. FAQ → 저장된 답변 → Gemini 순서로 답변하여 새 AI 호출을 줄입니다. 민원 길잡이 자체는 실제 민원 접수나 개인 처리 상태 조회를 수행하지 않습니다. 기존 포털의 상담 예약·내역 조회는 별도의 Supabase API로 유지됩니다.

## 실행

Node.js 22 이상, 별도 패키지 설치 불필요.

1. `.env.example`을 `.env.local`로 복사합니다.
2. `GEMINI_API_KEY`에 본인의 Gemini API 키를 설정합니다. 키를 브라우저 코드나 Git에 넣지 마세요.
3. `npm run dev` 실행 후 포털 <http://localhost:3000> 또는 민원 길잡이 <http://localhost:3000/guide.html>에 접속합니다.

포털의 지식베이스·예약·조회·통계에는 `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`(또는 `SUPABASE_SECRET_KEY`) 및 기존 서비스 테이블이 필요합니다. FAQ는 Supabase 없이도 응답하며, 대화 기록 저장 실패가 기본 안내를 차단하지 않습니다.

키가 없어도 FAQ 7개는 정상 동작합니다. FAQ에 없는 질문은 키 설정 안내를 반환합니다. Gemini 실연동은 키 설정 후 확인해야 합니다.

기본 모델은 `gemini-3.1-flash-lite`이며 `GEMINI_MODEL`로 변경할 수 있습니다. 무료 사용 가능 여부와 할당량은 본인 Google AI Studio 프로젝트에서 확인하세요. 이 앱은 결제 설정을 변경하거나 다른 유료 모델로 자동 전환하지 않습니다.

## 답변과 호출 절약

- `data/faq.js`: 공식 창구를 참고한 공통 안내와 질문 별칭입니다. 완전한 질문을 보수적으로 대조하며 폭넓은 단어 유사도로 다른 민원을 동일시하지 않습니다. FAQ는 AI 없이 응답합니다. 세부 기한·서류·지역 담당 부서를 임의로 확정하지 않습니다.
- `lib/chat-service.js`: 나머지 질문만 Gemini `generateContent`로 보냅니다. 최근 최대 3회 문답을 전달하고 출력은 최대 768토큰으로 제한합니다. API 키는 서버 헤더로만 전송합니다.
- Gemini 답변은 같은 브라우저 세션·모델·FAQ 버전·질문·대화 맥락이 일치할 때 30분간 재사용합니다. 연속으로 같은 질문을 반복하면 원래 질문의 맥락을 사용합니다. 동시 중복 요청도 한 번만 생성합니다.
- 서로 다른 세션이나 맥락은 캐시를 공유하지 않습니다. 전화번호·주민번호·이메일·긴 숫자열처럼 식별정보로 보이는 입력은 캐시하지 않습니다. 자동 탐지는 완전하지 않으므로 개인정보를 입력하지 마세요.
- 캐시는 최대 300개이고 서버 메모리에만 있습니다. 재시작·재배포 시 초기화되고 여러 서버 인스턴스 사이에 공유되지 않습니다. 화면의 절약 횟수는 이번 대화에서 FAQ/캐시가 응답한 횟수이며 금액 추정치가 아닙니다.
- 두 챗봇 엔드포인트의 새 Gemini 요청은 공유 한도를 사용하며, 서버 프로세스당 기본 분당 5회·UTC 날짜당 30회로 제한합니다. 환경변수 `GEMINI_MINUTE_LIMIT`, `GEMINI_DAILY_LIMIT`로 변경하고 0으로 차단할 수 있습니다. 실패한 생성 요청도 횟수에 포함하며 자동 재시도하지 않습니다. FAQ/캐시는 한도 이후에도 작동합니다. 재시작 시 한도가 초기화되므로 결제·조직 전체 예산 제한을 대신하지 않습니다.

## API 및 검증

- `GET /api/guide` (또는 `/api/chat`): FAQ 제안 질문과 Gemini 설정 여부. 키는 반환하지 않습니다.
- `POST /api/guide`: `{ "message": "민원 신청 방법", "history": [] }`. history는 최대 6개이며 `user`, `model` 순서의 `{ role, text }` 쌍입니다.
- `POST /api/chat`: 기존 포털 계약인 `{ "query": "질문" }`을 유지합니다. FAQ → 지식베이스 제목 완전 일치 → 같은 세션의 저장된 답변/Gemini로 처리하고, 예약용 `sessionId`, `isTransferred`, `departments` 등 기존 응답 필드를 보존합니다. 캐시된 답변을 사용해도 대화 기록과 예약에 쓰는 `sessionId`는 새로 생성합니다.
- 성공: `{ ok, answer, source: "faq" | "cache" | "gemini" | "knowledge", savedCall, sources }`.
- 입력은 1,000자, 전체 본문은 20KB로 제한합니다. 외부 사이트에서의 브라우저 POST를 거부하고 동일 세션 캐시는 HttpOnly 쿠키로 구분합니다.
- `npm test`: FAQ 오분류 방지, 문맥/세션 분리, 캐시 만료·동시 중복 방지, 한도·오류·키 비노출 검사. 실제 Gemini 호출은 모의 테스트와 별도로 키가 필요합니다.

기존 `api/minwon.js`(공공데이터 통계)와 `api/status.js`(Supabase·Gemini 설정 상태)는 유지됩니다. 공공데이터 통계는 민원 챗봇에서 호출하지 않습니다. Vercel 사용 시 서버 환경변수에 Gemini 설정을 추가하세요. 공개 운영 시 영속 캐시와 사용자별 접근 제한을 별도로 구성해야 합니다.

## 참고 자료

- [국민신문고 민원 안내](https://www.epeople.go.kr/nep/pttn/pttnOnln/pttnOnlnContent.npaid)
- [정부24](https://www.gov.kr/)
- [안전신문고](https://www.safetyreport.go.kr/)
- [Gemini REST API](https://ai.google.dev/api/generate-content)
- [Gemini 모델별 사용 요금 및 무료 구간](https://ai.google.dev/gemini-api/docs/pricing)

FAQ는 2026-10-21에 공식 창구를 참고해 작성한 일반 안내입니다. 링크는 공식 확인 창구이며 AI가 실시간으로 해당 페이지를 조회했다는 의미는 아닙니다.
