const INVALID_SEGMENT = /(^|\/)\.{1,2}(\/|$)|[\\\0]/;

export function normalizeVaultPath(path: string): string {
  const normalized = path.trim().replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  if (!normalized || INVALID_SEGMENT.test(normalized)) {
    throw new Error('올바르지 않은 볼트 경로입니다.');
  }
  return normalized;
}

export function ensureMarkdownPath(path: string): string {
  const normalized = normalizeVaultPath(path);
  return normalized.toLowerCase().endsWith('.md') ? normalized : `${normalized}.md`;
}

export function fileName(path: string): string {
  return path.split('/').at(-1) ?? path;
}

// 위키 링크가 가리킬 새 노트의 경로를 만든다. 이름만 있으면 현재 노트와 같은 폴더에,
// 경로가 포함된 링크면 볼트 루트 기준 그 경로에 둔다.
export function linkTargetPath(target: string, activePath?: string): string {
  if (target.includes('/')) return ensureMarkdownPath(target);
  const folder = activePath?.includes('/') ? activePath.slice(0, activePath.lastIndexOf('/')) : '';
  return ensureMarkdownPath(folder ? `${folder}/${target}` : target);
}
