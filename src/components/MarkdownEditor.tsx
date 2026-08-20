import { useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorView, keymap } from '@codemirror/view';
import { livePreview } from './editor/livePreview';
import { Highlight, listIndentKeymap } from './editor/markdownExtensions';
import { paragraphCommitListener } from './editor/paragraphCommit';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onNavigateWikiLink?: (target: string) => void;
  onParagraphCommitted?: (paragraph: string) => void;
}

export default function MarkdownEditor({ value, onChange, onNavigateWikiLink, onParagraphCommitted }: MarkdownEditorProps) {
  const navigateRef = useRef(onNavigateWikiLink);
  navigateRef.current = onNavigateWikiLink;
  const paragraphCommittedRef = useRef(onParagraphCommitted);
  paragraphCommittedRef.current = onParagraphCommitted;
  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, extensions: Highlight }),
      livePreview((target) => navigateRef.current?.(target)),
      paragraphCommitListener((paragraph) => paragraphCommittedRef.current?.(paragraph)),
      keymap.of(listIndentKeymap),
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
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLineGutter: false,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: true,
      }}
      height="100%"
      aria-label="마크다운 라이브 프리뷰 편집기"
    />
  );
}
