import { describe, expect, it } from 'vitest';
import { buildVaultTree } from './tree';

function entry(path: string, times: { modifiedAt?: number; createdAt?: number } = {}) {
  return { path, name: path.split('/').at(-1)!, size: 0, modifiedAt: 0, ...times };
}

describe('buildVaultTree', () => {
  it('nests notes under their folder and sorts folders before notes', () => {
    const rows = buildVaultTree(
      [entry('b.md'), entry('projects/plan.md'), entry('projects/ideas/todo.md')],
      [],
    );

    expect(rows.map((row) => [row.kind, row.kind === 'folder' ? row.path : row.entry.path, row.depth])).toEqual([
      ['folder', 'projects', 0],
      ['folder', 'projects/ideas', 1],
      ['note', 'projects/ideas/todo.md', 2],
      ['note', 'projects/plan.md', 1],
      ['note', 'b.md', 0],
    ]);
  });

  it('includes empty folders that contain no notes', () => {
    const rows = buildVaultTree([], [{ path: 'empty', name: 'empty' }]);
    expect(rows).toEqual([{ kind: 'folder', path: 'empty', name: 'empty', depth: 0 }]);
  });

  it('sorts notes by the requested order, newest first, inside each folder', () => {
    const notes = [
      entry('a.md', { createdAt: 1, modifiedAt: 30 }),
      entry('b.md', { createdAt: 3, modifiedAt: 10 }),
      entry('c.md', { createdAt: 2, modifiedAt: 20 }),
    ];
    const paths = (order: Parameters<typeof buildVaultTree>[2]) =>
      buildVaultTree(notes, [], order).map((row) => (row.kind === 'note' ? row.entry.path : row.path));

    expect(paths('created')).toEqual(['b.md', 'c.md', 'a.md']);
    expect(paths('modified')).toEqual(['a.md', 'c.md', 'b.md']);
    expect(paths('name')).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('falls back to the modified time when a note has no creation time', () => {
    const rows = buildVaultTree([entry('old.md', { modifiedAt: 1 }), entry('new.md', { modifiedAt: 2 })], [], 'created');
    expect(rows.map((row) => (row.kind === 'note' ? row.entry.path : row.path))).toEqual(['new.md', 'old.md']);
  });

  it('does not duplicate a folder implied by a note path and also listed explicitly', () => {
    const rows = buildVaultTree([entry('projects/plan.md')], [{ path: 'projects', name: 'projects' }]);
    expect(rows.filter((row) => row.kind === 'folder')).toHaveLength(1);
  });

  it('hides everything inside a collapsed folder but keeps the folder row', () => {
    const rows = buildVaultTree(
      [entry('b.md'), entry('projects/plan.md'), entry('projects/ideas/todo.md')],
      [],
      'name',
      new Set(['projects']),
    );
    expect(rows.map((row) => (row.kind === 'folder' ? row.path : row.entry.path))).toEqual(['projects', 'b.md']);
  });
});
