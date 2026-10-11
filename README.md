# Our days

커플의 함께한 날짜, 여행 지도, 일정, 사진을 기록하는 반응형 웹사이트입니다.

## 실행

Node.js 22.12+ (24 LTS 권장)를 사용하세요. Windows는 Node.js LTS 설치 후 `start-windows.bat`를 더블클릭합니다.

```sh
npm ci
npm run dev -- --port 3000 --strictPort
```

빌드: `npm run build`. 프로덕션 빌드 확인: `npm run preview`.

## Supabase 공유 공간

이메일 회원가입·로그인·비밀번호 재설정, 2인 커플 초대, 공유 일정·여행·사진, 갱신 및 기존 개인 기록 가져오기를 제공합니다.

**설정 절차:** [SUPABASE_SETUP.md](SUPABASE_SETUP.md). 실제 프로젝트 생성과 SQL 적용, 이메일 설정, 배포 후 실제 두 계정 검증이 필요합니다.

- 새 프로젝트에 `supabase/migrations/202610110001_shared_space.sql`을 한 번 적용합니다. 테이블, RLS, RPC, 비공개 사진 버킷, Realtime 게시 설정이 포함되어 있습니다.
- `.env.example`을 `.env.local`로 복사해 공개 URL/Publishable key를 설정하거나, 로컬 사이트의 공유 공간 연결 버튼에서 입력합니다.
- 배포할 때에는 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`를 빌드 환경 변수로 지정합니다. 비밀 키나 service_role 키를 쓰지 않습니다.
- 각 기록을 개별 행으로 저장하므로 다른 사람이 추가한 기록을 전체 상태 덮어쓰기로 잃지 않습니다. 동일 기록을 동시에 수정하면 마지막 저장이 적용됩니다.
- 변경된 커플 행의 UPDATE를 Realtime으로 구독합니다. 삭제 변경도 트리거로 알립니다. 원시 테이블의 DELETE 이벤트는 구독하지 않습니다. 15초 폴링과 수동 새로고침을 함께 제공합니다.
- 동기화 갱신은 작성 중인 모달을 닫거나 입력 내용을 바꾸지 않습니다. 저장 실패 시 오류를 표시하고 입력을 유지합니다.
- Supabase 미설정 시 기존 localStorage 개인 모드를 유지합니다. 공유 설정 후에는 로그인한 커플의 데이터만 로딩하며 공용 기록을 개인 모드로 복사하지 않습니다.

## 검증

```sh
npm test
npm run test:browser
npm run build
```

`npm test`는 실제 마이그레이션을 로컬 PostgreSQL(PGlite)에 적용해 익명·타 커플 접근 차단, 초대 만료·재사용, 멤버 수, 기록 수정 권한, 사진 경로·Storage RLS, 삭제 시 갱신을 검사합니다. Supabase Auth/Storage 시스템 테이블은 테스트용 스키마로 구성합니다.

브라우저 테스트는 실제 supabase-js 클라이언트와 모의 Supabase HTTP 응답으로 두 계정 흐름, 기록 가져오기·공유·수정·삭제, 사진 업로드, 실패 시 입력 보존, 로그아웃과 모바일 화면을 검사합니다. 실제 Supabase의 이메일, Storage API, WebSocket 서비스는 별도로 검증해야 합니다. 테스트 서버는 자동 시작/종료합니다.

Playwright Chromium 설치가 필요하다면 `npx playwright install chromium`을 실행하세요. 기존 Chromium을 쓰려면 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`를 지정합니다. `/usr/bin/chromium`이 있는 Linux에서는 자동으로 사용합니다.

온라인 지도: CARTO/OpenStreetMap. 네트워크 차단 시 포함된 세계 지형·도시 표기를 사용합니다. 기본 앨범 사진은 영감용 샘플이며 저장된 사진 수에 포함되지 않습니다. 사진: StartBootstrap 예제 자산(Unsplash). 지형: johan/world.geo.json. 외부 글꼴/이미지 요청 없이 실행됩니다.
