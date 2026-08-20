import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Bot,
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
import { ServerVaultRepository, subscribeVaultChanges } from './lib/vault/server';
import { LocalFsVaultRepository } from './lib/vault/localFs';
import { ensureMarkdownPath, normalizeVaultPath } from './lib/vault/path';
import { buildVaultTree } from './lib/vault/tree';
import { backlinksFor, indexMarkdown, resolveLink, type NoteIndex } from './lib/markdown/indexer';
import { VaultSearchIndex } from './lib/search/searchIndex';
import { db } from './lib/cache/database';
import { LoginScreen } from './components/LoginScreen';
import { ConfirmDialog } from './components/ConfirmDialog';
import { SettingsPanel, type SettingsTab } from './components/SettingsPanel';
import { AssistantPanel } from './components/AssistantPanel';
import { GrammarCheckPanel, type GrammarCheckResult } from './components/GrammarCheckPanel';
import { APPEARANCE_STORAGE_KEY, appearanceVariables, parseAppearance } from './lib/settings/appearance';
import { clearLegacyOllamaSettings, readLegacyOllamaSettings } from './lib/settings/ollama';
import { checkGrammar, emptyOllamaServerSettings, fetchOllamaSettings, saveOllamaSettings, type OllamaServerSettings } from './lib/ai/ollamaCloud';

const GRAMMAR_CHECK_STORAGE_KEY = 'webobsidian:grammarcheck:v1';
const maxGrammarResults = 20;

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

