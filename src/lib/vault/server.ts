import type { VaultDocument, VaultEntry, VaultFolderEntry, VaultRepository } from '../../types/vault';
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

  async listFolders(): Promise<VaultFolderEntry[]> {
    const result = await request<{ folders: VaultFolderEntry[] }>('/api/vault');
    return result.folders;
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

  createFolder(path: string): Promise<VaultFolderEntry> {
    return request(`/api/vault/folder?path=${encodeURIComponent(normalizeVaultPath(path))}`, { method: 'POST' });
  }

  async remove(path: string): Promise<void> {
    await request(fileUrl(path), { method: 'DELETE' });
  }

  async removeFolder(path: string): Promise<void> {
    await request(`/api/vault/folder?path=${encodeURIComponent(normalizeVaultPath(path))}`, { method: 'DELETE' });
  }

  rename(path: string, newPath: string): Promise<VaultDocument> {
    return request(fileUrl(path), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPath: normalizeVaultPath(newPath) }),
    });
  }

  renameFolder(path: string, newPath: string): Promise<VaultFolderEntry> {
    return request(`/api/vault/folder?path=${encodeURIComponent(normalizeVaultPath(path))}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPath: normalizeVaultPath(newPath) }),
    });
  }
}

export type VaultChangeEvent = {
  type: 'note' | 'vault';
  action: 'upsert' | 'delete' | 'move' | 'reload';
  path?: string;
  newPath?: string;
  revision?: string;
};

// 서버 볼트의 변경 이벤트 스트림(SSE)을 구독한다. 연결이 끊기면 브라우저가 자동으로 재시도하고,
// 세션 만료 등으로 스트림이 닫히면 세션을 확인한 뒤 재연결하거나 로그인 화면으로 보낸다.
export function subscribeVaultChanges(onChange: (event: VaultChangeEvent) => void): () => void {
  let source: EventSource | null = null;
  let reconnectTimer: number | null = null;
  let closed = false;

  const reconnect = () => {
    if (closed || reconnectTimer !== null) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      open();
    }, 5000);
  };

  const open = () => {
    source = new EventSource('/api/vault/events');
    source.onmessage = (message) => {
      try {
        onChange(JSON.parse(message.data) as VaultChangeEvent);
      } catch {
        // 잘못된 이벤트 페이로드는 무시한다.
      }
    };
    source.onerror = () => {
      if (closed || !source || source.readyState !== EventSource.CLOSED) return;
      source.close();
      source = null;
      void fetch('/api/auth/session')
        .then(async (response) => {
          if (!response.ok) throw new Error('session check failed');
          const body = await response.json() as { authenticated: boolean };
          if (!body.authenticated) {
            window.dispatchEvent(new Event('webobsidian:unauthorized'));
            return;
          }
          reconnect();
        })
        .catch(() => reconnect());
    };
  };

  open();
  return () => {
    closed = true;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    source?.close();
  };
}
