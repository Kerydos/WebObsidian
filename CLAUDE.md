# WebObsidian 프로젝트 인수인계

이 문서는 현재까지 구현된 기능, 실행 방법, 주요 설계 결정과 후속 작업 시 주의사항을 정리한 프로젝트 안내서다. 실제 비밀번호, 세션 토큰 등 민감정보는 저장하지 않는다.

## 현재 상태

- 작업 브랜치: `agent/server-vault-auth`
- 서버 파일 저장 및 로그인 기능 커밋: `80f9a43 Add authenticated server-backed vault`
- 해당 커밋은 원격 브랜치에 푸시되어 있다.
- 인플레이스 마크다운 라이브 프리뷰 변경은 현재 작업 트리에 있으며 아직 커밋되지 않았다.
- `LIVE_PREVIEW_IMPLEMENTATION.md`는 사용자가 제공한 구현 참고 문서이므로 임의로 삭제하거나 덮어쓰지 않는다.
- 이 서버(KERYON, `/home/jarvis/Workspace/WebObsidian`)에 Docker Compose로 배포되어 `https://writer.kerydos.com`에서 서비스 중이다. 컨테이너는 `webobsidian` 이름으로 기존 `gototop-net` 공유 네트워크에 연결되며, 리버스 프록시와 TLS는 `/home/jarvis/Workspace/Caddy/Caddyfile`의 Caddy 컨테이너가 처리한다. DNS(`writer.kerydos.com` A 레코드)는 Cloudflare에서 관리하며 `/home/jarvis/Workspace/Caddy/cloudflare-ddns/`의 DDNS 스크립트가 다른 kerydos.com 서브도메인과 함께 갱신한다.
- 운영 비밀번호는 `WebObsidian/.env`(git 미포함)의 `WEBOBSIDIAN_PASSWORD`에 있다. 값은 이 문서에 기록하지 않는다.
- 참고: 이 환경의 Bash 도구는 프로젝트 작업 디렉터리 밖의 파일(예: `/home/jarvis/Workspace/Caddy`)에 대해 실제 호스트와 다른 캐시 뷰를 보일 수 있었다. 그런 파일을 수정한 뒤에는 관련 컨테이너를 재시작해 반영 여부를 반드시 확인할 것.

## 아키텍처

프로젝트는 모델 B 아키텍처를 사용한다.

- 프론트엔드: React, TypeScript, Vite, CodeMirror 6
- 백엔드: Node.js HTTP 서버
- 데이터 원본: 서버의 실제 `.md` 파일
- 브라우저 캐시 및 인덱스: Dexie/IndexedDB
- 배포: Node 직접 실행 또는 Docker Compose

백엔드는 빌드된 프론트엔드 정적 파일과 인증·Vault API를 함께 제공한다. 마크다운 문서는 `WEBOBSIDIAN_VAULT_DIR`로 지정한 서버 폴더에 저장하며, 기본값은 프로젝트의 `vault/` 폴더다.

## 주요 파일

- `server/server.mjs`: 정적 파일 및 HTTP API 서버
- `server/auth.mjs`: 로그인, 세션, 로그아웃, 로그인 시도 제한
- `server/vault.mjs`: 마크다운 파일 읽기·쓰기, 경로 검증, 충돌 감지
- `server/ollama.mjs`: Ollama Cloud API 프록시(모델 목록, 스트리밍 채팅)와 서버 측 공유 설정 저장소
- `src/lib/vault/server.ts`: 프론트엔드의 서버 Vault 저장소 어댑터
- `src/lib/vault/localFs.ts`: Chromium 계열 브라우저의 로컬 폴더 연결 지원
- `src/lib/vault/opfs.ts`: 기존 브라우저 OPFS 저장소 구현
- `src/lib/settings/ollama.ts`: 과거 localStorage 저장 설정의 마이그레이션 헬퍼
- `src/lib/ai/ollamaCloud.ts`: Ollama Cloud 클라이언트(공유 설정 조회·저장, 모델 목록, NDJSON 스트리밍 채팅)
- `src/components/MarkdownEditor.tsx`: CodeMirror 편집기와 라이브 프리뷰 연결
- `src/components/SettingsPanel.tsx`: 탭 구조 설정 창(화면 / Ollama Cloud)
- `src/components/OllamaSettings.tsx`: API 키 입력과 모델 선택 설정 화면
- `src/components/AssistantPanel.tsx`: Ollama Cloud 기반 AI 도우미 패널
- `src/components/editor/livePreview.ts`: 인플레이스 마크다운 렌더링 구현(콜아웃, 프론트매터, 표 셀 인라인 렌더링 포함)
- `src/components/editor/markdownExtensions.ts`: 형광펜(`==하이라이트==`) `@lezer/markdown` 확장, 목록 Tab 들여쓰기 키맵
- `src/components/editor/livePreview.test.ts`: 라이브 프리뷰 단위 테스트(`happy-dom` 환경에서 위젯 DOM까지 검증)
- `compose.yaml`, `Dockerfile`: 컨테이너 배포 설정

