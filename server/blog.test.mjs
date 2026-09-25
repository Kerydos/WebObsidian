import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blogPath, listBlogFolders, publishBlog, publishContent } from './blog.mjs';

describe('blog publishing', () => {
  it('creates a safe destination and overrides publish/title metadata', () => {
    expect(blogPath('에세이', '글 제목')).toBe('에세이/글 제목.md');
    expect(publishContent('---\ntitle: old\npublish: false\ntags: [a]\n---\n# Body\n', 'New: title'))
      .toBe('---\ntitle: "New: title"\npublish: true\ntags: [a]\n---\n# Body\n');
  });
  it('rejects unsafe paths and blank titles', () => {
    expect(() => blogPath('../secret', 'title')).toThrow();
    expect(() => blogPath('비공개', 'title')).toThrow();
    expect(() => blogPath('', '')).toThrow();
  });
  it('lists public destination folders', async () => {
    const root = await mkdtemp(join(tmpdir(), 'blog-folders-'));
    try {
      await mkdir(join(root, '에세이', '하위'), { recursive: true });
      await mkdir(join(root, '비공개'));
      expect(await listBlogFolders(root)).toEqual(['에세이', '에세이/하위']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('sends a marked note to the blog API and returns its URL', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ url: 'https://blog.kerydos.com/essay/' }), { status: 200 }));
    try {
      expect(await publishBlog({ apiKey: 'secret', folder: '에세이', title: '글', content: '# Body' })).toEqual({ url: 'https://blog.kerydos.com/essay/', warnings: 0 });
      expect(globalThis.fetch).toHaveBeenCalledWith('http://note-garden:3000/api/notes/%EC%97%90%EC%84%B8%EC%9D%B4/%EA%B8%80.md', expect.objectContaining({ body: '---\ntitle: "글"\npublish: true\n---\n# Body' }));
    } finally { globalThis.fetch = originalFetch; }
  });
});
