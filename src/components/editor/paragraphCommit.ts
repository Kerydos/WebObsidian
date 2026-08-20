import type { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

// lineNumber로 끝나는 문단(위로 빈 줄이 나올 때까지의 연속된 줄)의 원문을 반환한다.
export function paragraphEndingAt(doc: Text, lineNumber: number): string {
  let start = lineNumber;
  while (start > 1 && doc.line(start - 1).text.trim() !== '') start -= 1;
  const from = doc.line(start).from;
  const to = doc.line(lineNumber).to;
  return doc.sliceString(from, to).trim();
}

/**
 * Enter로 줄바꿈이 삽입될 때마다(목록 자동 이어쓰기 포함) 방금 완성된 문단 원문으로 콜백을 호출한다.
 * 붙여넣기처럼 줄바꿈으로 시작하지 않는 다중 삽입은 무시한다.
 */
export function paragraphCommitListener(onCommit: (paragraph: string) => void) {
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    for (const tr of update.transactions) {
      let paragraph = '';
      tr.changes.iterChanges((fromA, _toA, _fromB, _toB, inserted) => {
        if (paragraph || !inserted.toString().startsWith('\n')) return;
        const oldLine = tr.startState.doc.lineAt(fromA);
        paragraph = paragraphEndingAt(tr.startState.doc, oldLine.number);
      });
      if (paragraph) onCommit(paragraph);
    }
  });
}
