import { access, mkdtemp, readdir, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileVault } from './vault.mjs';

async function createVault() {
  const root = await mkdtemp(join(tmpdir(), 'webobsidian-'));
  const vault = new FileVault(root);
  await vault.initialize();
  return { root, vault };
}

describe('server file vault', () => {
  it('creates nested Markdown files and lists them', async () => {
    const { root, vault } = await createVault();
    const created = await vault.write('projects/plan.md', '# Plan', { createOnly: true });

    expect(await readFile(join(root, 'projects/plan.md'), 'utf8')).toBe('# Plan');
    expect(created.revision).toHaveLength(64);
    expect(await vault.list()).toEqual([
      expect.objectContaining({ path: 'projects/plan.md', name: 'plan.md' }),
    ]);
  });

  it('rejects stale revisions and duplicate creates', async () => {
    const { vault } = await createVault();
    const created = await vault.write('note.md', 'first', { createOnly: true });

    await expect(vault.write('note.md', 'duplicate', { createOnly: true })).rejects.toMatchObject({ status: 409 });
    await vault.write('note.md', 'second', { expectedRevision: created.revision });
    await expect(vault.write('note.md', 'stale', { expectedRevision: created.revision })).rejects.toMatchObject({ status: 409 });
  });

  it('allows only one concurrent update for the same revision', async () => {
    const { vault } = await createVault();
    const created = await vault.write('note.md', 'first', { createOnly: true });

    const results = await Promise.allSettled([
      vault.write('note.md', 'second', { expectedRevision: created.revision }),
      vault.write('note.md', 'third', { expectedRevision: created.revision }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('rejects traversal, non-Markdown files, and symlink escapes', async () => {
    const { root, vault } = await createVault();
    const outside = await mkdtemp(join(tmpdir(), 'webobsidian-outside-'));
    await symlink(outside, join(root, 'escape'));
    await symlink(join(outside, 'secret.md'), join(root, 'linked.md'));

    await expect(vault.write('../secret.md', 'no')).rejects.toMatchObject({ status: 400 });
    await expect(vault.write('secret.txt', 'no')).rejects.toMatchObject({ status: 400 });
    await expect(vault.write('escape/secret.md', 'no')).rejects.toMatchObject({ status: 400 });
    await expect(vault.read('linked.md')).rejects.toMatchObject({ status: 400 });
  });

  it('creates empty nested folders and lists them separately from notes', async () => {
    const { root, vault } = await createVault();
    const created = await vault.createFolder('projects/2026');

    expect(created).toEqual({ path: 'projects/2026', name: '2026' });
    expect(await readdir(join(root, 'projects'))).toEqual(['2026']);
    const { entries, folders } = await vault.scan();
    expect(entries).toEqual([]);
    expect(folders).toEqual([
      expect.objectContaining({ path: 'projects' }),
      expect.objectContaining({ path: 'projects/2026' }),
    ]);
  });

  it('rejects duplicate folders and traversal/symlink escapes for folder creation', async () => {
    const { root, vault } = await createVault();
    const outside = await mkdtemp(join(tmpdir(), 'webobsidian-outside-'));
    await symlink(outside, join(root, 'escape'));
    await vault.write('taken.md', 'content', { createOnly: true });
    await vault.createFolder('notes');

    await expect(vault.createFolder('notes')).rejects.toMatchObject({ status: 409 });
    await expect(vault.createFolder('taken.md')).rejects.toMatchObject({ status: 409 });
    await expect(vault.createFolder('../secret')).rejects.toMatchObject({ status: 400 });
    await expect(vault.createFolder('escape/nested')).rejects.toMatchObject({ status: 400 });
  });

  it('deletes an existing note and rejects deleting a missing one', async () => {
    const { root, vault } = await createVault();
    await vault.write('projects/plan.md', '# Plan', { createOnly: true });

    await vault.remove('projects/plan.md');

    await expect(access(join(root, 'projects/plan.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await vault.list()).toEqual([]);
    await expect(vault.remove('projects/plan.md')).rejects.toMatchObject({ status: 404 });
  });

  it('rejects deleting traversal paths and symlink escapes', async () => {
    const { root, vault } = await createVault();
    const outside = await mkdtemp(join(tmpdir(), 'webobsidian-outside-'));
    await symlink(join(outside, 'secret.md'), join(root, 'linked.md'));

    await expect(vault.remove('../secret.md')).rejects.toMatchObject({ status: 400 });
    await expect(vault.remove('linked.md')).rejects.toMatchObject({ status: 400 });
  });

  it('serializes a delete after a pending write for the same path', async () => {
    const { vault } = await createVault();
    const created = await vault.write('note.md', 'first', { createOnly: true });

    const results = await Promise.allSettled([
      vault.write('note.md', 'second', { expectedRevision: created.revision }),
      vault.remove('note.md'),
    ]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    await expect(vault.read('note.md')).rejects.toMatchObject({ status: 404 });
  });

  it('moves a note to a new path, including into a new folder', async () => {
    const { root, vault } = await createVault();
    await vault.write('note.md', 'content', { createOnly: true });

    const moved = await vault.move('note.md', 'projects/renamed.md');

    expect(moved).toEqual(expect.objectContaining({ path: 'projects/renamed.md', name: 'renamed.md' }));
    await expect(access(join(root, 'note.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(root, 'projects/renamed.md'), 'utf8')).toBe('content');
  });

  it('rejects moving a note onto an existing note or a missing source', async () => {
    const { vault } = await createVault();
    await vault.write('a.md', 'a', { createOnly: true });
    await vault.write('b.md', 'b', { createOnly: true });

    await expect(vault.move('a.md', 'b.md')).rejects.toMatchObject({ status: 409 });
    await expect(vault.move('missing.md', 'c.md')).rejects.toMatchObject({ status: 404 });
    await expect(vault.move('../secret.md', 'c.md')).rejects.toMatchObject({ status: 400 });
    await expect(vault.move('a.md', '../c.md')).rejects.toMatchObject({ status: 400 });
  });

  it('moves and renames folders, including their nested contents', async () => {
    const { root, vault } = await createVault();
    await vault.createFolder('notes');
    await vault.write('notes/a.md', 'a', { createOnly: true });

    const moved = await vault.moveFolder('notes', 'archive/notes');

    expect(moved).toEqual({ path: 'archive/notes', name: 'notes' });
    await expect(access(join(root, 'notes'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(root, 'archive/notes/a.md'), 'utf8')).toBe('a');
    const { folders } = await vault.scan();
    expect(folders).toEqual([
      expect.objectContaining({ path: 'archive' }),
      expect.objectContaining({ path: 'archive/notes' }),
    ]);
  });

  it('rejects invalid folder moves', async () => {
    const { vault } = await createVault();
    await vault.createFolder('notes');
    await vault.createFolder('notes/nested');
    await vault.createFolder('taken');
    await vault.write('taken.md', 'x', { createOnly: true });

    await expect(vault.moveFolder('notes', 'notes/nested/inside')).rejects.toMatchObject({ status: 400 });
    await expect(vault.moveFolder('notes', 'taken')).rejects.toMatchObject({ status: 409 });
    await expect(vault.moveFolder('missing', 'somewhere')).rejects.toMatchObject({ status: 404 });
  });
});
