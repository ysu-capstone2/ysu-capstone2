# YSU Capstone 2

Vercel에 배포하는 기본 웹 클라이언트와 서버 API입니다.

- `index.html`: 한국어 상태 확인 화면
- `api/status.js`: 서버에서 Supabase Data API 연결을 확인합니다.

Vercel 프로젝트의 Production 환경에 `SUPABASE_URL`과 `SUPABASE_PUBLISHABLE_KEY`를 설정한 뒤 배포하세요. 공개 키는 서버 API에서만 사용되며 브라우저로 반환하지 않습니다.

기본 화면에서 **연결 확인**을 누르면 Vercel 서버가 Supabase에 요청하고 결과를 표시합니다. 이 저장소에는 서비스용 데이터 테이블이나 인증 기능은 아직 포함되어 있지 않습니다.
