import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';

const INVALID_SEGMENT = /(^|\/)\.{1,2}(\/|$)|[\\\0]/;

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

function revisionOf(content) {
  return createHash('sha256').update(content).digest('hex');
}

function isInside(root, target) {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..');
}

async function entryFor(filePath, vaultPath, content) {
  const details = await stat(filePath);
  const fileContent = content ?? (await readFile(filePath));
  return {
    path: vaultPath,
    name: basename(vaultPath),
    size: details.size,
    modifiedAt: details.mtimeMs,
    revision: revisionOf(fileContent),
    content: fileContent.toString('utf8'),
  };
}

export class FileVault {
  constructor(root) {
    this.root = resolve(root);
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    await mkdir(this.root, { recursive: true });
    this.realRoot = await realpath(this.root);
  }

  resolvePath(path) {
    const vaultPath = normalizeVaultPath(path);
    const filePath = resolve(this.root, ...vaultPath.split('/'));
    if (!isInside(this.root, filePath)) throw new VaultError('볼트 밖의 경로에는 접근할 수 없습니다.');
    return { vaultPath, filePath };
  }

  async list() {
    const entries = [];
    const scan = async (directory, prefix = '') => {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        if (item.isSymbolicLink() || item.name === '.git' || item.name === '.trash') continue;
        const itemPath = resolve(directory, item.name);
        const vaultPath = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.isDirectory()) await scan(itemPath, vaultPath);
        else if (item.isFile() && item.name.toLowerCase().endsWith('.md')) {
          const details = await stat(itemPath);
          entries.push({ path: vaultPath, name: item.name, size: details.size, modifiedAt: details.mtimeMs });
        }
      }
    };
    await scan(this.root);
    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(path) {
    const { vaultPath, filePath } = this.resolvePath(path);
    try {
      const details = await lstat(filePath);
      if (details.isSymbolicLink()) throw new VaultError('심볼릭 링크에는 접근할 수 없습니다.');
      const realFile = await realpath(filePath);
      if (!isInside(this.realRoot, realFile)) throw new VaultError('볼트 밖의 경로에는 접근할 수 없습니다.');
      return await entryFor(filePath, vaultPath);
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
    return entryFor(filePath, vaultPath, Buffer.from(content));
  }
}
