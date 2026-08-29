import { describe, expect, it } from 'vitest';
import { ensureMarkdownPath, linkTargetPath, normalizeVaultPath } from './path';

describe('vault paths', () => {
  it('normalizes safe paths and appends the markdown extension', () => {
    expect(normalizeVaultPath('/projects//plan.md/')).toBe('projects/plan.md');
    expect(ensureMarkdownPath('ideas/new note')).toBe('ideas/new note.md');
    expect(ensureMarkdownPath('existing.MD')).toBe('existing.MD');
  });

  it('rejects traversal and empty paths', () => {
    expect(() => normalizeVaultPath('../secret')).toThrow();
    expect(() => normalizeVaultPath('notes/../secret')).toThrow();
    expect(() => normalizeVaultPath('')).toThrow();
  });
});

describe('linkTargetPath', () => {
  it('places a bare link name in the same folder as the active note', () => {
    expect(linkTargetPath('새노트', '프로젝트/아이디어.md')).toBe('프로젝트/새노트.md');
  });

  it('places a bare link name at the vault root when the active note is at the root', () => {
    expect(linkTargetPath('새노트', 'Welcome.md')).toBe('새노트.md');
    expect(linkTargetPath('새노트')).toBe('새노트.md');
  });

  it('keeps a link path as a vault-root-relative path', () => {
    expect(linkTargetPath('프로젝트/아이디어', '메모/오늘.md')).toBe('프로젝트/아이디어.md');
  });

  it('appends the .md extension only when missing', () => {
    expect(linkTargetPath('새노트.md', '메모/오늘.md')).toBe('메모/새노트.md');
  });
});
