import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  FilePlus2,
  FolderOpen,
  Hash,
  HardDrive,
  Link2,
  LoaderCircle,
  LogOut,
  Search,
  Sparkles,
} from 'lucide-react';
import type { VaultDocument, VaultEntry, VaultRepository } from './types/vault';
import { ServerVaultRepository } from './lib/vault/server';
import { LocalFsVaultRepository } from './lib/vault/localFs';
import { ensureMarkdownPath } from './lib/vault/path';
import { backlinksFor, indexMarkdown, resolveLink, type NoteIndex } from './lib/markdown/indexer';
import { VaultSearchIndex } from './lib/search/searchIndex';
import { db } from './lib/cache/database';
import { LoginScreen } from './components/LoginScreen';

const MarkdownEditor = lazy(() => import('./components/MarkdownEditor'));

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

const welcomeNote = `# WebObsidian에 오신 것을 환영합니다

노트는 현재 선택한 볼트 저장소에 Markdown 파일로 저장됩니다.

## 시작하기

- 왼쪽 위의 새 노트 버튼으로 문서를 만드세요.
- \`[[노트 이름]]\` 형식으로 노트를 연결하세요.
- 검색창에서 제목, 본문, #태그를 검색하세요.
- Chromium 브라우저에서는 **로컬 폴더 열기**로 기존 Markdown 볼트를 연결할 수 있습니다.

[[프로젝트 아이디어]] #welcome
`;

