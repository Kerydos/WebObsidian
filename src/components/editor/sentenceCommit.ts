import type { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

// 줄바꿈이 삽입되기 직전, 커서가 있던 줄의 원문(방금 완성된 문장)을 반환한다.
export function lineTextAt(doc: Text, offset: number): string {
  return doc.lineAt(offset).text.trim();
}

/**
 * Enter로 줄바꿈이 삽입될 때마다(목록 자동 이어쓰기 포함) 엔터 직전 줄, 즉 방금 완성된
 * 한 문장의 원문으로 콜백을 호출한다. 붙여넣기처럼 줄바꿈으로 시작하지 않는 다중 삽입은 무시한다.
 */
export function sentenceCommitListener(onCommit: (sentence: string) => void) {
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    for (const tr of update.transactions) {
      let sentence = '';
      tr.changes.iterChanges((fromA, _toA, _fromB, _toB, inserted) => {
        if (sentence || !inserted.toString().startsWith('\n')) return;
        sentence = lineTextAt(tr.startState.doc, fromA);
      });
      if (sentence) onCommit(sentence);
    }
  });
}
