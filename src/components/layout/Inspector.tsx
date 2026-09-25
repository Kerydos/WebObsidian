import { BookOpen, Hash, Link2 } from 'lucide-react';
import type { VaultController } from '../../hooks/useVault';
import type { NoteIndex } from '../../lib/markdown/indexer';

interface InspectorProps {
  vault: VaultController;
  headings: NoteIndex['headings'];
  activeHeading: number;
  onJumpToHeading: (line: number) => void;
}

export function Inspector({ vault, headings, activeHeading, onJumpToHeading }: InspectorProps) {
  const { activeNote, backlinks, navigateLink, selectNote, setQuery } = vault;

  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <div><span>현재 노트</span><strong>{activeNote?.title ?? '선택 없음'}</strong></div>
        <Link2 size={18} />
      </div>
      <section>
        <h2>목차 <span>{headings.length}</span></h2>
        <nav className="toc-list" aria-label="문서 목차">
          {headings.map((heading, index) => <button
            key={heading.line}
            type="button"
            className={index === activeHeading ? 'active' : ''}
            aria-current={index === activeHeading ? 'location' : undefined}
            style={{ paddingLeft: 9 + (heading.level - 1) * 12 }}
            onClick={() => onJumpToHeading(heading.line)}
          >{heading.text}</button>)}
          {headings.length === 0 ? <p className="muted">이 문서에는 헤더가 없습니다.</p> : null}
        </nav>
      </section>
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
  );
}
