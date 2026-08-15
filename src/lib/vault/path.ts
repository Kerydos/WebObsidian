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
