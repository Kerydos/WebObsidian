# WebObsidian 핵심 모듈별 구현 코드 가이드

본 문서는 Obsidian의 핵심 기능들을 웹 상에서 직접 동작시킬 수 있는 구체적인 TypeScript / React / CodeMirror 6 기반의 실전 구현 코드 예제를 제공합니다.

---

## 1. File System Access API 기반 로컬 볼트 마운트 모듈

브라우저에서 사용자의 로컬 폴더를 직접 읽고, 쓰고, 생성하고, 트리 구조를 구축하는 유틸리티입니다.

```typescript
// src/lib/vault/fileSystem.ts

export interface VaultFileItem {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  children?: VaultFileItem[];
  extension?: string;
}

/**
 * 사용자에게 로컬 볼트 폴더 선택 다이얼로그를 띄우고 디렉토리 트리를 순회합니다.
 */
export async function openLocalVault(): Promise<{
  rootHandle: FileSystemDirectoryHandle;
  tree: VaultFileItem;
}> {
  // 1. 디렉토리 피커 호출 (Chrome, Edge 등 Chromium 브라우저 지원)
  const rootHandle = await window.showDirectoryPicker({
    mode: 'readwrite',
  });

  // 2. 재귀적으로 디렉토리 트리 구축
  const tree = await scanDirectory(rootHandle, '');
  return { rootHandle, tree };
}

async function scanDirectory(
  dirHandle: FileSystemDirectoryHandle,
  currentPath: string
): Promise<VaultFileItem> {
  const children: VaultFileItem[] = [];

  for await (const entry of dirHandle.values()) {
    // .git, .obsidian, .trash 등 숨김 폴더 필터링 옵션
    if (entry.name.startsWith('.git') || entry.name === '.trash') continue;

    const itemPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

    if (entry.kind === 'file') {
      const extension = entry.name.split('.').pop()?.toLowerCase() || '';
      children.push({
        name: entry.name,
        path: itemPath,
        kind: 'file',
        handle: entry as FileSystemFileHandle,
        extension,
      });
    } else if (entry.kind === 'directory') {
      const subTree = await scanDirectory(entry as FileSystemDirectoryHandle, itemPath);
      children.push(subTree);
    }
  }

  // 폴더 우선, 그 후 알파벳 순 정렬
  children.sort((a, b) => {
    if (a.kind === b.kind) return a.name.localeCompare(b.name);
    return a.kind === 'directory' ? -1 : 1;
  });

  return {
    name: dirHandle.name,
    path: currentPath || '/',
    kind: 'directory',
    handle: dirHandle,
    children,
  };
}

/**
 * 마크다운 파일 내용 읽기
 */
export async function readMarkdownFile(fileHandle: FileSystemFileHandle): Promise<string> {
  const file = await fileHandle.getFile();
  return await file.text();
}

/**
 * 마크다운 파일 내용 쓰기 (Atomic Write)
 */
export async function writeMarkdownFile(
  fileHandle: FileSystemFileHandle,
  content: string
): Promise<void> {
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}
```

---

## 2. CodeMirror 6 기반 위키링크 및 라이브 프리뷰 에디터 확장

CodeMirror 6의 `ViewPlugin`, `Decoration`, `MatchDecorator`, `autocompletion`을 결합하여 `[[노트 이름]]`을 인터랙티브 링크 위젯으로 치환하고 자동 완성을 제공합니다.

### 2.1 위키링크 데코레이터 확장 (Live Preview Widget)

