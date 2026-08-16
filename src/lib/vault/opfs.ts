import type { VaultDocument, VaultEntry, VaultFolderEntry, VaultRepository } from '../../types/vault';
import { fileName, normalizeVaultPath } from './path';

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

async function getParent(path: string, create: boolean) {
  const segments = normalizeVaultPath(path).split('/');
  const name = segments.pop()!;
  let directory = await getRoot();
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create });
  }
  return { directory, name };
}

async function scan(directory: FileSystemDirectoryHandle, prefix = ''): Promise<VaultEntry[]> {
  const entries: VaultEntry[] = [];
  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      entries.push(...(await scan(handle, path)));
    } else if (name.toLowerCase().endsWith('.md')) {
      const file = await handle.getFile();
      entries.push({ path, name, size: file.size, modifiedAt: file.lastModified });
    }
  }
  return entries;
}

async function scanFolders(directory: FileSystemDirectoryHandle, prefix = ''): Promise<VaultFolderEntry[]> {
  const folders: VaultFolderEntry[] = [];
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== 'directory') continue;
    const path = prefix ? `${prefix}/${name}` : name;
    folders.push({ path, name });
    folders.push(...(await scanFolders(handle, path)));
  }
  return folders;
}

export class OpfsVaultRepository implements VaultRepository {
  readonly kind = 'opfs' as const;
  readonly name = 'Browser Vault';

  async list() {
    return (await scan(await getRoot())).sort((a, b) => a.path.localeCompare(b.path));
  }

  async listFolders() {
    return (await scanFolders(await getRoot())).sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(path: string): Promise<VaultDocument> {
    const normalized = normalizeVaultPath(path);
    const { directory, name } = await getParent(normalized, false);
    const handle = await directory.getFileHandle(name);
    const file = await handle.getFile();
    return {
      path: normalized,
      name: fileName(normalized),
      size: file.size,
      modifiedAt: file.lastModified,
      revision: String(file.lastModified),
      content: await file.text(),
    };
  }

  async write(path: string, content: string, expectedRevision?: string) {
    const normalized = normalizeVaultPath(path);
    const { directory, name } = await getParent(normalized, true);
    const handle = await directory.getFileHandle(name, { create: true });
    if (expectedRevision) {
      const current = await handle.getFile();
      if (String(current.lastModified) !== expectedRevision) {
        throw new Error('다른 탭에서 파일이 변경되었습니다. 다시 연 뒤 편집해 주세요.');
      }
    }
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return this.read(normalized);
  }

  create(path: string, content = '') {
    return this.write(path, content);
  }

  async createFolder(path: string): Promise<VaultFolderEntry> {
    const normalized = normalizeVaultPath(path);
    let directory = await getRoot();
    for (const segment of normalized.split('/')) {
      directory = await directory.getDirectoryHandle(segment, { create: true });
    }
    return { path: normalized, name: fileName(normalized) };
  }
}