## 개발 환경 실행

Node.js 22.12 이상을 권장한다.

```bash
npm install
WEBOBSIDIAN_PASSWORD='12자 이상의 개발용 비밀번호' npm run server:dev
```

다른 터미널에서 프론트엔드를 실행한다.

```bash
npm run dev
```

Vite가 표시하는 로컬 주소로 접속한다. 기본 개발 주소는 일반적으로 `http://127.0.0.1:5173/`이다. 로그인 아이디는 없으며, 서버 시작 시 `WEBOBSIDIAN_PASSWORD`로 지정한 단일 관리자 비밀번호만 입력한다.

## 운영 배포

### Node 직접 실행

```bash
npm ci
npm run build
NODE_ENV=production \
WEBOBSIDIAN_PASSWORD='충분히 긴 운영 비밀번호' \
WEBOBSIDIAN_VAULT_DIR=/srv/webobsidian/vault \
HOST=127.0.0.1 \
PORT=3000 \
npm start
```

### Docker Compose

```bash
mkdir -p vault
export WEBOBSIDIAN_PASSWORD='충분히 긴 운영 비밀번호'
docker compose up -d --build
```

현재 Compose 설정은 `127.0.0.1:3000`에 바인딩하고 호스트의 `./vault`를 컨테이너의 `/data/vault`에 연결한다. 외부 공개 시에는 Nginx, Caddy 같은 리버스 프록시에서 HTTPS를 종료하고 애플리케이션은 로컬 인터페이스에 유지한다.

## 환경 변수

- `WEBOBSIDIAN_PASSWORD`: 필수. 최소 12자 단일 관리자 비밀번호
- `WEBOBSIDIAN_SECURE_COOKIE`: `true`이면 세션 쿠키에 `Secure` 적용
- `WEBOBSIDIAN_VAULT_DIR`: 마크다운 파일 저장 폴더
- `WEBOBSIDIAN_DIST_DIR`: 프론트엔드 빌드 결과 폴더
- `WEBOBSIDIAN_OLLAMA_HOST`: 선택. Ollama Cloud 프록시의 업스트림 주소(기본값 `https://ollama.com`)
- `WEBOBSIDIAN_OLLAMA_SETTINGS_FILE`: 선택. Ollama Cloud 공유 설정(API 키, 모델) 파일 경로(기본값 vault 안의 `.webobsidian-ollama.json`)
- `HOST`: 서버 바인딩 주소
- `PORT`: 서버 포트

비밀번호나 세션 값은 저장소, 문서, Docker 이미지에 기록하지 않는다. 운영 환경에서는 환경 변수 또는 별도의 비밀 관리 시스템으로 주입한다.

## 인증 동작

- 별도 사용자 아이디 없이 비밀번호만 사용하는 단일 관리자 방식이다.
- 로그인 성공 시 `HttpOnly`, `SameSite=Strict` 세션 쿠키를 발급한다.
- `NODE_ENV=production` 또는 `WEBOBSIDIAN_SECURE_COOKIE=true`일 때 쿠키에 `Secure`가 적용된다.
- 세션 유효기간은 7일이며 서버 메모리에 저장되므로 서버를 재시작하면 모든 세션이 만료된다.
- 동일 클라이언트의 로그인 실패는 15분 동안 5회로 제한된다.
- 인증되지 않은 Vault API 요청은 HTTP 401을 반환한다.

주요 인증 API:

- `GET /api/auth/session`
- `POST /api/auth/login`
- `POST /api/auth/logout`

## 서버 파일 저장 동작

주요 Vault API:

- `GET /api/health`
- `GET /api/vault`
- `GET /api/vault/file?path=...`
- `PUT /api/vault/file?path=...`

