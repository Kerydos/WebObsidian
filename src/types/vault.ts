export type VaultKind = 'server' | 'opfs' | 'local';

export interface VaultEntry {
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
}

export interface VaultDocument extends VaultEntry {
  content: string;
  revision: string;
}

export interface VaultFolderEntry {
  path: string;
  name: string;
}

export interface VaultRepository {
  readonly kind: VaultKind;
  readonly name: string;
  list(): Promise<VaultEntry[]>;
  listFolders(): Promise<VaultFolderEntry[]>;
  read(path: string): Promise<VaultDocument>;
  write(path: string, content: string, expectedRevision?: string): Promise<VaultDocument>;
  create(path: string, content?: string): Promise<VaultDocument>;
  createFolder(path: string): Promise<VaultFolderEntry>;
  remove(path: string): Promise<void>;
  removeFolder(path: string): Promise<void>;
  rename(path: string, newPath: string): Promise<VaultDocument>;
  renameFolder(path: string, newPath: string): Promise<VaultFolderEntry>;
}
