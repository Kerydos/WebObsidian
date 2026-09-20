import { indentLess, indentMore } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { EditorView, type KeyBinding } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { tags } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';

// Same Unicode-aware punctuation class @lezer/markdown uses for flanking rules.
const Punctuation = /[\p{S}\p{P}]/u;
const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' };
// Hangul, kana and CJK ideographs: languages that attach particles directly after emphasis (`**'강조'**는`).
const CJK = /[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/;

type ParserInternals = {
  parser: { inlineParsers: (((cx: unknown, next: number, pos: number) => number) | undefined)[]; inlineNames: string[] };
  parts: ({ side: number } | null)[];
};

/**
 * CommonMark rejects `**'강조'**는` and `**암묵지(Tacit)**를`: a delimiter touching punctuation must be
 * followed (or preceded) by whitespace or punctuation, which Korean text never has. This wraps the
 * built-in `*` and `~~` parsers and treats a CJK letter on the outer side like whitespace, as Obsidian renders it.
 */
export const CjkEmphasis: MarkdownConfig = {
  parseInline: [
    {
      name: 'CjkEmphasis',
      parse(cx, next, start) {
        const name = next === 42 /* '*' */ ? 'Emphasis' : next === 126 /* '~' */ ? 'Strikethrough' : undefined;
        // ponytail: relies on @lezer/markdown internals (inlineParsers/parts); falls back to CommonMark if they change.
        const { parser, parts } = cx as unknown as ParserInternals;
        const builtin = name ? parser?.inlineParsers?.[parser.inlineNames.indexOf(name)] : undefined;
        if (!builtin) return -1;
        const end = builtin(cx, next, start);
        const delimiter = end < 0 ? undefined : parts[parts.length - 1];
        if (!delimiter || typeof delimiter.side !== 'number') return end;
        const before = cx.slice(start - 1, start);
        const after = cx.slice(end, end + 1);
        if (Punctuation.test(after) && CJK.test(before)) delimiter.side |= 1; /* can open */
        if (Punctuation.test(before) && CJK.test(after)) delimiter.side |= 2; /* can close */
        return end;
      },
      before: 'Emphasis',
    },
  ],
};

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
          !spaceAfter && (!punctAfter || spaceBefore || punctBefore || CJK.test(before)),
          !spaceBefore && (!punctBefore || spaceAfter || punctAfter || CJK.test(after)),
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