```typescript
// src/components/editor/extensions/wikiLinkExtension.ts
import {
  WidgetType,
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

class WikiLinkWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly displayText: string,
    readonly onNavigate: (target: string) => void
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-wikilink-pill';
    span.textContent = this.displayText;
    span.title = `링크 열기: ${this.target}`;
    span.style.cssText = `
      background: rgba(124, 58, 237, 0.12);
      color: #7c3aed;
      border-radius: 4px;
      padding: 1px 6px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: underline;
      display: inline-block;
    `;

    span.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onNavigate(this.target);
    });

    return span;
  }
}

export function createWikiLinkPlugin(onNavigate: (target: string) => void) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const regex = /\[\[([^\[\]\|\#]+)(?:#([^\[\]\|]+))?(?:\|([^\[\]]+))?\]\]/g;
        const selection = view.state.selection.main;

        for (const { from, to } of view.visibleRanges) {
          const text = view.state.doc.sliceString(from, to);
          let match: RegExpExecArray | null;

          while ((match = regex.exec(text)) !== null) {
            const start = from + match.index;
            const end = start + match[0].length;
            const target = match[1].trim();
            const displayText = match[3]?.trim() || target;

            // 커서가 위키링크 안에 있을 때는 원본 마크다운 텍스트 노출 (Live Preview 철학)
            const isCursorInside = selection.head >= start && selection.head <= end;

            if (!isCursorInside) {
              builder.add(
                start,
                end,
                Decoration.replace({
                  widget: new WikiLinkWidget(target, displayText, onNavigate),
                })
              );
            }
          }
        }
        return builder.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}
```

### 2.2 `[[` 입력 시 파일명 자동완성 (Autocomplete Extension)

```typescript
// src/components/editor/extensions/wikiLinkAutocomplete.ts
import { CompletionContext, CompletionResult } from '@codemirror/autocomplete';

export function createWikiLinkAutocomplete(allFileNames: string[]) {
  return (context: CompletionContext): CompletionResult | null => {
    // 커서 앞 20글자 검사
    const line = context.state.doc.lineAt(context.pos);
    const lineToCursor = line.text.slice(0, context.pos - line.from);
    const match = /\[\[([^\]]*)$/.exec(lineToCursor);

    if (!match) return null;

    const query = match[1].toLowerCase();
    const from = context.pos - match[1].length;

    return {
      from,
      options: allFileNames
        .filter((name) => name.toLowerCase().includes(query))
        .map((name) => ({
          label: name.replace(/\.md$/, ''),
          apply: `${name.replace(/\.md$/, '')}]]`,
          type: 'text',
          detail: '노트 링크',
        })),
    };
  };
}
```

---

## 3. 양방향 링크 및 백링크 그래프 인덱서 (Graph Engine)

모든 노트의 본문을 파싱하여 전방 링크(Outlinks)와 역방향 백링크(Backlinks)를 실시간 관리하는 엔진입니다.

