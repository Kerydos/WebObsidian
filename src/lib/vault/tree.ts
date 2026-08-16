import type { VaultEntry, VaultFolderEntry } from '../../types/vault';

export type VaultTreeRow =
  | { kind: 'folder'; path: string; name: string; depth: number }
  | { kind: 'note'; entry: VaultEntry; depth: number };

function parentOf(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator === -1 ? '' : path.slice(0, separator);
}

export function buildVaultTree(entries: VaultEntry[], folders: VaultFolderEntry[]): VaultTreeRow[] {
  const folderPaths = new Set(folders.map((folder) => folder.path));
  for (const entry of entries) {
    const segments = entry.path.split('/');
    for (let end = 1; end < segments.length; end += 1) {
      folderPaths.add(segments.slice(0, end).join('/'));
    }
  }

  const childFolders = new Map<string, string[]>();
  for (const path of folderPaths) {
    const parent = parentOf(path);
    const siblings = childFolders.get(parent) ?? [];
    siblings.push(path);
    childFolders.set(parent, siblings);
  }

  const childNotes = new Map<string, VaultEntry[]>();
  for (const entry of entries) {
    const parent = parentOf(entry.path);
    const siblings = childNotes.get(parent) ?? [];
    siblings.push(entry);
    childNotes.set(parent, siblings);
  }

  const rows: VaultTreeRow[] = [];
  const walk = (parent: string, depth: number) => {
    for (const path of (childFolders.get(parent) ?? []).sort((a, b) => a.localeCompare(b))) {
      rows.push({ kind: 'folder', path, name: path.slice(path.lastIndexOf('/') + 1), depth });
      walk(path, depth + 1);
    }
    for (const entry of (childNotes.get(parent) ?? []).sort((a, b) => a.path.localeCompare(b.path))) {
      rows.push({ kind: 'note', entry, depth });
    }
  };
  walk('', 0);
  return rows;
}
