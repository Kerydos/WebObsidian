import { mkdtemp, readFile, symlink } from 'node:fs/promises';
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
});