저장소 구현의 중요한 계약은 다음과 같다.

- `.md` 파일만 관리한다.
- 중첩 폴더를 지원한다.
- 경로 이동 공격과 Vault 밖을 가리키는 심볼릭 링크를 차단한다.
- 임시 파일 작성 후 이름 변경 방식으로 원자적으로 저장한다.
- SHA-256 리비전을 비교하여 동시 수정 충돌을 감지한다.
- 현재 쓰기 직렬화는 단일 Node 프로세스를 기준으로 한다. 여러 서버 인스턴스를 동시에 운영하려면 공유 잠금 또는 외부 저장 계층이 추가로 필요하다.

## 인플레이스 마크다운 라이브 프리뷰

편집기는 좌우 분할 미리보기를 사용하지 않는다. CodeMirror 편집 화면 안에서 마크다운을 즉시 시각화하며, 커서나 선택 영역이 요소에 닿으면 해당 원문 문법을 다시 보여 주어 편집할 수 있다.

현재 지원 범위:

- ATX 및 Setext 제목
- 굵게, 기울임, 취소선, 인라인 코드, 형광펜(`==하이라이트==`, Obsidian 확장 문법)
- 순서·비순서 목록(다단계 중첩 포함)과 인용문(다단계 중첩 포함)
- Obsidian 스타일 콜아웃(`> [!note]`, `> [!tip]`, `> [!warning]` 등) — 유형별 색상과 아이콘, 제목 생략 시 기본 라벨
- 클릭 가능한 작업 목록 체크박스
- 일반 링크, 자동 링크, 참조 링크
- 위키 링크 `[[문서|표시 이름]]`
- 이미지
- fenced 및 indented 코드 블록
- GFM 표 — 셀 내부의 굵게·기울임·취소선·인라인 코드·형광펜·링크도 함께 렌더링
- 수평선
- 링크 참조 정의 숨김
- YAML 프론트매터(`---`로 감싼 블록)를 별도 속성 위젯으로 표시. 프론트매터가 없으면 문서 맨 앞의 `---`는 평범한 수평선으로 처리된다.
- 목록 안에서 `Tab`/`Shift-Tab`으로 들여쓰기·내어쓰기(목록 밖에서는 기본 포커스 이동 동작을 그대로 둔다)
- 목록·인용문·작업 목록에서 `Enter`로 다음 줄에 같은 마크업을 자동으로 이어 쓴다(CodeMirror `@codemirror/lang-markdown` 기본 동작)

상호작용 원칙:

- 렌더링된 요소를 일반 클릭하면 원문 편집 상태로 돌아간다.
- 예외: 위키 링크는 일반 클릭 시 바로 연결된 노트로 이동한다. 위키 링크의 원문(`[[...]]`)을 편집하려면 `Cmd` 또는 `Ctrl`을 누른 채 클릭한다(Obsidian의 라이브 프리뷰 동작과 동일).
- 일반 마크다운 링크(`[text](url)`)는 여전히 일반 클릭 시 원문 편집 상태로 돌아가고, `Cmd`/`Ctrl`+클릭으로 새 탭에서 연다.
- URL은 검사하며 `javascript:` 같은 위험한 스킴을 차단한다.
- 블록 위젯은 완전한 줄 단위 범위에만 적용하여 CodeMirror 장식 중첩 오류를 방지한다.

형광펜과 콜아웃은 표준 Markdown/GFM에 없는 Obsidian 확장 문법이므로, `src/components/editor/markdownExtensions.ts`에 커스텀 `@lezer/markdown` 확장(`Highlight`)과 `src/components/editor/livePreview.ts`의 블록쿼트 첫 줄 패턴 매칭(콜아웃)으로 직접 구현했다. 표 셀 내부 렌더링은 셀 텍스트를 별도의 작은 Markdown 파서 인스턴스로 다시 파싱해 DOM을 구성하며(`renderInlineMarkdown`), CodeMirror 데코레이션과는 무관하게 정적 HTML만 생성하므로 셀 안에서 직접 편집할 수는 없다(테이블 위젯 전체를 클릭하면 원문 편집 모드로 전환된다).

## 설정 창

상단 톱니바퀴 버튼에서 설정 창을 열 수 있다. 설정 창은 '화면'과 'Ollama Cloud' 두 개 탭으로 구성된다(`src/components/SettingsPanel.tsx`). 모든 설정은 마크다운 파일이나 서버에 기록하지 않고 브라우저의 `localStorage`에 저장된다.

