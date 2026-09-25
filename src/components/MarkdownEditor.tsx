import { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorView, keymap } from '@codemirror/view';
import { livePreview } from './editor/livePreview';
import { CjkEmphasis, Highlight, listIndentKeymap, timeSnippet } from './editor/markdownExtensions';
import { sentenceCommitListener } from './editor/sentenceCommit';

interface MarkdownEditorProps {
  value: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  onNavigateWikiLink?: (target: string) => void;
  onSentenceCommitted?: (sentence: string) => void;
  onScrollLine?: (line: number) => void;
  onReady?: (scrollToLine: ((line: number) => void) | null) => void;
}

export default function MarkdownEditor({ value, readOnly = false, onChange, onNavigateWikiLink, onSentenceCommitted, onScrollLine, onReady }: MarkdownEditorProps) {
  const navigateRef = useRef(onNavigateWikiLink);
  const sentenceCommittedRef = useRef(onSentenceCommitted);
  // 콜백은 커밋 이후 에디터 이벤트에서만 호출되므로, 커밋 시점에 최신 값을 담는다.
  useEffect(() => {
    navigateRef.current = onNavigateWikiLink;
    sentenceCommittedRef.current = onSentenceCommitted;
    scrollLineRef.current = onScrollLine;
    readyRef.current = onReady;
  });
  const scrollLineRef = useRef(onScrollLine);
  const readyRef = useRef(onReady);
  const [view, setView] = useState<EditorView | null>(null);
  useEffect(() => {
    if (!view) return;
    const updateLine = () => scrollLineRef.current?.(view.state.doc.lineAt(view.lineBlockAtHeight(view.scrollDOM.scrollTop + 80).from).number);
    view.scrollDOM.addEventListener('scroll', updateLine, { passive: true });
    readyRef.current?.((line) => view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(line).from, { y: 'start', yMargin: 40 }) }));
    updateLine();
    return () => {
      view.scrollDOM.removeEventListener('scroll', updateLine);
      readyRef.current?.(null);
    };
  }, [view]);
  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, extensions: [Highlight, CjkEmphasis] }),
      // 확장은 에디터당 한 번만 생성되므로 최신 콜백은 ref로 전달한다(이벤트 시점에 호출됨).
      // eslint-disable-next-line react-hooks/refs
      livePreview((target) => navigateRef.current?.(target)),
      // eslint-disable-next-line react-hooks/refs
      sentenceCommitListener((sentence) => sentenceCommittedRef.current?.(sentence)),
      keymap.of(listIndentKeymap),
      timeSnippet,
      EditorView.lineWrapping,
      EditorView.theme({
        '&': { height: '100%', backgroundColor: 'transparent' },
        '.cm-scroller': {
          fontFamily: 'var(--font-markdown)',
          fontSize: 'var(--markdown-font-size)',
          lineHeight: 'var(--markdown-line-height)',
          color: 'var(--markdown-text)',
          padding: '34px clamp(24px, 6vw, 88px) 120px',
        },
        '.cm-content': { maxWidth: 'var(--editor-width)', margin: '0 auto', caretColor: 'var(--accent)' },
        '.cm-gutters': { display: 'none' },
        '.cm-activeLine': { backgroundColor: 'rgba(191, 95, 59, 0.035)' },
        '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
          backgroundColor: 'rgba(191, 95, 59, 0.16) !important',
        },
        '&.cm-focused': { outline: 'none' },
      }),
    ],
    [],
  );

  return (
    <CodeMirror
      value={value}
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={setView}
      readOnly={readOnly}
      editable={!readOnly}
      autoFocus={!readOnly}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLineGutter: false,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: true,
      }}
      height="100%"
      aria-label={readOnly ? '마크다운 읽기 모드' : '마크다운 라이브 프리뷰 편집기'}
    />
  );
}
