import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { VaultChangeBus } from './events.mjs';

const INVALID_SEGMENT = /(^|\/)\.{1,2}(\/|$)|[\\\0]/;
const CREATED_MAP_FILE = '.webobsidian-created.json';

// 앱이 아직 저장한 적 없는 파일은 birthtime이 실제 생성 시각이다. 파일 시스템이 birthtime을
// 제공하지 않으면 0이 나오므로 수정 시각으로 대신한다.
function createdFallback(details) {
  return details.birthtimeMs ? Math.min(details.birthtimeMs, details.mtimeMs) : details.mtimeMs;
}

export class VaultError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function normalizeVaultPath(path) {
  if (typeof path !== 'string') throw new VaultError('파일 경로가 필요합니다.');
  const normalized = path.trim().replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  if (!normalized || INVALID_SEGMENT.test(normalized) || !normalized.toLowerCase().endsWith('.md')) {
    throw new VaultError('올바른 Markdown 파일 경로가 아닙니다.');
  }
  return normalized;
}

export function normalizeFolderPath(path) {
  if (typeof path !== 'string') throw new VaultError('폴더 경로가 필요합니다.');
  const normalized = path.trim().replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  if (!normalized || INVALID_SEGMENT.test(normalized)) {
    throw new VaultError('올바르지 않은 폴더 경로입니다.');
  }
  return normalized;
}

export function revisionOf(content) {
  return createHash('sha256').update(content).digest('hex');
}

function isInside(root, target) {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..');
}

export class FileVault {
  constructor(root) {
    this.root = resolve(root);
    this.writeQueue = Promise.resolve();
    this.changes = new VaultChangeBus();
    this.createdMapPath = resolve(this.root, CREATED_MAP_FILE);
    this.created = {};
    this.createdSaveTimer = null;
  }

  async initialize() {
    await mkdir(this.root, { recursive: true });
    this.realRoot = await realpath(this.root);
    try {
      const parsed = JSON.parse(await readFile(this.createdMapPath, 'utf8'));
      if (parsed && typeof parsed === 'object') this.created = parsed;
    } catch {
      this.created = {};
    }
  }

  // 원자적 저장이 임시 파일을 rename 하므로 파일 시스템의 birthtime은 저장할 때마다 새로 생긴다.
  // 그래서 노트별 생성 시각은 볼트 루트의 JSON 맵에 따로 보관한다.
  rememberCreated(vaultPath, fallback) {
    const known = this.created[vaultPath];
    if (typeof known === 'number') return known;
    this.created[vaultPath] = fallback;
    this.saveCreatedMap();
    return fallback;
  }

  rekeyCreated(sourcePrefix, destPrefix) {
    for (const key of Object.keys(this.created)) {
      if (key !== sourcePrefix && !key.startsWith(`${sourcePrefix}/`)) continue;
      this.created[destPrefix + key.slice(sourcePrefix.length)] = this.created[key];
      delete this.created[key];
    }
    this.saveCreatedMap();
  }

  dropCreated(prefix) {
    for (const key of Object.keys(this.created)) {
      if (key === prefix || key.startsWith(`${prefix}/`)) delete this.created[key];
    }
    this.saveCreatedMap();
  }

  saveCreatedMap() {
    if (this.createdSaveTimer) return;
    this.createdSaveTimer = setTimeout(() => {
      this.createdSaveTimer = null;
      void writeFile(this.createdMapPath, JSON.stringify(this.created), { mode: 0o600 }).catch(() => undefined);
    }, 200);
    this.createdSaveTimer.unref?.();
  }

  async entryFor(filePath, vaultPath, content) {
    const details = await stat(filePath);
    const fileContent = content ?? (await readFile(filePath));
    return {
      path: vaultPath,
      name: basename(vaultPath),
      size: details.size,
      modifiedAt: details.mtimeMs,
      createdAt: this.rememberCreated(vaultPath, createdFallback(details)),
      revision: revisionOf(fileContent),
      content: fileContent.toString('utf8'),
    };
  }

  resolvePath(path) {
    const vaultPath = normalizeVaultPath(path);
    const filePath = resolve(this.root, ...vaultPath.split('/'));
    if (!isInside(this.root, filePath)) throw new VaultError('볼트 밖의 경로에는 접근할 수 없습니다.');
    return { vaultPath, filePath };
  }

  resolveFolderPath(path) {
    const vaultPath = normalizeFolderPath(path);
    const folderPath = resolve(this.root, ...vaultPath.split('/'));
    if (!isInside(this.root, folderPath)) throw new VaultError('볼트 밖의 경로에는 접근할 수 없습니다.');
    return { vaultPath, folderPath };
  }