### 화면 탭

`webobsidian:appearance:v1` 키에 저장된다.

- 종이, 밝게, 어둡게 테마
- 본문 및 제목의 고딕·명조·고정폭 글꼴
- 시스템 또는 Courier 코드 글꼴
- 편안하게, 집중, 넓게 문서 레이아웃
- 본문 크기, 줄 간격, 강조 색상
- 즉시 반영, 기본값 복원, 새로고침 후 유지

설정 스키마와 안전한 파싱은 `src/lib/settings/appearance.ts`, UI는 `src/components/AppearanceSettings.tsx`에 있다. 저장된 값이 손상되거나 지원 범위를 벗어나면 항목별 기본값 또는 허용 범위로 복구한다.

## Ollama Cloud 연동

ollama.com의 클라우드 모델(gpt-oss:120b, qwen3.5 등)을 사용하는 AI 도우미 기능이다.

### 설정 저장 위치(서버 공유)

- API 키와 모델은 **서버**에 저장되며 로그인한 모든 브라우저에서 함께 사용된다.
- 저장 파일은 `WEBOBSIDIAN_OLLAMA_SETTINGS_FILE`로 변경할 수 있고 기본값은 vault 폴더 안의 `.webobsidian-ollama.json`이다(0600 권한, JSON). 이 파일은 `.md`가 아니므로 노트 목록·vault API·파일 워처 어디에도 노출되지 않고, `/vault/`가 gitignore되어 있어 커밋되지도 않는다. Docker에서 vault 볼륨에 포함되므로 컨테이너 재생성 후에도 유지된다.
- 설정 조회는 키 원문을 돌려주지 않고 `{ hasApiKey, apiKeyHint(마스킹), model }` 뷰만 제공한다.
- 과거 버전이 브라우저 localStorage(`webobsidian:ollama:v1`)에 저장하던 키는 앱 시작 시 서버에 키가 없으면 자동으로 서버로 이전된 뒤 삭제한다(`src/lib/settings/ollama.ts` 참고).

### 설정 창(Ollama Cloud 탭)

- API 키 입력 후 '저장' 버튼으로 서버에 저장한다. 표시/숨김 토글, 저장된 키 삭제(교체는 새 키 저장)를 지원한다.
- 모델 선택: '모델 목록 불러오기' 버튼으로 계정의 클라우드 모델 목록을 가져와 선택하거나, 이름을 직접 입력할 수 있다(직접 입력은 0.6초 후 자동 저장). 모델도 서버에 저장되어 모든 브라우저에 적용된다.

### 동작 구조

- 브라우저는 직접 ollama.com에 접속하지 않고 같은 서버의 프록시를 사용한다(CORS·키 노출 회피).
  - `GET /api/ollama/settings` / `PUT /api/ollama/settings` — 공유 설정 조회·수정(로그인 필요)
  - `GET /api/ollama/tags` → `https://ollama.com/api/tags`(모델 목록)
  - `POST /api/ollama/chat` → `https://ollama.com/api/chat`(채팅, `stream: true`면 NDJSON 그대로 전달)
- 모든 `/api/ollama/*` 엔드포인트는 로그인 세션이 필요하다(`/api/vault`와 동일 정책). 프록시는 서버에 저장된 API 키를 사용하되, 요청의 `Authorization: Bearer` 헤더로 직접 전달된 키가 있으면 그것을 우선한다.
- 채팅 요청은 `model`, `messages`, `stream` 필드만 허용 목록으로 전달한다(`sanitizeChatRequest`). 업스트림 401/403/404/429는 같은 상태 코드로, 그 외는 502로 매핑하고 업스트림 오류 메시지를 그대로 보여 준다. 키가 어디에도 없으면 401('저장된 Ollama Cloud API 키가 없습니다')을 반환하며, 이 401은 세션 만료 401과 구분해 로그아웃 처리하지 않는다.
- 업스트림 주소는 `WEBOBSIDIAN_OLLAMA_HOST`로 바꿀 수 있다(기본 `https://ollama.com`, 테스트용).
- 구현은 `server/ollama.mjs`(프록시 + `OllamaSettingsStore`)와 `src/lib/ai/ollamaCloud.ts`(클라이언트)에 있다.

### AI 도우미 패널

상단 봇 버튼으로 열고 닫는다(`src/components/AssistantPanel.tsx`).

