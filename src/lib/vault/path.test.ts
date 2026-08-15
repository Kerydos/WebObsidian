import { describe, expect, it } from 'vitest';
import { ensureMarkdownPath, normalizeVaultPath } from './path';

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
