import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class BlogError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const excluded = new Set(['비공개', '일기', '템플릿']);

export function blogPath(folder, title) {
  if (typeof folder !== 'string' || typeof title !== 'string') throw new BlogError('발행 폴더와 제목을 확인해 주세요.');
  const name = title.trim();
  const segments = folder.trim() ? folder.trim().split('/') : [];
  if (!name || name.length > 200 || /[\\/\0\r\n]/.test(name) || name.startsWith('.') || name === '..' ||
      segments.some((part) => !part || part === '..' || part.startsWith('.') || /[\\\0\r\n]/.test(part)) ||
      excluded.has(segments[0])) throw new BlogError('발행 폴더 또는 제목이 올바르지 않습니다.');
  return [...segments, `${name}.md`].join('/');
}

export function publishContent(content, title) {
  if (typeof content !== 'string') throw new BlogError('발행할 본문이 없습니다.');
  const heading = `title: ${JSON.stringify(title)}\npublish: true`;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return `---\n${heading}\n---\n${content}`;
  const other = match[1].split(/\r?\n/).filter((line) => !/^(title|publish)\s*:/.test(line)).join('\n');
  return `---\n${heading}${other ? `\n${other}` : ''}\n---\n${content.slice(match[0].length)}`;
}

export async function listBlogFolders(root) {
  const folders = [];
  async function scan(path = '') {
    for (const entry of await readdir(path ? `${root}/${path}` : root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || excluded.has(entry.name) && !path) continue;
      const next = path ? `${path}/${entry.name}` : entry.name;
      folders.push(next);
      await scan(next);
    }
  }
  await scan();
  return folders.sort((a, b) => a.localeCompare(b));
}

export class BlogSettingsStore {
  constructor(filePath) { this.filePath = filePath; }
  async read() {
    try { return JSON.parse(await readFile(this.filePath, 'utf8')).apiKey ?? ''; }
    catch (error) { if (error?.code === 'ENOENT') return ''; throw error; }
  }
  async write(apiKey) {
    if (apiKey !== null && (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.trim().length > 4096)) throw new BlogError('API 키 형식이 올바르지 않습니다.');
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ apiKey: apiKey?.trim() ?? '' }), { mode: 0o600 });
  }
}

export async function publishBlog({ apiKey, folder, title, content, host = 'http://note-garden:3000' }) {
  if (!apiKey) throw new BlogError('설정에서 블로그 API 키를 입력해 주세요.', 400);
  const path = blogPath(folder, title);
  const response = await fetch(`${host.replace(/\/+$/, '')}/api/notes/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'text/markdown; charset=utf-8' },
    body: publishContent(content, title.trim()),
    signal: AbortSignal.timeout(120_000),
  }).catch(() => { throw new BlogError('블로그 서버에 연결할 수 없습니다.', 502); });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new BlogError(result.errors?.map((error) => error.message).join('; ') || result.error || '블로그 발행에 실패했습니다.', response.status);
  if (!result.url) throw new BlogError('블로그가 공개 URL을 반환하지 않았습니다. 폴더 설정을 확인해 주세요.', 422);
  return { url: result.url, warnings: result.warnings?.length ?? 0 };
}
