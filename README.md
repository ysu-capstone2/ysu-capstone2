# YSU Capstone 2 · 민원 길잡이

기존 행복구청 민원 포털(`/`)의 UI·예약·조회·통계 기능과 전국 공통 민원 길잡이(`/guide.html`)를 함께 제공합니다. 원격 `hong` 및 `main`의 변경을 통합했습니다.

민원 길잡이는 전국 공통 민원 안내 챗봇입니다. FAQ → 저장된 답변 → Gemini 순서로 답변하여 새 AI 호출을 줄입니다. 민원 길잡이 자체는 실제 민원 접수나 개인 처리 상태 조회를 수행하지 않습니다. 포털의 접수·조회·번호표와 관리자 운영 현황은 Supabase Auth 및 PostgreSQL에 연결됩니다.

## 실행

Node.js 22 이상, 별도 패키지 설치 불필요.

1. `.env.example`을 `.env.local`로 복사합니다.
2. `GEMINI_API_KEY`에 본인의 Gemini API 키를 설정합니다. 키를 브라우저 코드나 Git에 넣지 마세요.
3. `npm run dev` 실행 후 포털 <http://localhost:3000> 또는 민원 길잡이 <http://localhost:3000/guide.html>에 접속합니다.

회원 인증에는 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`가 필요합니다. 대화 기록과 번호표 처리에는 서버 전용 `SUPABASE_SERVICE_ROLE_KEY`(또는 `SUPABASE_SECRET_KEY`)도 설정합니다. FAQ는 Supabase 없이도 응답하며, 대화 기록 저장 실패가 기본 안내를 차단하지 않습니다.

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


## 회원·관리자 설정

1. [Supabase 프로젝트](https://supabase.com/dashboard)에서 프로젝트를 엽니다.
2. Connect 또는 Settings → API Keys에서 프로젝트 URL과 공개용 키를 확인합니다. 다음 항목을 프로젝트 루트 `.env.local`에 저장합니다.

   ```dotenv
   SUPABASE_URL=https://프로젝트참조.supabase.co
   SUPABASE_PUBLISHABLE_KEY=공개용키
   SUPABASE_SERVICE_ROLE_KEY=서버전용키
   ```

   공개용 키에는 publishable 또는 기존 anon 키를 사용합니다. service_role/secret 키는 공개용 항목이나 브라우저 코드에 넣지 않습니다. `.env.local`은 Git에서 제외됩니다.

3. 새 프로젝트에서는 `supabase/migrations/`의 SQL을 파일명 순서대로 SQL Editor에서 실행하거나, CLI로 프로젝트를 연결하고 `supabase db push`로 적용합니다. 현재 연결한 프로젝트에는 적용과 이력 기록을 완료했습니다.
4. Authentication → URL Configuration의 Site URL을 로컬에서는 `http://localhost:3000/login.html`, 배포에서는 실제 배포 주소의 `/login.html`로 설정합니다. 기본 인증 메일을 이용하며, 이메일 확인 후 이메일·비밀번호로 로그인합니다. 프로젝트의 이메일 인증 설정은 앱에서 임의로 끄지 않습니다.
5. 일반 사용자에게 인증 메일을 보내려면 Authentication → Email의 SMTP 설정을 확인합니다. Supabase 기본 SMTP는 허용된 수신자와 발송량이 제한됩니다. [공식 SMTP 안내](https://supabase.com/docs/guides/auth/auth-smtp)를 참고하세요. 확인 메일이 도착하는 전체 흐름은 본인 이메일로 별도 검증해야 합니다.
6. 서버를 재시작합니다: `npm run dev`.

- `/signup.html`: 이메일 회원가입. 이메일 인증이 필요한 경우 인증 안내 후 로그인합니다.
- `/login.html`: 이메일·비밀번호 로그인. 서버가 검증한 세션만 사용하고 토큰은 HttpOnly 쿠키에 저장합니다.
- `/mypage.html`: 이름·연락처 수정, 본인 접수 최근 100건, 내 활성 번호표.
- `/admin.html`: 관리자만 접수 집계·최근 100건·처리 상태 변경·창구 등록·다음 번호 호출·상담 기록을 확인합니다.
- 관리자는 서버가 확인한 `app_metadata.role=admin`으로만 판별합니다. 회원가입이나 내 정보 수정으로 권한을 올릴 수 없습니다.
- 접수 생성·읽기는 사용자 JWT와 DB의 RLS 정책을 함께 적용합니다. 상태 변경은 관리자만 가능합니다.
- 접수 시 자동 알림톡 발송이나 법정 처리기한 확정을 하지 않습니다. 실제 행정기관에 제출되는 서비스가 아닙니다.

관리자 계정 생성(이메일을 보내지 않고 인증된 관리자 계정을 만듭니다):

```sh
node --env-file=.env.local scripts/create-admin.mjs admin@example.com
```

새 비밀번호는 자동 생성되며 `.local/admin-account.txt`와 `.local/admin-account.json`에만 저장됩니다. 폴더는 Git에서 제외되며 파일 권한은 소유자 읽기·쓰기로 제한됩니다. 같은 이메일이 이미 있으면 기존 계정이나 비밀번호를 변경하지 않습니다.

## 창구 대기 데이터

초기 창구·대기 인원은 넣지 않습니다. 관리자 페이지에서 운영할 창구를 등록하고, 로그인한 회원이 번호표를 발급받으면 대기 인원이 증가합니다. 관리자가 ‘다음 번호 호출’을 누르면 먼저 발급된 번호를 호출하고 대기 인원을 줄입니다. 번호표 발급과 호출은 DB 트랜잭션에서 처리하며, 동일 사용자·창구의 중복 대기 번호표는 생성하지 않습니다.

일반 화면은 30초마다 DB를 다시 조회하고 마지막 변경 시각을 표시합니다. DB 오류 시 숫자를 대체하지 않고 오류를 표시합니다. **이 서비스에서 발급·호출한 기록이며, 실제 구청·정부24의 외부 대기 시스템과는 연결되지 않았습니다.** 현재 등록 창구가 없으면 빈 상태를 표시합니다.

## 인증·대기열 검증

```sh
npm test
# 별도 로컬 서버와 .local의 관리자/테스트 계정이 있을 때만 실행
npm run test:live
```

실제 연동 검증은 로그인, 사용자 간 접수 격리, 직접 Data API RLS 차단, 관리자 집계·상태 변경, 동시 번호표 발급, 호출 후 대기 인원, 프로필 권한 위조 차단, 토큰 갱신·로그아웃을 확인합니다. 테스트가 만든 접수·창구·번호표·임시 계정만 정리하며, 제공된 로그인 테스트 계정은 유지합니다. 회원가입의 메일 전달·수신은 이 자동 검사에 포함하지 않습니다.


## 프로젝트 변경 후 테스트 로그인이 안 될 때

Supabase 프로젝트가 바뀌면 이전 프로젝트의 사용자 계정과 DB 테이블은 자동으로 복사되지 않습니다. 로그인에서 `invalid_credentials`가 나거나, 로그인 후 마이페이지·운영 통계에서 503이 나면 다음 순서로 확인합니다.

1. 배포 환경과 `.env.local`의 `SUPABASE_URL`이 의도한 프로젝트인지 확인합니다. URL·공개용 키·서버 전용 키는 모두 같은 프로젝트의 값이어야 합니다.
2. 기존 민원 DB에 `chat_session`이 이미 있다면 아래 명령으로 회원 스키마 적용 내용을 먼저 검토합니다. `POSTGRES_URL_NON_POOLING`은 같은 프로젝트의 서버 전용 연결 문자열이어야 하며, Git에서 제외된 `.env.local`에만 보관합니다. `PSQL_BIN`으로 psql 실행 경로를 지정할 수 있습니다.

   ```sh
   node --env-file=.env.local scripts/setup-database.mjs
   # .local/database-bootstrap.sql 검토 후 적용
   node --env-file=.env.local scripts/setup-database.mjs --apply
   ```

   기존 상담·민원 데이터를 삭제하지 않고 새 접수·번호표 테이블 및 관리자 통계 함수를 추가합니다. 기존 개인정보 테이블의 일반 사용자 접근도 제한합니다. 회원 스키마가 일부만 있는 경우에는 임의 변경을 중단합니다. 이미 회원 스키마가 있으면 기본 스키마를 다시 적용하지 않습니다.
3. 이미 전달받은 계정 정보 파일이 `.local/test-account.json`, `.local/admin-account.json`에 있는 경우, 다음 도구로 변경된 프로젝트의 계정을 확인할 수 있습니다. 누락 계정만 생성하며 기존 계정의 비밀번호나 권한을 바꾸지 않습니다. 메일도 보내지 않습니다.

   ```sh
   node --env-file=.env.local scripts/sync-test-accounts.mjs
   node --env-file=.env.local scripts/sync-test-accounts.mjs --apply
   ```

4. 실제 사이트에서 로그인·쿠키 세션·관리자 권한·로그인 후 데이터·로그아웃을 확인합니다. 검증 도구는 비밀번호나 세션 토큰을 출력하지 않습니다.

   ```sh
   node scripts/check-login.mjs https://ysu-capstone2-beta.vercel.app
   ```

2026-10-21: 위 배포 주소에서 일반·관리자 계정을 복구하고 로그인, 세션 유지, 내 접수/번호표, 관리자 운영 통계의 200 응답을 확인했습니다. 일반 계정의 운영 통계 접근은 403, 비로그인 접근은 401로 차단됩니다. 비밀번호는 기존 전달 값 그대로이며 Git에는 포함하지 않습니다.
