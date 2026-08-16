import { describe, expect, it } from 'vitest';
import { buildVaultTree } from './tree';

function entry(path: string) {
  return { path, name: path.split('/').at(-1)!, size: 0, modifiedAt: 0 };
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

  it('does not duplicate a folder implied by a note path and also listed explicitly', () => {
    const rows = buildVaultTree([entry('projects/plan.md')], [{ path: 'projects', name: 'projects' }]);
    expect(rows.filter((row) => row.kind === 'folder')).toHaveLength(1);
  });
});
