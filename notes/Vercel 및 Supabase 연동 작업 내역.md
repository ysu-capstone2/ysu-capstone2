---
title: Vercel 및 Supabase 연동 작업 내역
date: 2026-10-14
tags:
  - capstone
  - vercel
  - supabase
  - devops
  - setup
---

# 🚀 Vercel 및 Supabase 연동 작업 내역

## 1. 프로젝트 기본 정보

| 구분 | 내용 |
| :--- | :--- |
| **GitHub 저장소** | [`ysu-capstone2/ysu-capstone2`](https://github.com/ysu-capstone2/ysu-capstone2) |
| **Vercel 프로젝트** | `ysu-capstone2` (ID: `prj_7XsP7fdmy6wsFE7A2PbYJeEoY0eL`) |
| **배포 URL** | [https://ysu-capstone2-beta.vercel.app](https://ysu-capstone2-beta.vercel.app) |
| **Supabase 프로젝트** | `ysu-capstone2` (Ref: `ppcsaiheovuvfdifcnth`) |
| **호스팅 리전** | 서울 (`icn1` / AWS `ap-northeast-2`) |
| **요금제** | Supabase Free Plan, Vercel Hobby |

---

## 2. 작업 진행 상세

### 2.1. 로컬 환경 및 Vercel 프로젝트 연결
- Vercel CLI(`vercel link`)를 통해 로컬 작업 디렉토리와 Vercel 프로젝트 연동
- [`.vercel/project.json`](file:///Users/yiinsu/Google%20Drive/My%20Drive/Github/ysu-capstone2/.vercel/project.json) 생성
- [`.gitignore`](file:///Users/yiinsu/Google%20Drive/My%20Drive/Github/ysu-capstone2/.gitignore)에 `.vercel` 및 `.env*` 추가하여 보안 파일의 Git 추적 제외

### 2.2. Vercel - GitHub 저장소 연동 (Git Integration)
- Vercel 계정에 GitHub Login Connection 설정 완료
- `ysu-capstone2/ysu-capstone2` 저장소의 `main` 브랜치와 연결
- `main` 브랜치에 `git push` 시 자동으로 Vercel 프로덕션 빌드 및 배포가 수행되도록 설정

### 2.3. Supabase 프로젝트 프로비저닝
- Vercel Marketplace Supabase 연동(`vercel integration add supabase`)을 사용하여 데이터베이스 프로비저닝
- 대한민국 서울 리전(`icn1`, `ap-northeast-2`)으로 설정
- Vercel의 모든 환경(Production, Preview, Development)에 데이터베이스 및 API 환경 변수 자동 등록 완료
- 로컬 [`.env.local`](file:///Users/yiinsu/Google%20Drive/My%20Drive/Github/ysu-capstone2/.env.local)로 환경 변수 동기화(`vercel env pull`)

---

## 3. 주요 이슈 및 트러블슈팅

### 3.1. DB 비밀번호 변경 및 URL 인코딩 문제
- **상황**: 데이터베이스 비밀번호를 사용자가 지정한 비밀번호로 변경함.
- **원인 & 주의점**: 비밀번호에 `?`, `!` 등의 특수문자가 포함되어 있을 경우, PostgreSQL Connection URL에서 쿼리스트링 파라미터 구분자로 오인되어 DB 연결 라이브러리(pg, Prisma 등)에서 구문 분석 오류가 발생할 수 있음.
- **조치**:
  - `POSTGRES_PASSWORD`: 원본 비밀번호 설정
  - `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`: 비밀번호 부분에 표준 URL 인코딩(`%21`, `%3F` 등)을 적용하여 갱신
  - Vercel 클라우드 환경 변수 및 로컬 [`.env.local`](file:///Users/yiinsu/Google%20Drive/My%20Drive/Github/ysu-capstone2/.env.local) 양쪽에 모두 반영 완료

### 3.2. 상태 확인 페이지 (`/api/status`) 502 에러
- **증상**: 배포된 사이트([ysu-capstone2-beta.vercel.app](https://ysu-capstone2-beta.vercel.app))에서 "연결 확인" 버튼 클릭 시 502 에러 및 *"Supabase Data API에서 오류 응답을 받았습니다."* 메시지 출력.
- **원인 분석**:
  - 기존 [`api/status.js`](file:///Users/yiinsu/Google%20Drive/My%20Drive/Github/ysu-capstone2/api/status.js) 코드가 Supabase의 Data API 스키마 엔드포인트(`/rest/v1/`)를 공개 키(`SUPABASE_PUBLISHABLE_KEY`)로 호출함.
  - Supabase 보안 정책상 `/rest/v1/` 루트의 Swagger 스키마는 일반 공개 키(publishable/anon) 접근이 차단(`401 Secret API key required`)됨.
- **해결 방안**:
  - [`api/status.js`](file:///Users/yiinsu/Google%20Drive/My%20Drive/Github/ysu-capstone2/api/status.js)를 수정하여, 백엔드 서버 전용 키인 `SUPABASE_SERVICE_ROLE_KEY`를 사용해 Data API(`/rest/v1/`)를 정상 인증하도록 변경.
  - 보조 수단으로 Auth API Health Check(`/auth/v1/health`)까지 fallback으로 지원하도록 코드 보완.
  - Vercel 프로덕션 재배포(`vercel --prod`) 및 GitHub `main`에 커밋/푸시 완료.
  - 테스트 결과: `{"ok": true, "service": "supabase-data-api"}` 200 OK 응답 및 프론트엔드 연결 확인 정상 동작.

---

## 4. 환경 변수 구성 요약

다음 변수들이 Vercel 대시보드 및 로컬 [`.env.local`](file:///Users/yiinsu/Google%20Drive/My%20Drive/Github/ysu-capstone2/.env.local)에 등록되어 있습니다:

```env
# Supabase API 설정
NEXT_PUBLIC_SUPABASE_URL="https://ppcsaiheovuvfdifcnth.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="..."
SUPABASE_URL="https://ppcsaiheovuvfdifcnth.supabase.co"
SUPABASE_ANON_KEY="..."
SUPABASE_SERVICE_ROLE_KEY="..."   # 서버 전용 (브라우저 노출 금지)

# PostgreSQL 직접 연결 (Prisma, Drizzle, pg 등)
POSTGRES_HOST="db.ppcsaiheovuvfdifcnth.supabase.co"
POSTGRES_USER="postgres"
POSTGRES_PASSWORD="..."
POSTGRES_DATABASE="postgres"
POSTGRES_URL="..."                # Connection Pooler (포트 6543)
POSTGRES_PRISMA_URL="..."         # Prisma용 Pooler URL
POSTGRES_URL_NON_POOLING="..."    # Direct Connection (포트 5432)
```

---

## 5. 보안 가이드라인

> [!IMPORTANT]
> 1. **`SERVICE_ROLE_KEY` 브라우저 노출 금지**:
>    - `SERVICE_ROLE_KEY`는 RLS(Row Level Security)를 무시하는 최고 권한 키이므로, 오직 Vercel Serverless Function(`/api/*`) 내부에서만 사용해야 합니다.
> 2. **프론트엔드에서는 `ANON_KEY`만 사용**:
>    - 브라우저단에서는 항상 `NEXT_PUBLIC_SUPABASE_ANON_KEY`를 사용하고, 데이터 접근 권한은 Supabase RLS 정책으로 제어합니다.
> 3. **Git 보안 준수**:
>    - 실제 키나 비밀번호가 들어있는 `.env` 파일은 절대 Git에 커밋하지 않습니다.

---

## 6. 유용한 관리 링크 & 명령어

### 대시보드 바로가기
- **[Supabase 프로젝트 대시보드](https://supabase.com/dashboard/project/ppcsaiheovuvfdifcnth)**
- **[Supabase Database 설정](https://supabase.com/dashboard/project/ppcsaiheovuvfdifcnth/settings/database)**
- **[Vercel 프로젝트 대시보드](https://vercel.com/ii3289857-7917s-projects/ysu-capstone2)**
- **[배포 사이트 확인](https://ysu-capstone2-beta.vercel.app)**

### 자주 쓰는 CLI 명령어
```bash
# Vercel 환경 변수를 로컬 .env.local로 동기화
vercel env pull

# Vercel에 수동 즉시 배포 (Production)
vercel --prod

# 현재 Vercel 배포 목록 확인
vercel ls ysu-capstone2
```
