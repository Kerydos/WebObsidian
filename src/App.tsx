import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Hash,
  HardDrive,
  Link2,
  LoaderCircle,
  LogOut,
  Search,
  Settings2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { VaultDocument, VaultEntry, VaultFolderEntry, VaultRepository } from './types/vault';
import { ServerVaultRepository } from './lib/vault/server';
import { LocalFsVaultRepository } from './lib/vault/localFs';
import { ensureMarkdownPath, normalizeVaultPath } from './lib/vault/path';
import { buildVaultTree } from './lib/vault/tree';
import { backlinksFor, indexMarkdown, resolveLink, type NoteIndex } from './lib/markdown/indexer';
import { VaultSearchIndex } from './lib/search/searchIndex';
import { db } from './lib/cache/database';
import { LoginScreen } from './components/LoginScreen';
import { ConfirmDialog } from './components/ConfirmDialog';
import { AppearanceSettingsPanel } from './components/AppearanceSettings';
import { APPEARANCE_STORAGE_KEY, appearanceVariables, parseAppearance } from './lib/settings/appearance';

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

function uniqueBaseName(taken: Set<string>, base: string, suffix: string) {
  if (!taken.has(`${base}${suffix}`)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`;
    if (!taken.has(`${candidate}${suffix}`)) return candidate;
  }
}

function parentOf(path: string) {
  const separator = path.lastIndexOf('/');
  return separator === -1 ? '' : path.slice(0, separator);
}

type RenameTarget = { kind: 'note'; path: string } | { kind: 'folder'; path: string };

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
  const [folders, setFolders] = useState<VaultFolderEntry[]>([]);
  const [documents, setDocuments] = useState<Map<string, VaultDocument>>(() => new Map());
  const [activePath, setActivePath] = useState<string>();
  const [editorValue, setEditorValue] = useState('');
  const [query, setQuery] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const cancelRenameRef = useRef(false);
  const [appearance, setAppearance] = useState(() => {
    try {
      return parseAppearance(window.localStorage.getItem(APPEARANCE_STORAGE_KEY));
    } catch {
      return parseAppearance(null);
    }
  });
  const activePathRef = useRef(activePath);
  const editorValueRef = useRef(editorValue);
  const documentsRef = useRef(documents);
  const savePromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => void (activePathRef.current = activePath), [activePath]);
  useEffect(() => void (editorValueRef.current = editorValue), [editorValue]);
  useEffect(() => void (documentsRef.current = documents), [documents]);

  useEffect(() => {
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
    } catch {
      // The setting still applies for this session when browser storage is unavailable.
    }
  }, [appearance]);

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

  const loadRepository = useCallback(async (
    nextRepository: VaultRepository,
    options: { preferredActivePath?: string; silent?: boolean } = {},
  ) => {
    if (!options.silent) setLoading(true);
    setError(undefined);
    try {
      let nextEntries = await nextRepository.list();
      if (nextEntries.length === 0) {
        await nextRepository.create('Welcome.md', welcomeNote);
        nextEntries = await nextRepository.list();
      }
      const nextFolders = await nextRepository.listFolders();
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
      setFolders(nextFolders);
      setDocuments(nextDocuments);
      const activePathCandidate = options.preferredActivePath && nextDocuments.has(options.preferredActivePath)
        ? options.preferredActivePath
        : nextEntries[0]?.path;
      setActivePath(activePathCandidate);
      setEditorValue(activePathCandidate ? nextDocuments.get(activePathCandidate)?.content ?? '' : '');
      setSaveState('saved');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      if (!options.silent) setLoading(false);
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

  const startRenameNote = (path: string) => {
    setRenaming({ kind: 'note', path });
    setRenameValue(path.split('/').at(-1)?.replace(/\.md$/i, '') ?? path);
  };

  const startRenameFolder = (path: string) => {
    setRenaming({ kind: 'folder', path });
    setRenameValue(path.split('/').at(-1) ?? path);
  };

  const createNote = async () => {
    try {
      await saveActive();
      const base = uniqueBaseName(new Set(entries.map((entry) => entry.path)), '무제', '.md');
      const path = `${base}.md`;
      const created = await repository.create(path, `# ${base}\n\n`);
      setEntries((previous) => [...previous, created].sort((a, b) => a.path.localeCompare(b.path)));
      setDocuments((previous) => new Map(previous).set(path, created));
      setActivePath(path);
      setEditorValue(created.content);
      setSaveState('saved');
      startRenameNote(path);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const createFolder = async () => {
    try {
      const base = uniqueBaseName(new Set(folders.map((folder) => folder.path)), '새폴더', '');
      const created = await repository.createFolder(base);
      setFolders((previous) => [...previous, created].sort((a, b) => a.path.localeCompare(b.path)));
      startRenameFolder(created.path);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const moveNote = async (path: string, newPath: string) => {
    if (newPath === path) return;
    try {
      if (entries.some((entry) => entry.path === newPath)) throw new Error('같은 이름의 노트가 이미 있습니다.');
      if (activePathRef.current === path) await saveActive();
      const moved = await repository.rename(path, newPath);
      setEntries((previous) => previous.map((entry) => (entry.path === path ? moved : entry)).sort((a, b) => a.path.localeCompare(b.path)));
      setDocuments((previous) => {
        const next = new Map(previous);
        next.delete(path);
        next.set(newPath, moved);
        return next;
      });
      await db.transaction('rw', db.notes, async () => {
        await db.notes.delete([repository.name, path]);
        await db.notes.put({ vault: repository.name, path: newPath, modifiedAt: moved.modifiedAt, content: moved.content });
      });
      if (activePathRef.current === path) {
        setActivePath(newPath);
        setEditorValue(moved.content);
      }
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const renameFolderEntry = async (path: string, newPath: string) => {
    if (newPath === path) return;
    try {
      if (folders.some((folder) => folder.path === newPath)) throw new Error('같은 이름의 폴더가 이미 있습니다.');
      await saveActive();
      await repository.renameFolder(path, newPath);
      const current = activePathRef.current;
      const prefix = `${path}/`;
      const preferredActivePath = current?.startsWith(prefix) ? `${newPath}${current.slice(path.length)}` : current;
      await loadRepository(repository, { preferredActivePath, silent: true });
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const commitRename = async () => {
    const target = renaming;
    const value = renameValue;
    setRenaming(null);
    if (!target) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const parent = parentOf(target.path);
    if (target.kind === 'note') {
      const newPath = ensureMarkdownPath(parent ? `${parent}/${trimmed}` : trimmed);
      await moveNote(target.path, newPath);
    } else {
      const newPath = normalizeVaultPath(parent ? `${parent}/${trimmed}` : trimmed);
      await renameFolderEntry(target.path, newPath);
    }
  };

  const handleRenameBlur = () => {
    const cancelled = cancelRenameRef.current;
    cancelRenameRef.current = false;
    if (cancelled) {
      setRenaming(null);
      return;
    }
    void commitRename();
  };

  const handleRenameKeyDown = (event: { key: string; currentTarget: HTMLInputElement }) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      cancelRenameRef.current = true;
      event.currentTarget.blur();
    }
  };

  const moveIntoFolder = async (draggedPath: string, folderPath: string) => {
    const name = draggedPath.split('/').at(-1);
    if (!name) return;
    await moveNote(draggedPath, `${folderPath}/${name}`);
  };

  const moveToRoot = async (draggedPath: string) => {
    const name = draggedPath.split('/').at(-1);
    if (!name || parentOf(draggedPath) === '') return;
    await moveNote(draggedPath, name);
  };

  const requestDeleteNote = (path: string) => setDeleteTarget(path);

  const confirmDeleteNote = async () => {
    const path = deleteTarget;
    setDeleteTarget(null);
    if (!path) return;
    try {
      await repository.remove(path);
      setEntries((previous) => previous.filter((entry) => entry.path !== path));
      setDocuments((previous) => {
        const next = new Map(previous);
        next.delete(path);
        return next;
      });
      await db.notes.delete([repository.name, path]);
      if (activePathRef.current === path) {
        const remaining = entries.filter((entry) => entry.path !== path);
        const nextPath = remaining[0]?.path;
        setActivePath(nextPath);
        setEditorValue(nextPath ? documentsRef.current.get(nextPath)?.content ?? '' : '');
        setSaveState('saved');
      }
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

  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  return (
    <div className="app-shell" data-theme={appearance.theme} data-document-style={appearance.documentStyle} style={appearanceVariables(appearance)}>
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
          <button className="topbar-button" onClick={() => setSettingsOpen(true)} title="화면 설정" aria-label="화면 설정 열기"><Settings2 size={16} /></button>
          <button className="logout-button" onClick={() => void logout()} title="로그아웃"><LogOut size={15} /> 로그아웃</button>
        </div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-actions">
          <button className="primary-action" onClick={() => void createNote()}><FilePlus2 size={16} /> 새 노트</button>
          <button className="icon-action" onClick={() => void createFolder()} title="새 폴더"><FolderPlus size={17} /></button>
          <button className="icon-action" onClick={() => void openLocalFolder()} title="로컬 폴더 열기"><FolderOpen size={17} /></button>
        </div>
        <label className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="노트 검색" />
          <kbd>⌘K</kbd>
        </label>
        <div
          className={dragOverTarget === '' ? 'section-label drop-target' : 'section-label'}
          onDragOver={query ? undefined : (event) => { event.preventDefault(); setDragOverTarget(''); }}
          onDragLeave={query ? undefined : () => setDragOverTarget((current) => (current === '' ? null : current))}
          onDrop={query ? undefined : (event) => {
            event.preventDefault();
            setDragOverTarget(null);
            const draggedPath = event.dataTransfer.getData('text/webobsidian-path');
            if (draggedPath) void moveToRoot(draggedPath);
          }}
        >
          {query ? '검색 결과' : 'NOTES'} <span>{query ? searchResults.length : entries.length}</span>
        </div>
        <nav className="note-list" aria-label="노트 목록">
          {query
            ? searchResults.map((entry) => (
                <div key={entry.path} className="note-row">
                  <button
                    className={entry.path === activePath ? 'note-item active' : 'note-item'}
                    onClick={() => void selectNote(entry.path)}
                  >
                    <BookOpen size={15} />
                    <span>{entry.title}</span>
                    <ChevronRight size={14} />
                  </button>
                  <button
                    className="note-delete"
                    title="노트 삭제"
                    aria-label={`${entry.title} 삭제`}
                    onClick={(event) => {
                      event.stopPropagation();
                      requestDeleteNote(entry.path);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            : buildVaultTree(entries, folders).map((row) => {
                if (row.kind === 'folder') {
                  const isRenaming = renaming?.kind === 'folder' && renaming.path === row.path;
                  return (
                    <div
                      key={`folder:${row.path}`}
                      className={dragOverTarget === row.path ? 'folder-item drop-target' : 'folder-item'}
                      style={{ paddingLeft: 9 + row.depth * 14 }}
                      onDragOver={(event) => { event.preventDefault(); setDragOverTarget(row.path); }}
                      onDragLeave={() => setDragOverTarget((current) => (current === row.path ? null : current))}
                      onDrop={(event) => {
                        event.preventDefault();
                        setDragOverTarget(null);
                        const draggedPath = event.dataTransfer.getData('text/webobsidian-path');
                        if (draggedPath) void moveIntoFolder(draggedPath, row.path);
                      }}
                    >
                      <Folder size={14} />
                      {isRenaming ? (
                        <input
                          className="rename-input"
                          autoFocus
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onKeyDown={handleRenameKeyDown}
                          onBlur={handleRenameBlur}
                        />
                      ) : (
                        <span onDoubleClick={() => startRenameFolder(row.path)}>{row.name}</span>
                      )}
                    </div>
                  );
                }

                const isRenaming = renaming?.kind === 'note' && renaming.path === row.entry.path;
                return (
                  <div
                    key={row.entry.path}
                    className="note-row"
                    draggable={!isRenaming}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/webobsidian-path', row.entry.path);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                  >
                    {isRenaming ? (
                      <div className="note-item renaming" style={{ paddingLeft: 9 + row.depth * 14 }}>
                        <BookOpen size={15} />
                        <input
                          className="rename-input"
                          autoFocus
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onKeyDown={handleRenameKeyDown}
                          onBlur={handleRenameBlur}
                        />
                      </div>
                    ) : (
                      <>
                        <button
                          className={row.entry.path === activePath ? 'note-item active' : 'note-item'}
                          style={{ paddingLeft: 9 + row.depth * 14 }}
                          onClick={() => void selectNote(row.entry.path)}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            startRenameNote(row.entry.path);
                          }}
                        >
                          <BookOpen size={15} />
                          <span>{row.entry.name.replace(/\.md$/i, '')}</span>
                          <ChevronRight size={14} />
                        </button>
                        <button
                          className="note-delete"
                          title="노트 삭제"
                          aria-label={`${row.entry.name} 삭제`}
                          onClick={(event) => {
                            event.stopPropagation();
                            requestDeleteNote(row.entry.path);
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
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
            <MarkdownEditor key={activePath} value={editorValue} onChange={setEditorValue} onNavigateWikiLink={navigateLink} />
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
      {settingsOpen ? <AppearanceSettingsPanel settings={appearance} onChange={setAppearance} onClose={closeSettings} /> : null}
      {deleteTarget ? (
        <ConfirmDialog
          title="노트 삭제"
          message={`'${deleteTarget}' 노트를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
          confirmLabel="삭제"
          danger
          onConfirm={() => void confirmDeleteNote()}
          onCancel={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  );
}
