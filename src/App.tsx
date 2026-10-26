import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { BookOpen, CircleAlert, LoaderCircle } from 'lucide-react';
import { ServerVaultRepository } from './lib/vault/server';
import { OpfsVaultRepository } from './lib/vault/opfs';
import { LoginScreen } from './components/LoginScreen';
import { ConfirmDialog } from './components/ConfirmDialog';
import { SettingsPanel, type SettingsTab } from './components/SettingsPanel';
import { BlogPublishDialog } from './components/BlogPublishDialog';
import { Topbar } from './components/layout/Topbar';
import { Sidebar } from './components/layout/Sidebar';
import { Inspector } from './components/layout/Inspector';
import { VaultSwitcher } from './components/dialogs/VaultSwitcher';
import { useVault } from './hooks/useVault';
import { useVaultSync } from './hooks/useVaultSync';
import { useAppearanceTheme } from './hooks/useAppearanceTheme';
import { appearanceVariables } from './lib/settings/appearance';
import { indexMarkdown } from './lib/markdown/indexer';
import { isExcalidrawPath } from './lib/excalidraw';

const MarkdownEditor = lazy(() => import('./components/MarkdownEditor'));
const ExcalidrawEditor = lazy(() => import('./components/ExcalidrawEditor'));
const TerminalPanel = lazy(() => import('./components/TerminalPanel'));
const SIDEBAR_WIDTH_STORAGE_KEY = 'webobsidian:sidebarwidth:v1';
const SIDEBAR_WIDTH_RANGE = { min: 180, max: 560, default: 252 };
const TERMINAL_HEIGHT_STORAGE_KEY = 'webobsidian:terminalheight:v1';
const TERMINAL_HEIGHT_RANGE = { min: 120, default: 360 };

function clampTerminalHeight(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return TERMINAL_HEIGHT_RANGE.default;
  // 인스펙터 머리글이 최소한 보이도록 위쪽 140px은 남긴다.
  const max = Math.max(TERMINAL_HEIGHT_RANGE.min, window.innerHeight - 52 - 140);
  return Math.min(max, Math.max(TERMINAL_HEIGHT_RANGE.min, Math.round(value)));
}

function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return SIDEBAR_WIDTH_RANGE.default;
  return Math.min(SIDEBAR_WIDTH_RANGE.max, Math.max(SIDEBAR_WIDTH_RANGE.min, Math.round(value)));
}

type AuthStatus = 'checking' | 'authenticated' | 'anonymous';

export function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking');
  const [authError, setAuthError] = useState<string>();

  useEffect(() => {
    fetch('/api/auth/session')
      .then(async (response) => {
        if (!response.ok) throw new Error('서버에 연결할 수 없습니다.');
        const body = await response.json() as { authenticated: boolean };
        setAuthStatus(body.authenticated ? 'authenticated' : 'anonymous');
      })
      .catch(() => {
        setAuthError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
        setAuthStatus('anonymous');
      });
    const unauthorized = () => setAuthStatus('anonymous');
    window.addEventListener('webobsidian:unauthorized', unauthorized);
    return () => window.removeEventListener('webobsidian:unauthorized', unauthorized);
  }, []);

  if (authStatus === 'checking') {
    return <div className="login-shell"><LoaderCircle className="spin" /></div>;
  }
  if (authStatus === 'anonymous') {
    return <LoginScreen initialError={authError} onAuthenticated={() => {
      setAuthError(undefined);
      setAuthStatus('authenticated');
    }} />;
  }
  return <WorkspaceApp onLoggedOut={() => setAuthStatus('anonymous')} />;
}