```typescript
// src/lib/graph/indexer.ts
import matter from 'gray-matter';

export interface NoteMetadata {
  path: string;
  name: string;
  title: string;
  tags: string[];
  outlinks: string[]; // 정규화된 목적지 노트 이름 목록
  backlinks: Set<string>; // 이 노트를 가리키는 원본 노트 목록
  frontmatter: Record<string, any>;
}

export class VaultGraphIndex {
  private notes = new Map<string, NoteMetadata>();
  private tagIndex = new Map<string, Set<string>>();

  /**
   * 단일 파일 색인 갱신
   */
  public updateFile(path: string, rawMarkdown: string): void {
    const { data: frontmatter, content } = matter(rawMarkdown);
    const name = path.split('/').pop()?.replace(/\.md$/, '') || path;
    const title = frontmatter.title || name;

    // 1. 위키링크 추출
    const outlinks = this.parseWikiLinks(content);

    // 2. 태그 추출 (#tag 및 frontmatter tags)
    const tags = this.extractTags(content, frontmatter);

    // 3. 기존 링크 정리
    const existing = this.notes.get(path);
    if (existing) {
      for (const target of existing.outlinks) {
        const targetNote = this.findNoteByName(target);
        if (targetNote) {
          targetNote.backlinks.delete(path);
        }
      }
    }

    // 4. 새 메타데이터 저장
    const metadata: NoteMetadata = {
      path,
      name,
      title,
      tags,
      outlinks,
      backlinks: existing ? existing.backlinks : new Set<string>(),
      frontmatter,
    };
    this.notes.set(path, metadata);

    // 5. 백링크 역방향 매핑
    for (const target of outlinks) {
      const targetNote = this.findNoteByName(target);
      if (targetNote) {
        targetNote.backlinks.add(path);
      }
    }

    // 6. 태그 인덱스 업데이트
    this.updateTags(path, tags);
  }

  private parseWikiLinks(content: string): string[] {
    const regex = /\[\[([^\[\]\|\#]+)(?:#[^\[\]\|]+)?(?:\|[^\[\]]+)?\]\]/g;
    const links = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      links.add(match[1].trim());
    }
    return Array.from(links);
  }

  private extractTags(content: string, frontmatter: Record<string, any>): string[] {
    const tagSet = new Set<string>();
    if (Array.isArray(frontmatter.tags)) {
      frontmatter.tags.forEach((t: string) => tagSet.add(t.startsWith('#') ? t : `#${t}`));
    }
    const tagRegex = /(?:^|\s)(#[a-zA-Z0-9_\-\/]+)(?=\s|$)/g;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(content)) !== null) {
      tagSet.add(match[1]);
    }
    return Array.from(tagSet);
  }

  private updateTags(filePath: string, tags: string[]) {
    for (const tag of tags) {
      if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
      this.tagIndex.get(tag)!.add(filePath);
    }
  }

  public findNoteByName(name: string): NoteMetadata | undefined {
    for (const note of this.notes.values()) {
      if (note.name.toLowerCase() === name.toLowerCase()) {
        return note;
      }
    }
    return undefined;
  }

  public getBacklinks(filePath: string): string[] {
    const note = this.notes.get(filePath);
    return note ? Array.from(note.backlinks) : [];
  }

  /**
   * D3 / Force-Graph용 노드 및 링크 데이터 구조 변환
   */
  public toGraphData() {
    const nodes = Array.from(this.notes.values()).map((n) => ({
      id: n.name,
      path: n.path,
      title: n.title,
      val: 1 + n.backlinks.size, // 백링크가 많을수록 노드 크기 증가
      tags: n.tags,
    }));

    const links: { source: string; target: string }[] = [];
    for (const note of this.notes.values()) {
      for (const target of note.outlinks) {
        links.push({
          source: note.name,
          target,
        });
      }
    }

    return { nodes, links };
  }
}
```

---

## 4. D3 / Force-Graph 기반 인터랙티브 그래프 뷰 컴포넌트

WebGL/Canvas를 활용하여 수천 개의 노트도 부드럽게 렌더링하고, 노드 클릭 시 해당 파일로 즉시 이동하는 React 컴포넌트입니다.

```tsx
// src/components/graph/GraphViewModal.tsx
'use client';