- 서버에 저장된 모델과 대화하며 응답이 스트리밍으로 표시된다. Enter 전송, Shift+Enter 줄바꿈, 생성 중 '중지' 가능.
- '현재 노트 참조'를 켜면 열려 있는 노트 제목과 내용(최대 8000자)을 맥락으로 함께 보낸다.
- 어시스턴트 답변은 '노트에 삽입'(현재 노트 끝에 추가, 기존 자동 저장 흐름을 따름)하거나 '복사'할 수 있다.
- 대화 상태는 메모리에만 유지되며 패널을 닫아도 유지되고, 새로고침하면 사라진다.

## 검증

변경 후 최소한 다음 명령을 실행한다.

```bash
npm test
npm run build
```

마지막 확인 결과는 테스트 11개 파일, 총 93개 테스트 통과와 프로덕션 빌드 성공이다. (이 서버에서 vitest 기본 forks 풀가 때때로 멈출 수 있다. 그때는 `npx vitest run --pool=threads`로 실행한다.) 빌드 시 `MarkdownEditor` 청크가 500 kB를 넘는다는 경고가 있지만 실패는 아니다. `src/components/editor/livePreview.test.ts`는 파일 상단의 `// @vitest-environment happy-dom` 지시어로 이 파일만 DOM 환경에서 실행되며(다른 테스트는 기본 node 환경 유지), 위젯이 실제로 생성하는 DOM까지 검증한다. Ollama Cloud 프록시는 `server/ollama.test.mjs`가 로컬 목업 업스트림 서버를 띄워 검증하며, 서버 라우팅·인증 게이트·NDJSON 스트리밍까지 실제 HTTP 왕복으로 확인했다. 서버 환경(KERYON)에서 Docker 컨테이너를 재빌드·재배포한 뒤 `https://writer.kerydos.com`에 실제 로그인해 브라우저에서 기능을 직접 확인하는 방식으로도 검증했다.

## 알려진 제한사항

- 수식(KaTeX), Mermaid, 임의의 raw HTML 렌더링은 지원하지 않는다.
- 보안을 위해 raw HTML을 실행해서는 안 된다.
- 각주(`[^1]`, `[^1]: 내용`)는 아직 지원하지 않는다. `@lezer/markdown`에 내장 문법이 없어 커스텀 파서가 필요하며, 후속 작업 대상이다.
- Obsidian 임베드(`![[노트]]`, `![[이미지.png]]`, 노트 전개)는 아직 지원하지 않는다. 이미지 첨부 파일을 서빙하는 백엔드 엔드포인트가 없어 우선 보류했다(아래 첨부 파일 항목 참고).
- 표 셀 안의 인라인 마크다운은 별도 파서로 다시 렌더링한 정적 HTML이라 셀 내부를 직접 클릭 편집할 수 없다. 전체 위젯을 클릭하면 원문 편집 모드로 전환된다.
- 코드 블록은 언어 이름만 표시하고 언어별 구문 강조는 제공하지 않는다.
- 서버 Vault API는 `.md`만 제공하므로 Vault 내부 이미지 첨부 파일을 별도로 서비스하지 않는다. 상대 이미지 경로와 Obsidian 임베드는 첨부 파일 제공 기능 없이는 정상 표시되지 않을 수 있다.
- 브라우저 로컬 폴더로 전환하는 기존 기능은 남아 있지만 기본 저장소는 서버다. 명확한 서버 저장소 복귀 UI는 아직 없다.

## 변경 시 주의사항

- 데이터의 최종 원본은 브라우저 저장소가 아니라 서버의 실제 마크다운 파일이어야 한다.
- `vault/`의 사용자 문서와 비밀번호 같은 비밀값을 Git에 커밋하지 않는다.
- 사용자가 제공한 `LIVE_PREVIEW_IMPLEMENTATION.md`를 보존한다.
- 기존 작업 트리에 사용자 변경이 있을 수 있으므로 관련 없는 파일을 되돌리지 않는다.
- 라이브 프리뷰 수정 시 커서가 요소 안에 있을 때 원문이 노출되는지, 체크박스가 문서를 실제로 갱신하는지, 위험한 링크가 차단되는지를 함께 검증한다.
- 서버 저장 로직 수정 시 경로 탈출, 심볼릭 링크, 리비전 충돌, 원자적 저장 테스트를 유지한다.