function dailyNoteBaseName(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}${day}_기록`;
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
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<string | null>(null);
  const cancelRenameRef = useRef(false);
  const [appearance, setAppearance] = useState(() => {
    try {
      return parseAppearance(window.localStorage.getItem(APPEARANCE_STORAGE_KEY));
    } catch {
      return parseAppearance(null);
    }
  });
  const [ollama, setOllama] = useState<OllamaServerSettings>(emptyOllamaServerSettings);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance');
  const [grammarEnabled, setGrammarEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(GRAMMAR_CHECK_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [grammarResults, setGrammarResults] = useState<GrammarCheckResult[]>([]);
  const [grammarChecking, setGrammarChecking] = useState(false);
  const [grammarError, setGrammarError] = useState<string>();
  const grammarAbortRef = useRef<AbortController | null>(null);
  const lastGrammarTextRef = useRef('');
  const grammarResultIdRef = useRef(0);
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

  useEffect(() => {
    try {
      window.localStorage.setItem(GRAMMAR_CHECK_STORAGE_KEY, grammarEnabled ? '1' : '0');
    } catch {
      // The setting still applies for this session when browser storage is unavailable.
    }
  }, [grammarEnabled]);

  // 노트를 전환하면 이전 노트에 대한 검사 결과와 중복 방지 기록을 비운다.
  useEffect(() => {
    grammarAbortRef.current?.abort();
    lastGrammarTextRef.current = '';
    setGrammarResults([]);
    setGrammarChecking(false);
    setGrammarError(undefined);
  }, [activePath]);

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

  const reloadTimerRef = useRef<number | null>(null);
  const reloadRunningRef = useRef(false);
  const reloadPendingRef = useRef(false);

  // 다른 브라우저/외부 변경으로 구조(폴더)가 바뀐 경우: 보류 중인 저장을 마친 뒤 조용히 전체를 다시 불러온다.
  const scheduleReload = useCallback((delay = 300) => {
    if (reloadTimerRef.current !== null) return;
    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      if (reloadRunningRef.current) {
        reloadPendingRef.current = true;
        return;
      }
      reloadRunningRef.current = true;
      void (async () => {
        try {
          await saveActive();
          await loadRepository(repository, { preferredActivePath: activePathRef.current, silent: true });
        } finally {
          reloadRunningRef.current = false;
          if (reloadPendingRef.current) {
            reloadPendingRef.current = false;
            scheduleReload(0);
          }
        }
      })();
    }, delay);
  }, [loadRepository, repository, saveActive]);

  const handleNoteUpsert = useCallback(async (path: string, revision?: string) => {
    const known = documentsRef.current.get(path);
    if (known && revision && known.revision === revision) return;
    // 편집 중인 노트는 로컬 리비전을 유지해 저장 시 서버 충돌(409)이 감지되도록 한다.
    if (known && activePathRef.current === path && editorValueRef.current !== known.content) return;
    let fresh: VaultDocument;
    try {
      fresh = await repository.read(path);
    } catch {
      return;
    }
    if (documentsRef.current.get(path)?.revision === fresh.revision) return;
    const previous = documentsRef.current.get(path);
    if (previous && activePathRef.current === path && editorValueRef.current !== previous.content) return;
    setDocuments((current) => new Map(current).set(path, fresh));
    setEntries((current) => [...current.filter((entry) => entry.path !== path), fresh].sort((a, b) => a.path.localeCompare(b.path)));
    void db.notes.put({ vault: repository.name, path, modifiedAt: fresh.modifiedAt, content: fresh.content });
    if (activePathRef.current === path && (!previous || previous.content === editorValueRef.current)) {
      setEditorValue(fresh.content);
      setSaveState('saved');
    }
  }, [repository]);

  const handleNoteDelete = useCallback((path: string) => {
    if (!documentsRef.current.has(path)) return;
    setEntries((current) => current.filter((entry) => entry.path !== path));
    setDocuments((current) => {
      const next = new Map(current);
      next.delete(path);
      return next;
    });
    void db.notes.delete([repository.name, path]);
    if (activePathRef.current === path) {
      const nextPath = [...documentsRef.current.keys()].filter((candidate) => candidate !== path).sort((a, b) => a.localeCompare(b))[0];
      setActivePath(nextPath);
      setEditorValue(nextPath ? documentsRef.current.get(nextPath)?.content ?? '' : '');
      setSaveState('saved');
    }
  }, [repository]);

  const handleNoteMove = useCallback((path: string, newPath: string) => {
    const existing = documentsRef.current.get(path);
    if (!existing) {
      scheduleReload();
      return;
    }
    const moved: VaultDocument = { ...existing, path: newPath, name: newPath.split('/').at(-1) ?? newPath };
    setEntries((current) => current.map((entry) => (entry.path === path ? moved : entry)).sort((a, b) => a.path.localeCompare(b.path)));
    setDocuments((current) => {
      const next = new Map(current);
      next.delete(path);
      next.set(newPath, moved);
      return next;
    });
    void (async () => {
      await db.notes.delete([repository.name, path]);
      await db.notes.put({ vault: repository.name, path: newPath, modifiedAt: moved.modifiedAt, content: moved.content });
    })();
    if (activePathRef.current === path) setActivePath(newPath);
  }, [repository, scheduleReload]);

  // 서버 볼트 변경 이벤트(SSE)를 구독해 다른 브라우저·외부 변경을 화면에 반영한다.
  useEffect(() => {
    if (repository.kind !== 'server') return;
    return subscribeVaultChanges((event) => {
      if (event.type === 'note' && event.action === 'upsert' && event.path) {
        void handleNoteUpsert(event.path, event.revision);
        return;
      }
      if (event.type === 'note' && event.action === 'delete' && event.path) {
        handleNoteDelete(event.path);
        return;
      }
      if (event.type === 'note' && event.action === 'move' && event.path && event.newPath) {
        handleNoteMove(event.path, event.newPath);
        return;
      }
      scheduleReload();
    });
  }, [repository, handleNoteUpsert, handleNoteDelete, handleNoteMove, scheduleReload]);

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
      const folder = folders.some((item) => item.path === selectedFolder) ? selectedFolder : null;
      const prefix = folder ? `${folder}/` : '';
      const taken = new Set(
        entries.filter((entry) => entry.path.startsWith(prefix)).map((entry) => entry.path.slice(prefix.length)),
      );
      const base = uniqueBaseName(taken, dailyNoteBaseName(), '.md');
      const path = `${prefix}${base}.md`;
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
      setSelectedFolder((current) => {
        if (!current) return current;
        if (current === path) return newPath;
        if (current.startsWith(`${path}/`)) return `${newPath}${current.slice(path.length)}`;
        return current;
      });
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

  const confirmDeleteFolder = async () => {
    const folderPath = deleteFolderTarget;
    setDeleteFolderTarget(null);
    if (!folderPath) return;
    const prefix = `${folderPath}/`;
    try {
      await repository.removeFolder(folderPath);
      const removedPaths = new Set(entries.filter((entry) => entry.path.startsWith(prefix)).map((entry) => entry.path));
      setEntries((previous) => previous.filter((entry) => !removedPaths.has(entry.path)));
      setFolders((previous) => previous.filter((folder) => folder.path !== folderPath && !folder.path.startsWith(prefix)));
      setDocuments((previous) => {
        const next = new Map(previous);
        for (const path of removedPaths) next.delete(path);
        return next;
      });
      await Promise.all([...removedPaths].map((path) => db.notes.delete([repository.name, path])));
      setSelectedFolder((current) => (current && (current === folderPath || current.startsWith(prefix)) ? null : current));
      if (activePathRef.current && removedPaths.has(activePathRef.current)) {
        const remaining = entries.filter((entry) => !removedPaths.has(entry.path));
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
  const openSettings = useCallback((tab: SettingsTab = 'appearance') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  // AI 도우미 답변을 현재 노트 끝에 추가한다. 편집 내용은 기존 자동 저장 흐름을 따른다.
  const insertAssistantText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const current = editorValueRef.current;
    setEditorValue(current.trim() ? `${current}\n\n${trimmed}\n` : `${trimmed}\n`);
  }, []);

  const grammarConfigured = ollama.hasApiKey && ollama.model !== '';

  // Enter로 문단을 마칠 때마다 직전 문단을 서버의 Ollama Cloud 모델로 검사한다.
  // 진행 중이던 검사는 새 문단이 들어오면 취소하고 최신 요청만 반영한다.
  const handleParagraphCommitted = useCallback((paragraph: string) => {
    if (!grammarEnabled || !grammarConfigured) return;
    if (paragraph === lastGrammarTextRef.current) return;
    lastGrammarTextRef.current = paragraph;
    grammarAbortRef.current?.abort();
    const controller = new AbortController();
    grammarAbortRef.current = controller;
    setGrammarError(undefined);
    setGrammarChecking(true);
    void checkGrammar({ model: ollama.model, text: paragraph, signal: controller.signal })
      .then((issues) => {
        if (controller.signal.aborted) return;
        grammarResultIdRef.current += 1;
        setGrammarResults((current) => [
          { id: grammarResultIdRef.current, paragraph, issues },
          ...current,
        ].slice(0, maxGrammarResults));
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setGrammarError(messageOf(cause));
      })
      .finally(() => {
        if (grammarAbortRef.current === controller) {
          grammarAbortRef.current = null;
          setGrammarChecking(false);
        }
      });
  }, [grammarEnabled, grammarConfigured, ollama.model]);

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
          <button
            className={assistantOpen ? 'topbar-button active' : 'topbar-button'}
            onClick={() => setAssistantOpen((open) => !open)}
            title="AI 도우미"
            aria-label="AI 도우미 열기"
            aria-pressed={assistantOpen}
          >
            <Bot size={16} />
          </button>
          <button className="topbar-button" onClick={() => openSettings()} title="설정" aria-label="설정 열기"><Settings2 size={16} /></button>
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
                    <div key={`folder:${row.path}`} className="folder-row">
                      <div
                        className={[
                          'folder-item',
                          selectedFolder === row.path ? 'selected' : '',
                          dragOverTarget === row.path ? 'drop-target' : '',
                        ].filter(Boolean).join(' ')}
                        style={{ paddingLeft: 9 + row.depth * 14 }}
                        onClick={
                          isRenaming
                            ? undefined
                            : () => setSelectedFolder((current) => (current === row.path ? null : row.path))
                        }
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
                      {!isRenaming ? (
                        <button
                          className="folder-delete"
                          title="폴더 삭제"
                          aria-label={`${row.name} 폴더 삭제`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setDeleteFolderTarget(row.path);
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : null}
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
            <MarkdownEditor
              key={activePath}
              value={editorValue}
              onChange={setEditorValue}
              onNavigateWikiLink={navigateLink}
              onParagraphCommitted={handleParagraphCommitted}
            />
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
        <GrammarCheckPanel
          enabled={grammarEnabled}
          onToggle={setGrammarEnabled}
          configured={grammarConfigured}
          checking={grammarChecking}
          error={grammarError}
          results={grammarResults}
        />
      </aside>

      {error ? (
        <div className="toast" role="alert"><CircleAlert size={17} /><span>{error}</span><button onClick={() => setError(undefined)}>닫기</button></div>
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
        noteTitle={activeNote?.title}
        noteContent={editorValue}
        onOpenSettings={() => openSettings('ollama')}
        onInsertToNote={insertAssistantText}
        onClose={() => setAssistantOpen(false)}
      />
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
      {deleteFolderTarget ? (
        <ConfirmDialog
          title="폴더 삭제"
          message={`'${deleteFolderTarget}' 폴더와 그 안의 모든 노트를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
          confirmLabel="삭제"
          danger
          onConfirm={() => void confirmDeleteFolder()}
          onCancel={() => setDeleteFolderTarget(null)}
        />
      ) : null}
    </div>
  );
}
