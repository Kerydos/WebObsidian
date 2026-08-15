# WebObsidian 프로젝트 스타터 템플릿 & 셀프 호스팅 설정

본 문서는 WebObsidian 프로젝트를 즉시 생성하고 실행할 수 있는 디렉토리 구조, 의존성(`package.json`), 그리고 Docker 셀프 호스팅 설정 파일을 제공합니다.

---

## 1. 권장 디렉토리 구조 (Next.js / Vite)

```
WebObsidian/
├── src/
│   ├── app/                    # Next.js App Router (또는 Vite React pages)
│   │   ├── layout.tsx
│   │   ├── page.tsx            # 메인 앱 워크스페이스
│   │   └── globals.css         # 전역 테마 및 타이포그래피 스타일
│   ├── components/
│   │   ├── editor/             # CodeMirror 6 에디터 컴포넌트
│   │   │   ├── MarkdownEditor.tsx
│   │   │   ├── extensions/     # 위키링크, 태그, 콜아웃 커스텀 확장
│   │   │   │   ├── wikiLinkPlugin.ts
│   │   │   │   ├── wikiAutocomplete.ts
│   │   │   │   └── checkboxWidget.ts
│   │   ├── filetree/           # 좌측 볼트 파일 탐색기
│   │   │   ├── FileTree.tsx
│   │   │   └── FileTreeItem.tsx
│   │   ├── graph/              # 2D/3D 지식 그래프 뷰어
│   │   │   ├── GraphView.tsx
│   │   │   └── GraphControls.tsx
│   │   ├── search/             # 전역 검색 모달 (Ctrl/Cmd + K)
│   │   │   └── GlobalSearchModal.tsx
│   │   ├── backlink/           # 우측 백링크 / 아웃링크 패널
│   │   │   └── BacklinkPanel.tsx
│   │   └── canvas/             # Obsidian .canvas 파일 뷰어
│   │       └── CanvasViewer.tsx
│   ├── lib/
│   │   ├── vault/              # File System Access API & IO 핸들러
│   │   │   ├── fileSystem.ts
│   │   │   └── localVaultStorage.ts
│   │   ├── graph/              # 그래프 인덱서 & 위키링크 파서
│   │   │   └── indexer.ts
│   │   ├── search/             # MiniSearch 풀텍스트 검색 엔진
│   │   │   └── searchEngine.ts
│   │   └── markdown/           # Unified / Remark AST 파서
│   │       └── parseMarkdown.ts
│   └── types/
│       └── vault.ts            # 공통 데이터 타입 정의
├── server/                     # (셀프 호스팅 선택 시) 백엔드 API
│   ├── src/
│   │   ├── index.ts            # Fastify REST/WebSocket 서버
│   │   ├── vaultRoutes.ts      # 파일 CRUD 엔드포인트
│   │   └── gitSync.ts          # Git 백그라운드 자동 커밋/푸시
│   ├── package.json
│   └── tsconfig.json
├── docker-compose.yml          # 셀프 호스팅 배포 설정
├── Dockerfile                  # 멀티스테이지 빌드 Dockerfile
├── package.json
├── tsconfig.json
└── README.md
```

---

## 2. 클라이언트 `package.json` 예시

```json
{
  "name": "web-obsidian",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "@codemirror/autocomplete": "^6.18.0",
    "@codemirror/commands": "^6.6.0",
    "@codemirror/lang-markdown": "^6.2.5",
    "@codemirror/language": "^6.10.2",
    "@codemirror/state": "^6.4.1",
    "@codemirror/theme-one-dark": "^6.1.2",
    "@codemirror/view": "^6.29.0",
    "clsx": "^2.1.1",
    "dexie": "^4.0.8",
    "gray-matter": "^4.0.3",
    "lucide-react": "^0.428.0",
    "minisearch": "^7.1.0",
    "next": "^14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-force-graph-2d": "^1.25.4",
    "reactflow": "^11.11.4",
    "remark": "^15.0.1",
    "remark-gfm": "^4.0.0",
    "tailwind-merge": "^2.5.2"
  },
  "devDependencies": {
    "@types/node": "^20.14.12",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "postcss": "^8.4.40",
    "tailwindcss": "^3.4.7",
    "typescript": "^5.5.4"
  }
}
```

---

## 3. 셀프 호스팅용 Docker & Docker Compose

### 3.1 `Dockerfile` (멀티 스테이지 빌드)

```dockerfile
# 1단계: 빌드 환경
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# 2단계: 실행 환경
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Next.js Standalone 결과물 복사
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# 볼트 마운트용 디렉토리 생성
RUN mkdir -p /data/vault

EXPOSE 3000
CMD ["node", "server.js"]
```

### 3.2 `docker-compose.yml` (간편 실행)

```yaml
version: '3.8'

services:
  web-obsidian:
    build: .
    container_name: web_obsidian
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      # 호스트의 실제 마크다운 볼트 폴더를 컨테이너 내부로 마운트
      - /Users/sean/Workspace/MyObsidianVault:/data/vault
    environment:
      - VAULT_PATH=/data/vault
      - AUTO_GIT_SYNC=true
      - GIT_SYNC_INTERVAL=300 # 5분마다 자동 커밋
```

---

## 4. 빠른 시작 가이드 (Quick Start)

### 로컬 개발 서버 실행
```bash
# 1. 새 Next.js 프로젝트 초기화 또는 의존성 설치
npm install

# 2. 로컬 개발 서버 실행
npm run dev

# 3. 브라우저에서 접속
# http://localhost:3000
```

### 볼트 열기 테스트
1. 브라우저 화면에서 **[Open Vault Folder]** 버튼 클릭.
2. 내 컴퓨터의 마크다운 파일들이 들어있는 폴더 선택.
3. 브라우저 권한 승인 창에서 **[파일 수정 허용]** 클릭.
4. 좌측 파일 트리에서 노트를 클릭하여 CodeMirror 6 에디터로 편집 및 위키링크(`[[...]]`), 백링크, 그래프 뷰 동작 확인.
