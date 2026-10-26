// Excalidraw 그림은 Obsidian Excalidraw 플러그인과 같은 `*.excalidraw.md` 파일로 저장한다.
// 서버는 여전히 .md만 다루고, 장면 JSON은 `## Drawing` 아래 ```json 블록에 들어간다.

export interface ExcalidrawScene {
  elements: readonly { id: string; type: string; isDeleted?: boolean; text?: string; fileId?: string | null }[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

export const EXCALIDRAW_SUFFIX = '.excalidraw.md';

export function isExcalidrawPath(path: string | undefined): boolean {
  return Boolean(path?.toLowerCase().endsWith(EXCALIDRAW_SUFFIX));
}

// 저장된 마크다운에서 장면을 꺼낸다. 비어 있거나 json 블록이 없으면 빈 장면.
export function parseExcalidraw(markdown: string): ExcalidrawScene {
  if (/```compressed-json/.test(markdown)) {
    // ponytail: Obsidian 압축(LZString) 형식은 미지원. Obsidian에서 'Decompress current Excalidraw file' 후 열 것.
    throw new Error('압축된 Excalidraw 파일입니다. Obsidian에서 압축을 해제한 뒤 다시 열어 주세요.');
  }
  const match = /```json\r?\n([\s\S]*?)\r?\n```/.exec(markdown);
  if (!match) return { elements: [] };
  const scene = JSON.parse(match[1]) as ExcalidrawScene;
  return { elements: scene.elements ?? [], appState: scene.appState, files: scene.files };
}

export function serializeExcalidraw(scene: ExcalidrawScene): string {
  const elements = scene.elements.filter((element) => !element.isDeleted);
  const fileIds = new Set(elements.map((element) => element.fileId).filter(Boolean));
  const files = Object.fromEntries(Object.entries(scene.files ?? {}).filter(([id]) => fileIds.has(id)));
  const appState = { viewBackgroundColor: scene.appState?.viewBackgroundColor ?? '#ffffff', gridSize: scene.appState?.gridSize ?? null };
  // 텍스트 요소는 Obsidian과 같은 `텍스트 ^id` 형식으로 함께 적어 검색에 걸리게 한다.
  const texts = elements.filter((element) => element.type === 'text' && element.text).map((element) => `${element.text} ^${element.id}`);
  const json = JSON.stringify({ type: 'excalidraw', version: 2, source: 'webobsidian', elements, appState, files }, null, '\t');
  return [
    '---',
    'excalidraw-plugin: parsed',
    'tags: [excalidraw]',
    '---',
    '==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==',
    '',
    '# Excalidraw Data',
    '',
    '## Text Elements',
    ...texts.map((text) => `${text}\n`),
    '%%',
    '## Drawing',
    '```json',
    json,
    '```',
    '%%',
    '',
  ].join('\n');
}
