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

export interface VaultRepository {
  readonly kind: VaultKind;
  readonly name: string;
  list(): Promise<VaultEntry[]>;
  read(path: string): Promise<VaultDocument>;
  write(path: string, content: string, expectedRevision?: string): Promise<VaultDocument>;
  create(path: string, content?: string): Promise<VaultDocument>;
}
