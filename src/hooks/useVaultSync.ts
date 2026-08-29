import { useCallback, useEffect, useRef } from 'react';
import type { VaultRepository } from '../types/vault';
import { subscribeVaultChanges } from '../lib/vault/server';

interface UseVaultSyncOptions {
  repository: VaultRepository;
  saveActive: () => Promise<void>;
  reload: () => Promise<void>;
  hasDocument: (path: string) => boolean;
  onRemoteUpsert: (path: string, revision?: string) => Promise<void>;
  onRemoteDelete: (path: string) => void;
  onRemoteMove: (path: string, newPath: string) => void;
}

// 서버 볼트 변경 이벤트(SSE)를 구독해 다른 브라우저·외부 변경을 화면에 반영한다.
// 단일 파일 변경은 그 파일만 갱신하고, 구조가 바뀌는 변경은 재연결·디바운스를 거쳐 전체 재조회한다.
export function useVaultSync({ repository, saveActive, reload, hasDocument, onRemoteUpsert, onRemoteDelete, onRemoteMove }: UseVaultSyncOptions) {
  const timerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const pendingRef = useRef(false);

  const scheduleReload = useCallback((delay = 300) => {
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (runningRef.current) {
        pendingRef.current = true;
        return;
      }
      runningRef.current = true;
      void (async () => {
        try {
          await saveActive();
          await reload();
        } finally {
          runningRef.current = false;
          if (pendingRef.current) {
            pendingRef.current = false;
            scheduleReload(0);
          }
        }
      })();
    }, delay);
  }, [saveActive, reload]);

  useEffect(() => {
    if (repository.kind !== 'server') return;
    return subscribeVaultChanges((event) => {
      if (event.type === 'note' && event.action === 'upsert' && event.path) {
        void onRemoteUpsert(event.path, event.revision);
        return;
      }
      if (event.type === 'note' && event.action === 'delete' && event.path) {
        onRemoteDelete(event.path);
        return;
      }
      if (event.type === 'note' && event.action === 'move' && event.path && event.newPath) {
        // 목록에 없는 노트의 이동은 로컬에서 좌표를 알 수 없으므로 전체 재조회로 처리한다.
        if (hasDocument(event.path)) onRemoteMove(event.path, event.newPath);
        else scheduleReload();
        return;
      }
      scheduleReload();
    });
  }, [repository, onRemoteUpsert, onRemoteDelete, onRemoteMove, hasDocument, scheduleReload]);
}