  async scan() {
    const entries = [];
    const folders = [];
    const scan = async (directory, prefix = '') => {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        if (item.isSymbolicLink() || item.name === '.git' || item.name === '.trash') continue;
        const itemPath = resolve(directory, item.name);
        const vaultPath = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.isDirectory()) {
          folders.push({ path: vaultPath, name: item.name });
          await scan(itemPath, vaultPath);
        } else if (item.isFile() && item.name.toLowerCase().endsWith('.md')) {
          const details = await stat(itemPath);
          entries.push({
            path: vaultPath,
            name: item.name,
            size: details.size,
            modifiedAt: details.mtimeMs,
            createdAt: this.rememberCreated(vaultPath, createdFallback(details)),
          });
        }
      }
    };
    await scan(this.root);
    return {
      entries: entries.sort((a, b) => a.path.localeCompare(b.path)),
      folders: folders.sort((a, b) => a.path.localeCompare(b.path)),
    };
  }

  async list() {
    return (await this.scan()).entries;
  }

  async createFolder(path) {
    const { vaultPath, folderPath } = this.resolveFolderPath(path);
    const existing = await lstat(folderPath).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (existing) {
      if (existing.isSymbolicLink()) throw new VaultError('심볼릭 링크에는 접근할 수 없습니다.');
      if (existing.isDirectory()) throw new VaultError('같은 이름의 폴더가 이미 있습니다.', 409);
      throw new VaultError('같은 이름의 파일이 이미 있습니다.', 409);
    }
    await mkdir(folderPath, { recursive: true });
    const realFolder = await realpath(folderPath);
    if (!isInside(this.realRoot, realFolder)) throw new VaultError('볼트 밖의 경로에는 접근할 수 없습니다.');
    this.changes.publish({ type: 'vault', action: 'reload' });
    return { path: vaultPath, name: basename(vaultPath) };
  }

  async read(path) {
    const { vaultPath, filePath } = this.resolvePath(path);
    try {
      const details = await lstat(filePath);
      if (details.isSymbolicLink()) throw new VaultError('심볼릭 링크에는 접근할 수 없습니다.');
      const realFile = await realpath(filePath);
      if (!isInside(this.realRoot, realFile)) throw new VaultError('볼트 밖의 경로에는 접근할 수 없습니다.');
      return await this.entryFor(filePath, vaultPath);
    } catch (error) {
      if (error?.code === 'ENOENT') throw new VaultError('파일을 찾을 수 없습니다.', 404);
      throw error;
    }
  }

  write(path, content, options = {}) {
    const operation = this.writeQueue.then(() => this.writeFile(path, content, options));
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async writeFile(path, content, { expectedRevision, createOnly = false } = {}) {
    if (typeof content !== 'string') throw new VaultError('파일 내용은 문자열이어야 합니다.');
    const { vaultPath, filePath } = this.resolvePath(path);
    const parent = dirname(filePath);
    await mkdir(parent, { recursive: true });
    const realParent = await realpath(parent);
    if (!isInside(this.realRoot, realParent)) throw new VaultError('볼트 밖의 경로에는 접근할 수 없습니다.');

    let current;
    try {
      if ((await lstat(filePath)).isSymbolicLink()) throw new VaultError('심볼릭 링크에는 접근할 수 없습니다.');
      current = await readFile(filePath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (createOnly && current) throw new VaultError('같은 경로의 노트가 이미 있습니다.', 409);
    if (expectedRevision && (!current || revisionOf(current) !== expectedRevision)) {
      throw new VaultError('서버에서 파일이 변경되었습니다. 다시 연 뒤 편집해 주세요.', 409);
    }

    const temporaryPath = resolve(parent, `.${basename(filePath)}.${randomUUID()}.tmp`);
    try {
      const temporary = await open(temporaryPath, 'wx');
      try {
        await temporary.writeFile(content, 'utf8');
        await temporary.sync();
      } finally {
        await temporary.close();
      }
      await rename(temporaryPath, filePath);
    } finally {
      await unlink(temporaryPath).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    }
    const saved = await this.entryFor(filePath, vaultPath, Buffer.from(content));
    this.changes.publish({ type: 'note', action: 'upsert', path: vaultPath, revision: saved.revision });
    return saved;
  }

  remove(path) {
    const operation = this.writeQueue.then(() => this.removeFile(path));
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async removeFile(path) {
    const { vaultPath, filePath } = this.resolvePath(path);
    try {
      const details = await lstat(filePath);
      if (details.isSymbolicLink()) throw new VaultError('심볼릭 링크에는 접근할 수 없습니다.');
      const realFile = await realpath(filePath);
      if (!isInside(this.realRoot, realFile)) throw new VaultError('볼트 밖의 경로에는 접근할 수 없습니다.');
    } catch (error) {
      if (error?.code === 'ENOENT') throw new VaultError('파일을 찾을 수 없습니다.', 404);
      throw error;
    }
    await unlink(filePath);
    this.dropCreated(vaultPath);
    this.changes.publish({ type: 'note', action: 'delete', path: vaultPath });
  }

  move(path, newPath) {
    const operation = this.writeQueue.then(() => this.moveFile(path, newPath));
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async moveFile(path, newPath) {
    const { vaultPath: sourceVaultPath, filePath: source } = this.resolvePath(path);
    const { vaultPath: destVaultPath, filePath: destination } = this.resolvePath(newPath);
    try {
      const details = await lstat(source);
      if (details.isSymbolicLink()) throw new VaultError('심볼릭 링크에는 접근할 수 없습니다.');
      const realFile = await realpath(source);
      if (!isInside(this.realRoot, realFile)) throw new VaultError('볼트 밖의 경로에는 접근할 수 없습니다.');
    } catch (error) {
      if (error?.code === 'ENOENT') throw new VaultError('파일을 찾을 수 없습니다.', 404);
      throw error;
    }
    if (source === destination) return this.entryFor(source, destVaultPath);

    const destExists = await lstat(destination).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (destExists) throw new VaultError('같은 경로의 노트가 이미 있습니다.', 409);

    const destParent = dirname(destination);
    await mkdir(destParent, { recursive: true });
    const realDestParent = await realpath(destParent);
    if (!isInside(this.realRoot, realDestParent)) throw new VaultError('볼트 밖의 경로에는 접근할 수 없습니다.');

    await rename(source, destination);
    this.rekeyCreated(sourceVaultPath, destVaultPath);
    const moved = await this.entryFor(destination, destVaultPath);
    this.changes.publish({ type: 'note', action: 'move', path: sourceVaultPath, newPath: destVaultPath, revision: moved.revision });
    return moved;
  }

  moveFolder(path, newPath) {
    const operation = this.writeQueue.then(() => this.moveFolderEntry(path, newPath));
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async moveFolderEntry(path, newPath) {
    const { vaultPath: sourceVaultPath, folderPath: source } = this.resolveFolderPath(path);
    const { vaultPath: destVaultPath, folderPath: destination } = this.resolveFolderPath(newPath);
    if (destVaultPath === sourceVaultPath) {
      const details = await lstat(source).catch((error) => {
        if (error?.code === 'ENOENT') throw new VaultError('폴더를 찾을 수 없습니다.', 404);
        throw error;
      });
      if (details.isSymbolicLink() || !details.isDirectory()) throw new VaultError('폴더를 찾을 수 없습니다.', 404);
      return { path: sourceVaultPath, name: basename(sourceVaultPath) };
    }
    if (destVaultPath.startsWith(`${sourceVaultPath}/`)) {
      throw new VaultError('폴더를 그 하위 폴더로 이동할 수 없습니다.');
    }

    try {
      const details = await lstat(source);
      if (details.isSymbolicLink() || !details.isDirectory()) throw new VaultError('폴더를 찾을 수 없습니다.', 404);
      const realFolder = await realpath(source);
      if (!isInside(this.realRoot, realFolder)) throw new VaultError('볼트 밖의 경로에는 접근할 수 없습니다.');
    } catch (error) {
      if (error?.code === 'ENOENT') throw new VaultError('폴더를 찾을 수 없습니다.', 404);
      throw error;
    }

    const destExists = await lstat(destination).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (destExists) throw new VaultError('같은 이름의 항목이 이미 있습니다.', 409);

    const destParent = dirname(destination);
    await mkdir(destParent, { recursive: true });
    const realDestParent = await realpath(destParent);
    if (!isInside(this.realRoot, realDestParent)) throw new VaultError('볼트 밖의 경로에는 접근할 수 없습니다.');

    await rename(source, destination);
    this.rekeyCreated(sourceVaultPath, destVaultPath);
    this.changes.publish({ type: 'vault', action: 'reload' });
    return { path: destVaultPath, name: basename(destVaultPath) };
  }

  removeFolder(path) {
    const operation = this.writeQueue.then(() => this.removeFolderEntry(path));
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async removeFolderEntry(path) {
    const { vaultPath, folderPath } = this.resolveFolderPath(path);
    if (folderPath === this.root) throw new VaultError('볼트 루트는 삭제할 수 없습니다.');
    let details;
    try {
      details = await lstat(folderPath);
    } catch (error) {
      if (error?.code === 'ENOENT') throw new VaultError('폴더를 찾을 수 없습니다.', 404);
      throw error;
    }
    if (details.isSymbolicLink()) throw new VaultError('심볼릭 링크에는 접근할 수 없습니다.');
    if (!details.isDirectory()) throw new VaultError('폴더를 찾을 수 없습니다.', 404);
    const realFolder = await realpath(folderPath);
    if (!isInside(this.realRoot, realFolder)) throw new VaultError('볼트 밖의 경로에는 접근할 수 없습니다.');
    await rm(folderPath, { recursive: true });
    this.dropCreated(vaultPath);
    this.changes.publish({ type: 'vault', action: 'reload' });
  }
}
