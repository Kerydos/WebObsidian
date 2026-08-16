import type { VaultDocument, VaultEntry, VaultRepository } from '../../types/vault';
import { normalizeVaultPath } from './path';

type ErrorResponse = { error?: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('webobsidian:unauthorized'));
    const body = (await response.json().catch(() => ({}))) as ErrorResponse;
    throw new Error(body.error ?? `서버 요청에 실패했습니다. (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function fileUrl(path: string) {
  return `/api/vault/file?path=${encodeURIComponent(normalizeVaultPath(path))}`;
}

export class ServerVaultRepository implements VaultRepository {
  readonly kind = 'server' as const;
  readonly name = 'Server Vault';

  async list(): Promise<VaultEntry[]> {
    const result = await request<{ entries: VaultEntry[] }>('/api/vault');
    return result.entries;
  }

  read(path: string): Promise<VaultDocument> {
    return request(fileUrl(path));
  }

  write(path: string, content: string, expectedRevision?: string): Promise<VaultDocument> {
    return request(fileUrl(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, expectedRevision }),
    });
  }

  create(path: string, content = ''): Promise<VaultDocument> {
    return request(fileUrl(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, createOnly: true }),
    });
  }
}
