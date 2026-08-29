import { indentLess, indentMore } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { EditorView, type KeyBinding } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { tags } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';

const Punctuation = /[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/;
const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' };

/** Obsidian-style `==highlight==` syntax using `==` delimiters. */
export const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight', style: { 'Highlight/...': tags.special(tags.content) } },
    { name: 'HighlightMark', style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx, next, pos) {
        if (next !== 61 /* '=' */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const spaceBefore = /\s|^$/.test(before);
        const spaceAfter = /\s|^$/.test(after);
        const punctBefore = Punctuation.test(before);
        const punctAfter = Punctuation.test(after);
        return cx.addDelimiter(
          HighlightDelim,
          pos,
          pos + 2,
          !spaceAfter && (!punctAfter || spaceBefore || punctBefore),
          !spaceBefore && (!punctBefore || spaceAfter || punctAfter),
        );
      },
      after: 'Emphasis',
    },
  ],
};

function cursorInList(view: EditorView) {
  const { head } = view.state.selection.main;
  for (let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(head, -1); node; node = node.parent) {
    if (node.name === 'ListItem') return true;
  }
  return false;
}

/**
 * Tab/Shift-Tab indent or outdent the current list item, mirroring Obsidian.
 * Falls through to the browser default (focus navigation) outside of lists.
 */
export const listIndentKeymap: readonly KeyBinding[] = [
  { key: 'Tab', run: (view) => (cursorInList(view) ? indentMore(view) : false) },
  { key: 'Shift-Tab', run: (view) => (cursorInList(view) ? indentLess(view) : false) },
];

/**
 * Typing `::` inserts the current time (e.g. `09:00`) in place of the two colons.
 */
export const timeSnippet = EditorView.updateListener.of((update) => {
  if (!update.docChanged) return;
  const { head, empty } = update.state.selection.main;
  if (!empty) return;
  let typedColon = false;
  update.changes.iterChanges((_fromA, _toA, _fromB, toB, inserted) => {
    if (inserted.toString() === ':' && toB === head) typedColon = true;
  });
  if (!typedColon || head < 2) return;
  if (update.state.sliceDoc(head - 2, head) !== '::') return;
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  update.view.dispatch({
    changes: { from: head - 2, to: head, insert: `${hh}:${mm}` },
  });
});
