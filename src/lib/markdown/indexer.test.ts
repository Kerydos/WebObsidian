import { describe, expect, it } from 'vitest';
import { backlinksFor, indexMarkdown, resolveLink } from './indexer';

describe('indexMarkdown', () => {
  it('extracts links, embeds, tags, and line positions', () => {
    const result = indexMarkdown(
      'notes/source.md',
      '# 실제 제목\n[[Target#Heading|별칭]] #태그\n![[image.png]]',
    );

    expect(result.title).toBe('실제 제목');
    expect(result.tags).toEqual(['#태그']);
    expect(result.links).toEqual([
      { target: 'Target', subpath: 'Heading', alias: '별칭', embed: false, line: 2 },
      { target: 'image.png', subpath: undefined, alias: undefined, embed: true, line: 3 },
    ]);
  });

  it('ignores wiki links and tags inside code', () => {
    const result = indexMarkdown(
      'source.md',
      'Inline `[[Hidden]] #hidden`\n```md\n[[Also hidden]] #hidden\n```\n[[Visible]] #visible',
    );

    expect(result.links.map((link) => link.target)).toEqual(['Visible']);
    expect(result.tags).toEqual(['#visible']);
  });
});

describe('link resolution', () => {
  const paths = ['notes/Target.md', 'archive/Duplicate.md', 'Duplicate.md'];

  it('resolves exact paths and unique base names', () => {
    expect(resolveLink('notes/Target', paths)).toBe('notes/Target.md');
    expect(resolveLink('Target', paths)).toBe('notes/Target.md');
  });

  it('does not guess when a base name is ambiguous', () => {
    expect(resolveLink('Duplicate', paths)).toBe('Duplicate.md');
    expect(resolveLink('Unknown', paths)).toBeUndefined();
  });

  it('builds backlinks from resolved links', () => {
    const target = indexMarkdown('Target.md', '# Target');
    const source = indexMarkdown('Source.md', 'See [[Target]].');
    expect(backlinksFor('Target.md', [target, source]).map((note) => note.path)).toEqual(['Source.md']);
  });
});
