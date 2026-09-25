import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VaultDocument, VaultEntry, VaultFolderEntry, VaultRepository } from '../types/vault';
import { ServerVaultRepository } from '../lib/vault/server';
import { LocalFsVaultRepository } from '../lib/vault/localFs';
import { ensureMarkdownPath, fileName, linkTargetPath, normalizeVaultPath } from '../lib/vault/path';
import { dailyNoteBaseName, uniqueBaseName } from '../lib/vault/names';
import { backlinksFor, indexMarkdown, resolveLink } from '../lib/markdown/indexer';
import { VaultSearchIndex } from '../lib/search/searchIndex';
import { db } from '../lib/cache/database';
import { messageOf } from '../lib/message';

export type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

export type RenameTarget = { kind: 'note'; path: string } | { kind: 'folder'; path: string };

function parentOf(path: string) {
  const separator = path.lastIndexOf('/');
  return separator === -1 ? '' : path.slice(0, separator);
}

// 볼트 저장소 선택, 노트 목록/문서 상태, 생성·이름 변경·이동·삭제, 자동 저장, 검색 인덱스까지
// 볼트 데이터 흐름 전부를 담당한다. 서버 변경 이벤트 구독은 useVaultSync가 맡는다.
export function useVault() {
  const [repository, setRepository] = useState<VaultRepository>(() => new ServerVaultRepository());
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [folders, setFolders] = useState<VaultFolderEntry[]>([]);
  const [documents, setDocuments] = useState<Map<string, VaultDocument>>(() => new Map());
  const [activePath, setActivePath] = useState<string>();
  const [editingPath, setEditingPath] = useState<string>();
  const editing = activePath !== undefined && editingPath === activePath;
  const [editorValue, setEditorValue] = useState('');
  const [query, setQuery] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<string | null>(null);
  const cancelRenameRef = useRef(false);
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

  const loadRepository = useCallback(async (
    nextRepository: VaultRepository,
    options: { preferredActivePath?: string; silent?: boolean } = {},
  ) => {
    if (!options.silent) setLoading(true);
    setError(undefined);
    try {
      const nextEntries = await nextRepository.list();
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

  // 볼트 목록 로드는 화면이 뜨자마자 시작해야 하며, 로딩 표시를 위해 동기적으로 상태를 켠다.
  useEffect(() => {
    void navigator.storage.persist?.();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRepository(repository);
    // The initial repository is intentionally loaded once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRepository]);

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

  // 본문이 저장되지 않은 상태가 되면 즉시 '편집 중'으로 표시하고 650ms 후 자동 저장한다.
  useEffect(() => {
    const current = activePath ? documents.get(activePath) : undefined;
    if (!current || current.content === editorValue) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaveState('dirty');
    const timer = window.setTimeout(() => void saveActive(), 650);
    return () => window.clearTimeout(timer);
  }, [activePath, documents, editorValue, saveActive]);

  const selectNote = useCallback(
    async (path: string) => {
      if (path === activePathRef.current) {
        setSelectedFolder(null);
        return;
      }
      await saveActive();
      const document = documentsRef.current.get(path);
      if (!document) return;
      setActivePath(path);
      setEditorValue(document.content);
      setSaveState('saved');
      setQuery('');
      setSelectedFolder(null);
    },
    [saveActive],
  );

  // 외부 변경 반영: 보류 중인 저장을 마친 뒤 조용히 전체를 다시 불러온다.
  const reloadSilently = useCallback(
    () => loadRepository(repository, { preferredActivePath: activePathRef.current, silent: true }),
    [loadRepository, repository],
  );

  const hasDocument = useCallback((path: string) => documentsRef.current.has(path), []);

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
    if (!existing) return;
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
    setEditingPath((current) => current === path ? newPath : current);
  }, [repository]);

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
      setEditingPath(path);
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
      setEditingPath((current) => current === path ? newPath : current);
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

  // [[링크]]가 가리키는 노트가 없으면 현재 노트와 같은 폴더에 같은 이름의 노트를 새로 만들고
  // 바로 연다(Obsidian의 미해결 링크 동작). 서버 create는 createOnly라 기존 노트를 덮지 않는다.
  const createLinkedNote = async (target: string) => {
    try {
      const path = linkTargetPath(target, activePathRef.current);
      if (entries.some((entry) => entry.path === path)) {
        await selectNote(path);
        return;
      }
      await saveActive();
      const name = fileName(path).replace(/\.md$/i, '');
      const created = await repository.create(path, `# ${name}\n\n`);
      setEntries((previous) => [...previous, created].sort((a, b) => a.path.localeCompare(b.path)));
      setDocuments((previous) => new Map(previous).set(path, created));
      setActivePath(path);
      setEditingPath(path);
      setEditorValue(created.content);
      setSaveState('saved');
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const navigateLink = (target: string) => {
    const resolved = resolveLink(target, entries.map((entry) => entry.path));
    if (resolved) void selectNote(resolved);
    else void createLinkedNote(target);
  };

  return {
    repository,
    entries,
    folders,
    documents,
    activePath,
    editing,
    setEditingPath,
    editorValue,
    setEditorValue,
    query,
    setQuery,
    searchResults,
    saveState,
    error,
    setError,
    loading,
    notes,
    activeNote,
    backlinks,
    activePathRef,
    editorValueRef,
    documentsRef,
    loadRepository,
    saveActive,
    selectNote,
    reloadSilently,
    hasDocument,
    handleNoteUpsert,
    handleNoteDelete,
    handleNoteMove,
    openLocalFolder,
    renaming,
    renameValue,
    setRenameValue,
    startRenameNote,
    startRenameFolder,
    handleRenameBlur,
    handleRenameKeyDown,
    createNote,
    createFolder,
    moveIntoFolder,
    moveToRoot,
    dragOverTarget,
    setDragOverTarget,
    selectedFolder,
    setSelectedFolder,
    deleteTarget,
    setDeleteTarget,
    deleteFolderTarget,
    setDeleteFolderTarget,
    requestDeleteNote,
    confirmDeleteNote,
    confirmDeleteFolder,
    navigateLink,
  };
}

export type VaultController = ReturnType<typeof useVault>;
