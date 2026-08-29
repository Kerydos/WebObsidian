import { ChevronRight, FilePlus2, Folder, FolderOpen, FolderPlus, Search, Trash2 } from 'lucide-react';
import { buildVaultTree } from '../../lib/vault/tree';
import type { VaultController } from '../../hooks/useVault';

interface SidebarProps {
  vault: VaultController;
}

export function Sidebar({ vault }: SidebarProps) {
  const {
    repository,
    entries,
    folders,
    activePath,
    query,
    setQuery,
    searchResults,
    selectNote,
    createNote,
    createFolder,
    openLocalFolder,
    dragOverTarget,
    setDragOverTarget,
    moveToRoot,
    moveIntoFolder,
    renaming,
    renameValue,
    setRenameValue,
    handleRenameBlur,
    handleRenameKeyDown,
    startRenameNote,
    startRenameFolder,
    requestDeleteNote,
    setDeleteFolderTarget,
    selectedFolder,
    setSelectedFolder,
  } = vault;

  return (
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
  );
}
