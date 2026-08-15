import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function MarkdownEditor({ value, onChange }: MarkdownEditorProps) {
  const extensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': { height: '100%', backgroundColor: 'transparent' },
        '.cm-scroller': {
          fontFamily: 'var(--font-editor)',
          fontSize: '16px',
          lineHeight: '1.75',
          padding: '34px clamp(24px, 6vw, 88px) 120px',
        },
        '.cm-content': { maxWidth: '860px', margin: '0 auto', caretColor: '#bf5f3b' },
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
      aria-label="마크다운 편집기"
    />
  );
}