import React, { useEffect, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

interface GraphViewProps {
  graphData: {
    nodes: Array<{ id: string; title: string; path: string; val: number; tags: string[] }>;
    links: Array<{ source: string; target: string }>;
  };
  activeNote?: string;
  onNodeClick: (node: { id: string; path: string }) => void;
}

export const GraphViewModal: React.FC<GraphViewProps> = ({
  graphData,
  activeNote,
  onNodeClick,
}) => {
  const fgRef = useRef<any>(null);

  useEffect(() => {
    if (fgRef.current) {
      // 물리 시뮬레이션 파라미터 튜닝 (옵시디언 그래프 물리와 유사하게 세팅)
      fgRef.current.d3Force('charge').strength(-120);
      fgRef.current.d3Force('link').distance(45);
    }
  }, []);

  return (
    <div className="w-full h-full bg-[#1e1e1e] relative overflow-hidden rounded-lg">
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        nodeId="id"
        nodeLabel={(node: any) => `${node.title} (${node.tags?.join(' ') || ''})`}
        nodeColor={(node: any) => {
          if (node.id === activeNote) return '#a855f7'; // 활성 노트 보라색
          if (node.val > 3) return '#3b82f6'; // 연결이 많은 주요 노드 파란색
          return '#94a3b8'; // 기본 노드 회색
        }}
        nodeRelSize={4}
        linkColor={() => 'rgba(255, 255, 255, 0.15)'}
        linkDirectionalParticles={1}
        linkDirectionalParticleSpeed={0.005}
        linkDirectionalParticleWidth={1.5}
        onNodeClick={(node: any) => onNodeClick(node)}
        cooldownTicks={100}
      />
    </div>
  );
};
```

---

## 5. MiniSearch 기반 초고속 풀텍스트 검색 엔진

한글, 영문, 태그, 프론트매터 본문을 색인하고 오타 교정(Fuzzy Match) 및 실시간 검색을 수행합니다.

```typescript
// src/lib/search/searchEngine.ts
import MiniSearch from 'minisearch';

export interface SearchDoc {
  id: string; // 파일 경로
  title: string;
  content: string;
  tags: string;
}

export class VaultSearchEngine {
  private miniSearch: MiniSearch<SearchDoc>;

  constructor() {
    this.miniSearch = new MiniSearch({
      fields: ['title', 'content', 'tags'], // 검색 대상 필드
      storeFields: ['title', 'id', 'tags'], // 결과에 반환할 필드
      searchOptions: {
        boost: { title: 3, tags: 2 }, // 제목 및 태그 가중치
        fuzzy: 0.2, // 오타 허용
        prefix: true, // 접두사 검색
      },
    });
  }

  public indexDocuments(docs: SearchDoc[]) {
    this.miniSearch.removeAll();
    this.miniSearch.addAll(docs);
  }

  public updateDocument(doc: SearchDoc) {
    if (this.miniSearch.has(doc.id)) {
      this.miniSearch.replace(doc);
    } else {
      this.miniSearch.add(doc);
    }
  }

  public search(query: string) {
    if (!query.trim()) return [];
    return this.miniSearch.search(query);
  }
}
```

---

## 6. Obsidian Canvas (`.canvas`) 인터랙티브 렌더러 기초

React Flow를 이용해 Obsidian 공식 Canvas JSON 파일을 로드하고 시각화하는 방법입니다.

```tsx
// src/components/canvas/CanvasViewer.tsx
import React, { useMemo } from 'react';
import ReactFlow, { Background, Controls, Node, Edge } from 'reactflow';
import 'reactflow/dist/style.css';

interface CanvasViewerProps {
  canvasJsonString: string;
}

export const CanvasViewer: React.FC<CanvasViewerProps> = ({ canvasJsonString }) => {
  const { nodes, edges } = useMemo(() => {
    try {
      const data = JSON.parse(canvasJsonString);
      
      const rfNodes: Node[] = (data.nodes || []).map((n: any) => ({
        id: n.id,
        position: { x: n.x, y: n.y },
        data: {
          label: n.type === 'text' ? n.text : `📄 ${n.file || n.url}`,
        },
        style: {
          width: n.width,
          height: n.height,
          backgroundColor: n.color ? n.color : '#2d2d2d',
          color: '#fff',
          borderRadius: 8,
          padding: 12,
        },
      }));

      const rfEdges: Edge[] = (data.edges || []).map((e: any) => ({
        id: e.id,
        source: e.fromNode,
        target: e.toNode,
        label: e.label,
        animated: true,
      }));

      return { nodes: rfNodes, edges: rfEdges };
    } catch {
      return { nodes: [], edges: [] };
    }
  }, [canvasJsonString]);

  return (
    <div className="w-full h-[600px] bg-[#121212] rounded-lg">
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background color="#333" gap={16} />
        <Controls />
      </ReactFlow>
    </div>
  );
};
```