function WorkspaceApp({ onLoggedOut }: { onLoggedOut: () => void }) {
  const vault = useVault();
  const { appearance, setAppearance } = useAppearanceTheme();
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(() => {
    try { return clampTerminalHeight(Number(window.localStorage.getItem(TERMINAL_HEIGHT_STORAGE_KEY))); }
    catch { return TERMINAL_HEIGHT_RANGE.default; }
  });
  const inspectColumnRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance');
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<{ kind: 'note' | 'folder'; path: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try { return clampSidebarWidth(Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY))); }
    catch { return SIDEBAR_WIDTH_RANGE.default; }
  });
  const scrollToHeadingRef = useRef<((line: number) => void) | null>(null);
  const [readerPosition, setReaderPosition] = useState<{ path: string; line: number }>();
  const headings = useMemo(() => vault.activePath ? indexMarkdown(vault.activePath, vault.editorValue).headings : [], [vault.activePath, vault.editorValue]);
  const visibleLine = readerPosition?.path === vault.activePath ? readerPosition?.line ?? 1 : 1;
  const activeHeading = headings.reduce((active, heading, index) => heading.line <= visibleLine ? index : active, 0);

  useEffect(() => {
    try { window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth)); } catch { /* Session-only setting. */ }
  }, [sidebarWidth]);

  useEffect(() => {
    try { window.localStorage.setItem(TERMINAL_HEIGHT_STORAGE_KEY, String(terminalHeight)); } catch { /* Session-only setting. */ }
  }, [terminalHeight]);

  // 인스펙터와 터미널 사이 경계를 끌어 터미널 높이를 바꾼다(열 아래쪽 끝에서 포인터까지의 거리).
  const startTerminalResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const move = (moveEvent: PointerEvent) => {
      const bottom = inspectColumnRef.current?.getBoundingClientRect().bottom ?? window.innerHeight;
      setTerminalHeight(clampTerminalHeight(bottom - moveEvent.clientY));
    };
    const stop = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
  }, []);

  const startSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const move = (moveEvent: PointerEvent) => setSidebarWidth(clampSidebarWidth(moveEvent.clientX));
    const stop = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
  }, []);


  useVaultSync({
    repository: vault.repository,
    saveActive: vault.saveActive,
    reload: vault.reloadSilently,
    hasDocument: vault.hasDocument,
    onRemoteUpsert: vault.handleNoteUpsert,
    onRemoteDelete: vault.handleNoteDelete,
    onRemoteMove: vault.handleNoteMove,
  });

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('.search-box input')?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  const logout = async () => {
    await vault.saveActive();
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      onLoggedOut();
    }
  };

  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openSettings = useCallback((tab: SettingsTab = 'blog') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  const closeSwitcher = useCallback(() => setSwitcherOpen(false), []);

  // 볼트 전환: 진행 중인 저장을 마친 뒤 새 저장소 어댑터로 전체를 다시 불러온다.
  const selectServerVault = useCallback(async () => {
    setSwitcherOpen(false);
    if (vault.repository.kind === 'server') return;
    await vault.saveActive();
    vault.setSelectedFolder(null);
    await vault.loadRepository(new ServerVaultRepository());
  }, [vault]);

  const selectOpfsVault = useCallback(async () => {
    setSwitcherOpen(false);
    if (vault.repository.kind === 'opfs') return;
    await vault.saveActive();
    vault.setSelectedFolder(null);
    await vault.loadRepository(new OpfsVaultRepository());
  }, [vault]);

  const selectLocalFolder = useCallback(async () => {
    setSwitcherOpen(false);
    await vault.openLocalFolder();
  }, [vault]);

  return (
    <div className={`app-shell theme-${appearance.theme === 'dark' ? 'dark' : 'light'}`} data-theme={appearance.theme} data-document-style={appearance.documentStyle} data-terminal={terminalOpen} style={{ ...appearanceVariables(appearance), '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
      <Topbar
        repositoryName={vault.repository.name}
        saveState={vault.saveState}
        terminalOpen={terminalOpen}
        onToggleTerminal={() => setTerminalOpen((open) => !open)}
        onOpenSettings={() => openSettings()}
        onOpenVaultSwitcher={() => setSwitcherOpen(true)}
        onLogout={() => void logout()}
        activePath={vault.activePath}
        editing={vault.editing}
        onToggleEditing={() => vault.setEditingPath(vault.editing ? undefined : vault.activePath)}
        onPublish={vault.activePath || vault.selectedFolder ? () => setPublishTarget(vault.selectedFolder ? { kind: 'folder', path: vault.selectedFolder } : { kind: 'note', path: vault.activePath! }) : undefined}
        publishLabel={vault.selectedFolder ? '폴더 발행' : '글 발행'}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((open) => !open)}
      />
      <div className="menu-backdrop" data-open={menuOpen} onClick={() => setMenuOpen(false)} />
      <Sidebar vault={vault} menuOpen={menuOpen} onCloseMenu={() => setMenuOpen(false)} onResize={startSidebarResize} onResetWidth={() => setSidebarWidth(SIDEBAR_WIDTH_RANGE.default)} />
      <main className="workspace workspace-leaf-content markdown-rendered markdown-source-view mod-cm6 cm-s-obsidian" data-type="markdown">
        {vault.loading ? (
          <div className="center-state"><LoaderCircle className="spin" /><p>볼트를 여는 중입니다</p></div>
        ) : vault.activePath ? (
          <Suspense fallback={<div className="center-state"><LoaderCircle className="spin" /></div>}>
            {isExcalidrawPath(vault.activePath) ? <ExcalidrawEditor
              key={`${vault.activePath}:${vault.editing}`}
              value={vault.editorValue}
              readOnly={!vault.editing}
              dark={appearance.theme === 'dark'}
              onChange={vault.setEditorValue}
            /> : <MarkdownEditor
              key={`${vault.activePath}:${vault.editing}`}
              value={vault.editorValue}
              readOnly={!vault.editing}
              onChange={vault.setEditorValue}
              onNavigateWikiLink={vault.navigateLink}
              onReady={(scrollToLine) => { scrollToHeadingRef.current = scrollToLine; }}
              onScrollLine={(line) => setReaderPosition((current) => current?.path === vault.activePath && current?.line === line ? current : { path: vault.activePath!, line })}
            />}
          </Suspense>
        ) : (
          <div className="center-state"><BookOpen /><p>노트를 선택하세요.</p></div>
        )}
      </main>
      <div className="inspect-column" ref={inspectColumnRef}>
        <Inspector vault={vault} headings={headings} activeHeading={activeHeading} onJumpToHeading={(line) => scrollToHeadingRef.current?.(line)} />
        {terminalOpen ? (
          <>
            <div
              className="terminal-resizer"
              role="separator"
              aria-orientation="horizontal"
              aria-label="터미널 높이 조절"
              title="끌어서 터미널 높이 조절, 더블클릭으로 기본 높이"
              onPointerDown={startTerminalResize}
              onDoubleClick={() => setTerminalHeight(TERMINAL_HEIGHT_RANGE.default)}
            />
            <Suspense fallback={<aside className="inspector terminal-panel" style={{ height: terminalHeight }}><div className="center-state"><LoaderCircle className="spin" /></div></aside>}>
              <TerminalPanel height={terminalHeight} onClose={() => setTerminalOpen(false)} />
            </Suspense>
          </>
        ) : null}
      </div>

      {publishTarget ? <BlogPublishDialog
        key={`${publishTarget.kind}:${publishTarget.path}`}
        target={publishTarget.kind === 'folder'
          ? { kind: 'folder', path: publishTarget.path, notes: [...vault.documents.values()].filter((note) => note.path.startsWith(`${publishTarget.path}/`)).map((note) => ({ path: note.path, content: note.path === vault.activePath ? vault.editorValue : note.content })) }
          : { kind: 'note', path: publishTarget.path, content: vault.editorValue }}
        onClose={() => setPublishTarget(null)}
        onOpenSettings={() => { setPublishTarget(null); openSettings('blog'); }}
      /> : null}

      {vault.error ? (
        <div className="toast" role="alert"><CircleAlert size={17} /><span>{vault.error}</span><button onClick={() => vault.setError(undefined)}>닫기</button></div>
      ) : null}
      {settingsOpen ? (
        <SettingsPanel
          appearance={appearance}
          onAppearanceChange={setAppearance}
          initialTab={settingsTab}
          onClose={closeSettings}
        />
      ) : null}
      {switcherOpen ? (
        <VaultSwitcher
          currentKind={vault.repository.kind}
          currentName={vault.repository.name}
          localSupported={Boolean(window.showDirectoryPicker)}
          onSelectServer={() => void selectServerVault()}
          onSelectLocal={() => void selectLocalFolder()}
          onSelectOpfs={() => void selectOpfsVault()}
          onClose={closeSwitcher}
        />
      ) : null}
      {vault.deleteTarget ? (
        <ConfirmDialog
          title="노트 삭제"
          message={`'${vault.deleteTarget}' 노트를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
          confirmLabel="삭제"
          danger
          onConfirm={() => void vault.confirmDeleteNote()}
          onCancel={() => vault.setDeleteTarget(null)}
        />
      ) : null}
      {vault.deleteFolderTarget ? (
        <ConfirmDialog
          title="폴더 삭제"
          message={`'${vault.deleteFolderTarget}' 폴더와 그 안의 모든 노트를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
          confirmLabel="삭제"
          danger
          onConfirm={() => void vault.confirmDeleteFolder()}
          onCancel={() => vault.setDeleteFolderTarget(null)}
        />
      ) : null}
    </div>
  );
}
