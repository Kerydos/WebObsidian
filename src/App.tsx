import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { BookOpen, CircleAlert, LoaderCircle } from 'lucide-react';
import { ServerVaultRepository } from './lib/vault/server';
import { OpfsVaultRepository } from './lib/vault/opfs';
import { LoginScreen } from './components/LoginScreen';
import { ConfirmDialog } from './components/ConfirmDialog';
import { SettingsPanel, type SettingsTab } from './components/SettingsPanel';
import { AssistantPanel } from './components/AssistantPanel';
import { Topbar } from './components/layout/Topbar';
import { Sidebar } from './components/layout/Sidebar';
import { Inspector } from './components/layout/Inspector';
import { VaultSwitcher } from './components/dialogs/VaultSwitcher';
import { useVault } from './hooks/useVault';
import { useVaultSync } from './hooks/useVaultSync';
import { useGrammarChecker } from './hooks/useGrammarChecker';
import { useAppearanceTheme } from './hooks/useAppearanceTheme';
import { appearanceVariables } from './lib/settings/appearance';
import { clearLegacyOllamaSettings, readLegacyOllamaSettings } from './lib/settings/ollama';
import { emptyOllamaServerSettings, fetchOllamaSettings, saveOllamaSettings, type OllamaServerSettings } from './lib/ai/ollamaCloud';

const MarkdownEditor = lazy(() => import('./components/MarkdownEditor'));

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
  const [ollama, setOllama] = useState<OllamaServerSettings>(emptyOllamaServerSettings);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance');
  const [switcherOpen, setSwitcherOpen] = useState(false);

  // 서버에 저장된 Ollama Cloud 설정을 불러온다. 과거 버전이 이 브라우저에 저장해 둔 키가
  // 있고 서버에 아직 키가 없으면 한 번만 서버로 이전해 모든 브라우저가 공유하게 한다.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let settings = await fetchOllamaSettings();
        const legacy = readLegacyOllamaSettings();
        if (legacy.apiKey && !settings.hasApiKey) {
          settings = await saveOllamaSettings({
            apiKey: legacy.apiKey,
            ...(settings.model ? {} : legacy.model ? { model: legacy.model } : {}),
          });
        }
        if (legacy.apiKey) clearLegacyOllamaSettings();
        if (!cancelled) setOllama(settings);
      } catch {
        // 설정 로드에 실패하면 미설정 상태를 유지한다(패널이 안내를 표시).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const grammarConfigured = ollama.hasApiKey && ollama.model !== '';
  const grammar = useGrammarChecker({
    model: ollama.model,
    configured: grammarConfigured,
    activePath: vault.activePath,
    getEditorValue: () => vault.editorValueRef.current,
    setEditorValue: vault.setEditorValue,
  });

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
  const openSettings = useCallback((tab: SettingsTab = 'appearance') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  // AI 도우미 답변을 현재 노트 끝에 추가한다. 편집 내용은 기존 자동 저장 흐름을 따른다.
  const { editorValueRef, setEditorValue } = vault;
  const insertAssistantText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const current = editorValueRef.current;
    setEditorValue(current.trim() ? `${current}\n\n${trimmed}\n` : `${trimmed}\n`);
  }, [editorValueRef, setEditorValue]);

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
    <div className="app-shell" data-theme={appearance.theme} data-document-style={appearance.documentStyle} style={appearanceVariables(appearance)}>
      <Topbar
        repositoryName={vault.repository.name}
        saveState={vault.saveState}
        assistantOpen={assistantOpen}
        onToggleAssistant={() => setAssistantOpen((open) => !open)}
        onOpenSettings={() => openSettings()}
        onOpenVaultSwitcher={() => setSwitcherOpen(true)}
        onLogout={() => void logout()}
      />
      <Sidebar vault={vault} />
      <main className="workspace">
        {vault.loading ? (
          <div className="center-state"><LoaderCircle className="spin" /><p>볼트를 여는 중입니다</p></div>
        ) : vault.activePath ? (
          <Suspense fallback={<div className="center-state"><LoaderCircle className="spin" /></div>}>
            <MarkdownEditor
              key={vault.activePath}
              value={vault.editorValue}
              onChange={vault.setEditorValue}
              onNavigateWikiLink={vault.navigateLink}
              onSentenceCommitted={grammar.checkSentence}
            />
          </Suspense>
        ) : (
          <div className="center-state"><BookOpen /><p>노트를 선택하세요.</p></div>
        )}
      </main>
      <Inspector vault={vault} grammar={grammar} grammarConfigured={grammarConfigured} />

      {vault.error ? (
        <div className="toast" role="alert"><CircleAlert size={17} /><span>{vault.error}</span><button onClick={() => vault.setError(undefined)}>닫기</button></div>
      ) : null}
      {settingsOpen ? (
        <SettingsPanel
          appearance={appearance}
          onAppearanceChange={setAppearance}
          ollama={ollama}
          onOllamaUpdated={setOllama}
          initialTab={settingsTab}
          onClose={closeSettings}
        />
      ) : null}
      <AssistantPanel
        open={assistantOpen}
        settings={ollama}
        noteTitle={vault.activeNote?.title}
        noteContent={vault.editorValue}
        onOpenSettings={() => openSettings('ollama')}
        onInsertToNote={insertAssistantText}
        onClose={() => setAssistantOpen(false)}
      />
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
