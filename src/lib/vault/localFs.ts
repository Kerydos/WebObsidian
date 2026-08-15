import type { VaultDocument, VaultEntry, VaultRepository } from '../../types/vault';
import { fileName, normalizeVaultPath } from './path';

async function scan(directory: FileSystemDirectoryHandle, prefix = ''): Promise<VaultEntry[]> {
  const entries: VaultEntry[] = [];
  for await (const [name, handle] of directory.entries()) {
    if (name === '.git' || name === '.trash') continue;
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

async function locate(root: FileSystemDirectoryHandle, path: string, create = false) {
  const segments = normalizeVaultPath(path).split('/');
  const name = segments.pop()!;
  let directory = root;
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create });
  }
  return { directory, name };
}

export class LocalFsVaultRepository implements VaultRepository {
  readonly kind = 'local' as const;
  readonly name: string;

  constructor(private readonly root: FileSystemDirectoryHandle) {
    this.name = root.name;
  }

  async list() {
    return (await scan(this.root)).sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(path: string): Promise<VaultDocument> {
    const normalized = normalizeVaultPath(path);
    const { directory, name } = await locate(this.root, normalized);
    const file = await (await directory.getFileHandle(name)).getFile();
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
    const { directory, name } = await locate(this.root, normalized, true);
    const handle = await directory.getFileHandle(name, { create: true });
    if (expectedRevision) {
      const current = await handle.getFile();
      if (String(current.lastModified) !== expectedRevision) {
        throw new Error('외부에서 파일이 변경되었습니다. 다시 연 뒤 편집해 주세요.');
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
}
