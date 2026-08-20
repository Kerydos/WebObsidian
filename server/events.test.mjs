import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VaultChangeBus } from './events.mjs';
import { FileVault, revisionOf } from './vault.mjs';
import { VaultWatcher } from './watcher.mjs';

async function createVault() {
  const root = await mkdtemp(join(tmpdir(), 'webobsidian-events-'));
  const vault = new FileVault(root);
  await vault.initialize();
  return { root, vault };
}

async function waitFor(predicate, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

describe('vault change bus', () => {
  it('suppresses duplicate events within the window only', () => {
    let now = 1000;
    const bus = new VaultChangeBus({ now: () => now, dedupeMs: 1500 });
    const received = [];
    bus.subscribe((change) => received.push(change));

    expect(bus.publish({ type: 'note', action: 'upsert', path: 'a.md', revision: 'r1' })).toBe(true);
    expect(bus.publish({ type: 'note', action: 'upsert', path: 'a.md', revision: 'r1' })).toBe(false);
    expect(bus.publish({ type: 'note', action: 'upsert', path: 'a.md', revision: 'r2' })).toBe(true);
    expect(bus.publish({ type: 'vault', action: 'reload' })).toBe(true);
    expect(bus.publish({ type: 'vault', action: 'reload' })).toBe(false);

    now += 1600;
    expect(bus.publish({ type: 'note', action: 'upsert', path: 'a.md', revision: 'r1' })).toBe(true);
    expect(received).toHaveLength(4);
  });

  it('continues delivering to other subscribers when one throws', () => {
    const bus = new VaultChangeBus();
    const received = [];
    bus.subscribe(() => {
      throw new Error('broken subscriber');
    });
    bus.subscribe((change) => received.push(change));
    expect(bus.publish({ type: 'vault', action: 'reload' })).toBe(true);
    expect(received).toHaveLength(1);
  });

  it('stops delivery after unsubscribe', () => {
    const bus = new VaultChangeBus();
    const received = [];
    const unsubscribe = bus.subscribe((change) => received.push(change));
    bus.publish({ type: 'vault', action: 'reload' });
    unsubscribe();
    bus.publish({ type: 'vault', action: 'reload' });
    expect(received).toHaveLength(1);
  });
});

describe('file vault change events', () => {
  it('publishes note and vault events for each mutation', async () => {
    const { root, vault } = await createVault();
    const events = [];
    vault.changes.subscribe((change) => events.push(change));

    const created = await vault.write('a.md', 'first', { createOnly: true });
    await vault.write('a.md', 'second', { expectedRevision: created.revision });
    await vault.move('a.md', 'b.md');
    await vault.remove('b.md');
    await vault.createFolder('folder');

    expect(events).toEqual([
      { type: 'note', action: 'upsert', path: 'a.md', revision: revisionOf('first') },
      { type: 'note', action: 'upsert', path: 'a.md', revision: revisionOf('second') },
      { type: 'note', action: 'move', path: 'a.md', newPath: 'b.md', revision: revisionOf('second') },
      { type: 'note', action: 'delete', path: 'b.md' },
      { type: 'vault', action: 'reload' },
    ]);
    await rm(root, { recursive: true, force: true });
  });

  it('does not publish events for failed mutations', async () => {
    const { root, vault } = await createVault();
    const events = [];
    vault.changes.subscribe((change) => events.push(change));

    await expect(vault.write('x.md', 'x', { expectedRevision: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(vault.remove('ghost.md')).rejects.toMatchObject({ status: 404 });
    expect(events).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });
});

describe('vault filesystem watcher', () => {
  it('detects external note changes and deletes', async () => {
    const { root, vault } = await createVault();
    const watcher = new VaultWatcher(root, vault.changes, { debounceMs: 100 });
    const events = [];
    const unsubscribe = vault.changes.subscribe((change) => events.push(change));
    watcher.start();

    try {
      await writeFile(join(root, 'external.md'), 'hello');
      expect(await waitFor(() => events.some((event) => event.action === 'upsert' && event.path === 'external.md'))).toBe(true);

      await writeFile(join(root, 'external.md'), 'changed');
      expect(
        await waitFor(() => events.some((event) => event.action === 'upsert' && event.path === 'external.md' && event.revision === revisionOf('changed'))),
      ).toBe(true);

      await rm(join(root, 'external.md'));
      expect(await waitFor(() => events.some((event) => event.action === 'delete' && event.path === 'external.md'))).toBe(true);

      const upserts = events.filter((event) => event.action === 'upsert' && event.path === 'external.md');
      expect(upserts.map((event) => event.revision)).toEqual([revisionOf('hello'), revisionOf('changed')]);
    } finally {
      unsubscribe();
      watcher.stop();
      await rm(root, { recursive: true, force: true });
    }
  }, 15000);

  it('suppresses the filesystem echo of API writes', async () => {
    const { root, vault } = await createVault();
    const watcher = new VaultWatcher(root, vault.changes, { debounceMs: 100 });
    const events = [];
    const unsubscribe = vault.changes.subscribe((change) => events.push(change));
    watcher.start();

    try {
      await vault.write('echo.md', 'content', { createOnly: true });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const upserts = events.filter((event) => event.action === 'upsert' && event.path === 'echo.md');
      expect(upserts).toHaveLength(1);
    } finally {
      unsubscribe();
      watcher.stop();
      await rm(root, { recursive: true, force: true });
    }
  }, 15000);

  it('detects changes in polling mode', async () => {
    const { root, vault } = await createVault();
    const watcher = new VaultWatcher(root, vault.changes, { debounceMs: 100, pollMs: 200 });
    const events = [];
    const unsubscribe = vault.changes.subscribe((change) => events.push(change));
    watcher.start();
    if (watcher.mode === 'watch') watcher.startPolling();
    watcher.snapshot = await watcher.takeSnapshot();

    try {
      await writeFile(join(root, 'polled.md'), 'polled');
      expect(await waitFor(() => events.some((event) => event.action === 'upsert' && event.path === 'polled.md'), 5000)).toBe(true);
      await rm(join(root, 'polled.md'));
      expect(await waitFor(() => events.some((event) => event.action === 'delete' && event.path === 'polled.md'), 5000)).toBe(true);
    } finally {
      unsubscribe();
      watcher.stop();
      await rm(root, { recursive: true, force: true });
    }
  }, 15000);
});
