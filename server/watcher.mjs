import { watch } from 'node:fs';
import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { revisionOf } from './vault.mjs';

const IGNORED_SEGMENTS = new Set(['.git', '.trash']);
const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_POLL_MS = 2000;

function isInside(root, target) {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..');
}

function toVaultPath(filename) {
  return filename.split(sep).join('/');
}

function isIgnored(vaultPath) {
  return vaultPath.split('/').some((segment) => IGNORED_SEGMENTS.has(segment));
}

function isTemporary(vaultPath) {
  const name = basename(vaultPath);
  return name.startsWith('.') && name.endsWith('.tmp');
}

function isMarkdown(vaultPath) {
  return vaultPath.toLowerCase().endsWith('.md');
}

// 서버 볼트 폴더를 감시해 API 호출이 아닌 외부 변경(직접 파일 수정, 다른 프로세스의 쓰기)을
// 변경 이벤트 버스로 전달한다. fs.watch(recursive)를 사용하고, 지원되지 않는 환경에서는 폴링으로 동작한다.
export class VaultWatcher {
  constructor(root, bus, { debounceMs = DEFAULT_DEBOUNCE_MS, pollMs = DEFAULT_POLL_MS } = {}) {
    this.root = resolve(root);
    this.bus = bus;
    this.debounceMs = debounceMs;
    this.pollMs = pollMs;
    this.mode = 'idle';
    this.watcher = null;
    this.timers = new Map();
    this.reloadTimer = null;
    this.pollInterval = null;
    this.snapshot = null;
    this.stopped = false;
  }

  start() {
    if (this.mode !== 'idle' || this.stopped) return this;
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, filename) => this.onFsEvent(filename));
      this.watcher.on('error', () => this.startPolling());
      this.mode = 'watch';
    } catch {
      this.startPolling();
    }
    return this;
  }

  stop() {
    this.stopped = true;
    this.closeWatcher();
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    this.mode = 'stopped';
  }

  closeWatcher() {
    if (!this.watcher) return;
    this.watcher.close();
    this.watcher = null;
  }

  startPolling() {
    if (this.mode === 'polling' || this.stopped) return;
    this.closeWatcher();
    this.mode = 'polling';
    void this.takeSnapshot().then((snapshot) => {
      this.snapshot = snapshot;
    });
    this.pollInterval = setInterval(() => void this.poll(), this.pollMs);
  }

  onFsEvent(filename) {
    if (this.stopped) return;
    if (typeof filename !== 'string' || !filename.trim()) {
      this.scheduleReload();
      return;
    }
    const vaultPath = toVaultPath(filename);
    if (isIgnored(vaultPath) || isTemporary(vaultPath)) return;
    const existing = this.timers.get(vaultPath);
    if (existing) clearTimeout(existing);
    this.timers.set(
      vaultPath,
      setTimeout(() => {
        this.timers.delete(vaultPath);
        void this.inspect(vaultPath);
      }, this.debounceMs),
    );
  }

  async inspect(vaultPath) {
    if (this.stopped) return;
    const absolute = resolve(this.root, ...vaultPath.split('/'));
    if (!isInside(this.root, absolute)) return;
    const details = await lstat(absolute).catch(() => null);
    if (!details) {
      if (isMarkdown(vaultPath)) this.bus.publish({ type: 'note', action: 'delete', path: vaultPath });
      else this.bus.publish({ type: 'vault', action: 'reload' });
      return;
    }
    if (details.isDirectory()) {
      this.scheduleReload();
      return;
    }
    if (!isMarkdown(vaultPath) || details.isSymbolicLink()) return;
    const content = await readFile(absolute).catch(() => null);
    if (content === null) return;
    this.bus.publish({ type: 'note', action: 'upsert', path: vaultPath, revision: revisionOf(content) });
  }

  scheduleReload() {
    if (this.stopped || this.reloadTimer) return;
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      if (!this.stopped) this.bus.publish({ type: 'vault', action: 'reload' });
    }, this.debounceMs);
  }

  async takeSnapshot() {
    const notes = new Map();
    const folders = new Set();
    const walk = async (directory, prefix = '') => {
      const items = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const item of items) {
        if (item.isSymbolicLink() || IGNORED_SEGMENTS.has(item.name)) continue;
        const vaultPath = prefix ? `${prefix}/${item.name}` : item.name;
        const itemPath = resolve(directory, item.name);
        if (item.isDirectory()) {
          folders.add(vaultPath);
          await walk(itemPath, vaultPath);
        } else if (item.isFile() && isMarkdown(item.name)) {
          const details = await stat(itemPath).catch(() => null);
          if (details) notes.set(vaultPath, { modifiedAt: details.mtimeMs, size: details.size });
        }
      }
    };
    await walk(this.root);
    return { notes, folders };
  }

  async poll() {
    if (this.stopped || !this.snapshot) return;
    const previous = this.snapshot;
    const next = await this.takeSnapshot();
    this.snapshot = next;
    const structural =
      [...previous.folders].some((folder) => !next.folders.has(folder)) ||
      [...next.folders].some((folder) => !previous.folders.has(folder));
    if (structural) {
      this.bus.publish({ type: 'vault', action: 'reload' });
      return;
    }
    for (const [path] of previous.notes) {
      if (!next.notes.has(path)) this.bus.publish({ type: 'note', action: 'delete', path });
    }
    for (const [path, meta] of next.notes) {
      const old = previous.notes.get(path);
      if (old && old.modifiedAt === meta.modifiedAt && old.size === meta.size) continue;
      const content = await readFile(resolve(this.root, ...path.split('/'))).catch(() => null);
      if (content === null) continue;
      this.bus.publish({ type: 'note', action: 'upsert', path, revision: revisionOf(content) });
    }
  }
}