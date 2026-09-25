import { useEffect, useId, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';

type Note = { path: string; content: string };
type Target = { kind: 'note'; path: string; content: string } | { kind: 'folder'; path: string; notes: Note[] };

interface Props {
  target: Target;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function folderPublishItems(sourceFolder: string, destinationFolder: string, notes: Note[]) {
  return notes.map((note) => {
    const relative = note.path.slice(sourceFolder.length + 1);
    const slash = relative.lastIndexOf('/');
    const nested = slash < 0 ? '' : relative.slice(0, slash);
    return {
      folder: [destinationFolder.trim(), nested].filter(Boolean).join('/'),
      title: relative.slice(slash + 1).replace(/\.md$/i, ''),
      content: note.content,
    };
  });
}

export function BlogPublishDialog({ target, onClose, onOpenSettings }: Props) {
  const titleId = useId();
  const folderListId = useId();
  const isFolder = target.kind === 'folder';
  const [title, setTitle] = useState(target.path.split('/').pop()?.replace(/\.md$/i, '') ?? '');
  const [folder, setFolder] = useState(isFolder ? target.path : target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/')) : '');
  const [busy, setBusy] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [completed, setCompleted] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => { void fetch('/api/blog/folders').then((response) => response.json()).then((body: { folders: string[] }) => setFolders(body.folders)).catch(() => {}); }, []);

  const publish = async () => {
    setBusy(true);
    setError('');
    setCompleted(0);
    const items = target.kind === 'folder'
      ? folderPublishItems(target.path, folder, target.notes)
      : [{ folder, title, content: target.content }];
    try {
      for (const [index, item] of items.entries()) {
        const response = await fetch('/api/blog/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        });
        const result = await response.json() as { url?: string; error?: string };
        if (!response.ok) throw new Error(`${item.title}: ${result.error ?? '발행하지 못했습니다.'}`);
        if (!isFolder) setUrl(result.url ?? '');
        setCompleted(index + 1);
      }
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '발행하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const count = isFolder ? target.notes.length : 1;
  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="settings-panel blog-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="settings-heading"><div><span>BLOG</span><h2 id={titleId}>{isFolder ? '폴더 발행' : '글 발행'}</h2></div><button type="button" className="settings-close" onClick={onClose} aria-label="발행 창 닫기"><X size={19} /></button></header>
      <div className="settings-content">
        <p className="settings-help">선택: {target.path}{isFolder ? ` · 하위 글 ${count}개` : ''}</p>
        <label className="model-row"><span>발행 폴더</span><input className="settings-input" list={folderListId} value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="루트에 발행" disabled={busy || done} /></label>
        <datalist id={folderListId}><option value="" label="루트" />{folders.map((item) => <option key={item} value={item} />)}</datalist>
        {isFolder ? <p className="settings-help">하위 폴더 구조와 각 파일 이름을 유지해 발행합니다.</p> : <>
          <label className="model-row"><span>글 제목</span><input className="settings-input" value={title} onChange={(event) => setTitle(event.target.value)} required disabled={busy || done} /></label>
          <p className="settings-help">대상 경로: {folder ? `${folder}/` : ''}{title || '제목'}.md</p>
        </>}
        {busy || completed > 0 ? <p className="model-status" role="status">{completed}/{count}개 발행{done ? ' 완료' : '됨'}</p> : null}
        {error ? <p className="model-status" data-variant="error" role="alert">{error}</p> : null}
        {url ? <p className="model-status" data-variant="ok">발행 완료: <a href={url} target="_blank" rel="noreferrer">{url}</a></p> : null}
      </div>
      <footer className="settings-footer"><button type="button" onClick={onOpenSettings}>API 키 설정</button><button type="button" className="settings-done" disabled={busy || done || count === 0 || !isFolder && !title.trim()} onClick={() => void publish()}>{busy ? <LoaderCircle size={14} className="spin" /> : null} {isFolder ? `${count}개 발행` : '발행'}</button></footer>
    </section>
  </div>;
}