function messageOf(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return '폴더 선택을 취소했습니다.';
  return error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
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
  const [repository, setRepository] = useState<VaultRepository>(() => new ServerVaultRepository());
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [documents, setDocuments] = useState<Map<string, VaultDocument>>(() => new Map());
  const [activePath, setActivePath] = useState<string>();
  const [editorValue, setEditorValue] = useState('');
  const [query, setQuery] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const activePathRef = useRef(activePath);
  const editorValueRef = useRef(editorValue);
  const documentsRef = useRef(documents);
  const savePromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => void (activePathRef.current = activePath), [activePath]);
  useEffect(() => void (editorValueRef.current = editorValue), [editorValue]);
  useEffect(() => void (documentsRef.current = documents), [documents]);

  const notes = useMemo(
    () => [...documents.values()].map((document) => indexMarkdown(document.path, document.content)),
    [documents],
  );

  const searchIndex = useMemo(() => {
    const index = new VaultSearchIndex();
    index.replaceAll(
      [...documents.values()].map((document) => ({
        ...indexMarkdown(document.path, document.content),
        content: document.content,
      })),
    );
    return index;
  }, [documents]);

  const searchResults = useMemo(() => searchIndex.search(query), [query, searchIndex]);
  const activeNote = notes.find((note) => note.path === activePath);
  const backlinks = activePath ? backlinksFor(activePath, notes) : [];

  const loadRepository = useCallback(async (nextRepository: VaultRepository) => {
    setLoading(true);
    setError(undefined);
    try {
      let nextEntries = await nextRepository.list();
      if (nextEntries.length === 0) {
        await nextRepository.create('Welcome.md', welcomeNote);
        nextEntries = await nextRepository.list();
      }
      const loaded = await Promise.all(nextEntries.map((entry) => nextRepository.read(entry.path)));
      const nextDocuments = new Map(loaded.map((document) => [document.path, document]));
      await db.transaction('rw', db.notes, async () => {
        await db.notes.where('vault').equals(nextRepository.name).delete();
        await db.notes.bulkPut(
          loaded.map((document) => ({
            vault: nextRepository.name,
            path: document.path,
            modifiedAt: document.modifiedAt,
            content: document.content,
          })),
        );
      });
      setRepository(nextRepository);
      setEntries(nextEntries);
      setDocuments(nextDocuments);
      const firstPath = nextEntries[0]?.path;
      setActivePath(firstPath);
      setEditorValue(firstPath ? nextDocuments.get(firstPath)?.content ?? '' : '');
      setSaveState('saved');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void navigator.storage.persist?.();
    void loadRepository(repository);
    // The initial repository is intentionally loaded once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRepository]);

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

  const saveActive = useCallback(async () => {
    if (savePromiseRef.current) return savePromiseRef.current;
    const path = activePathRef.current;
    const current = path ? documentsRef.current.get(path) : undefined;
    const content = editorValueRef.current;
    if (!path || !current || current.content === content) return;

    setSaveState('saving');
    const operation = repository
      .write(path, content, current.revision)
      .then(async (saved) => {
        setDocuments((previous) => {
          const next = new Map(previous);
          next.set(path, saved);
          return next;
        });
        setEntries((previous) => previous.map((entry) => (entry.path === path ? saved : entry)));
        await db.notes.put({
          vault: repository.name,
          path,
          modifiedAt: saved.modifiedAt,
          content: saved.content,
        });
        if (activePathRef.current === path && editorValueRef.current === content) setSaveState('saved');
      })
      .catch((cause) => {
        setSaveState('error');
        setError(messageOf(cause));
      })
      .finally(() => {
        savePromiseRef.current = null;
      });
    savePromiseRef.current = operation;
    return operation;
  }, [repository]);

  useEffect(() => {
    const current = activePath ? documents.get(activePath) : undefined;
    if (!current || current.content === editorValue) return;
    setSaveState('dirty');
    const timer = window.setTimeout(() => void saveActive(), 650);
    return () => window.clearTimeout(timer);
  }, [activePath, documents, editorValue, saveActive]);

  const selectNote = useCallback(
    async (path: string) => {
      if (path === activePathRef.current) return;
      await saveActive();
      const document = documentsRef.current.get(path);
      if (!document) return;
      setActivePath(path);
      setEditorValue(document.content);
      setSaveState('saved');
      setQuery('');
    },
    [saveActive],
  );

  const openLocalFolder = async () => {
    if (!window.showDirectoryPicker) {
      setError('이 브라우저는 로컬 폴더 열기를 지원하지 않습니다. Browser Vault를 이용해 주세요.');
      return;
    }
    try {
      await saveActive();
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await loadRepository(new LocalFsVaultRepository(handle));
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const createNote = async () => {
    const requested = window.prompt('새 노트 이름을 입력하세요.');
    if (!requested) return;
    try {
      await saveActive();
      const path = ensureMarkdownPath(requested);
      if (documentsRef.current.has(path)) throw new Error('같은 경로의 노트가 이미 있습니다.');
      const created = await repository.create(path, `# ${requested.replace(/\.md$/i, '')}\n\n`);
      setEntries((previous) => [...previous, created].sort((a, b) => a.path.localeCompare(b.path)));
      setDocuments((previous) => new Map(previous).set(path, created));
      setActivePath(path);
      setEditorValue(created.content);
      setSaveState('saved');
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const navigateLink = (target: string) => {
    const resolved = resolveLink(target, entries.map((entry) => entry.path));
    if (resolved) void selectNote(resolved);
    else setError(`연결된 노트를 찾을 수 없습니다: ${target}`);
  };

  const logout = async () => {
    await saveActive();
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      onLoggedOut();
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Sparkles size={16} /></span>
          <strong>WebObsidian</strong>
          <span className="vault-pill"><HardDrive size={13} /> {repository.name}</span>
        </div>
        <div className="topbar-actions">
          <div className="save-status" data-state={saveState}>
            {saveState === 'saving' ? <LoaderCircle size={14} className="spin" /> : null}
            {saveState === 'saved' ? <Check size={14} /> : null}
            {saveState === 'error' ? <CircleAlert size={14} /> : null}
            {saveState === 'dirty' ? '편집 중' : saveState === 'saving' ? '저장 중' : saveState === 'error' ? '저장 실패' : '저장됨'}
          </div>
          <button className="logout-button" onClick={() => void logout()} title="로그아웃"><LogOut size={15} /> 로그아웃</button>
        </div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-actions">
          <button className="primary-action" onClick={() => void createNote()}><FilePlus2 size={16} /> 새 노트</button>
          <button className="icon-action" onClick={() => void openLocalFolder()} title="로컬 폴더 열기"><FolderOpen size={17} /></button>
        </div>
        <label className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="노트 검색" />
          <kbd>⌘K</kbd>
        </label>
        <div className="section-label">{query ? '검색 결과' : 'NOTES'} <span>{query ? searchResults.length : entries.length}</span></div>
        <nav className="note-list" aria-label="노트 목록">
          {(query ? searchResults : entries).map((entry) => (
            <button
              key={entry.path}
              className={entry.path === activePath ? 'note-item active' : 'note-item'}
              onClick={() => void selectNote(entry.path)}
            >
              <BookOpen size={15} />
              <span>{'title' in entry ? entry.title : entry.name.replace(/\.md$/i, '')}</span>
              <ChevronRight size={14} />
            </button>
          ))}
        </nav>
        <div className="storage-note">
          <span className="status-dot" />
          {repository.kind === 'server' ? '서버 폴더에 저장' : repository.kind === 'opfs' ? '브라우저에 로컬 저장' : '로컬 폴더에 직접 저장'}
        </div>
      </aside>

      <main className="workspace">
        {loading ? (
          <div className="center-state"><LoaderCircle className="spin" /><p>볼트를 여는 중입니다</p></div>
        ) : activePath ? (
          <Suspense fallback={<div className="center-state"><LoaderCircle className="spin" /></div>}>
            <MarkdownEditor key={activePath} value={editorValue} onChange={setEditorValue} />
          </Suspense>
        ) : (
          <div className="center-state"><BookOpen /><p>노트를 선택하세요.</p></div>
        )}
      </main>

      <aside className="inspector">
        <div className="inspector-heading">
          <div><span>현재 노트</span><strong>{activeNote?.title ?? '선택 없음'}</strong></div>
          <Link2 size={18} />
        </div>
        <section>
          <h2>OUTGOING LINKS <span>{activeNote?.links.length ?? 0}</span></h2>
          <div className="link-list">
            {activeNote?.links.map((link, index) => (
              <button key={`${link.target}-${index}`} onClick={() => navigateLink(link.target)}>
                <Link2 size={14} /> <span>{link.alias ?? link.target}</span> <small>L{link.line}</small>
              </button>
            ))}
            {activeNote?.links.length === 0 ? <p className="muted">아직 연결된 노트가 없습니다.</p> : null}
          </div>
        </section>
        <section>
          <h2>BACKLINKS <span>{backlinks.length}</span></h2>
          <div className="link-list">
            {backlinks.map((note) => (
              <button key={note.path} onClick={() => void selectNote(note.path)}><BookOpen size={14} /> <span>{note.title}</span></button>
            ))}
            {backlinks.length === 0 ? <p className="muted">이 노트를 가리키는 링크가 없습니다.</p> : null}
          </div>
        </section>
        <section>
          <h2>TAGS <span>{activeNote?.tags.length ?? 0}</span></h2>
          <div className="tag-list">
            {activeNote?.tags.map((tag) => <button key={tag} onClick={() => setQuery(tag)}><Hash size={12} />{tag.slice(1)}</button>)}
          </div>
        </section>
      </aside>

      {error ? (
        <div className="toast" role="alert"><CircleAlert size={17} /><span>{error}</span><button onClick={() => setError(undefined)}>닫기</button></div>
      ) : null}
    </div>
  );
}
