import { markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common';
import type { MarkdownParser } from '@lezer/markdown';
import { Highlight } from './markdownExtensions';

type MarkerRange = { from: number; to: number };
type VisibleRange = { from: number; to: number };

export type LivePreviewElement =
  | { kind: 'heading'; from: number; to: number; active: boolean; level: number; lineFrom: number; marker: MarkerRange; setext: boolean }
  | { kind: 'inline'; from: number; to: number; active: boolean; style: 'strong' | 'emphasis' | 'strike' | 'code' | 'highlight'; content: MarkerRange; markers: MarkerRange[] }
  | { kind: 'task'; from: number; to: number; active: boolean; checked: boolean }
  | { kind: 'list'; from: number; to: number; active: boolean; label: string }
  | { kind: 'quote'; from: number; to: number; active: boolean; lineFrom: number }
  | { kind: 'callout'; from: number; to: number; active: boolean; type: string; title?: string; headerFrom: number; headerTo: number; lineFrom: number; lineTo: number }
  | { kind: 'link'; from: number; to: number; active: boolean; label: string; href?: string }
  | { kind: 'wiki'; from: number; to: number; active: boolean; label: string; target: string }
  | { kind: 'image'; from: number; to: number; active: boolean; alt: string; src: string }
  | { kind: 'codeBlock'; from: number; to: number; active: boolean; block: boolean; code: string; language?: string }
  | { kind: 'table'; from: number; to: number; active: boolean; block: boolean; rows: string[][] }
  | { kind: 'rule'; from: number; to: number; active: boolean; block: boolean }
  | { kind: 'reference'; from: number; to: number; active: boolean; lineFrom: number }
  | { kind: 'frontmatter'; from: number; to: number; active: boolean; body: string };

const WIKI_LINK = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;
const linkReferenceCache = new WeakMap<object, Map<string, string>>();

function selectionTouches(state: EditorState, from: number, to: number) {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

function childRanges(node: SyntaxNode, name: string): MarkerRange[] {
  return node.getChildren(name).map(({ from, to }) => ({ from, to }));
}

function isWikiWrapped(state: EditorState, node: SyntaxNodeRef) {
  return node.from > 0
    && node.to < state.doc.length
    && state.doc.sliceString(node.from - 1, node.from + 1) === '[['
    && state.doc.sliceString(node.to - 1, node.to + 1) === ']]';
}

function isInsideCode(node: SyntaxNode | null) {
  for (let current = node; current; current = current.parent) {
    if (current.name === 'InlineCode' || current.name === 'FencedCode' || current.name === 'CodeBlock') return true;
  }
  return false;
}

function tableRows(state: EditorState, node: SyntaxNode) {
  const rows: string[][] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'TableHeader' && child.name !== 'TableRow') continue;
    rows.push(child.getChildren('TableCell').map((cell) => state.doc.sliceString(cell.from, cell.to).trim()));
  }
  return rows;
}

function isCompleteLineBlock(state: EditorState, from: number, to: number) {
  return state.doc.lineAt(from).from === from && state.doc.lineAt(to).to === to;
}

function collectLinkReferences(state: EditorState) {
  const cached = linkReferenceCache.get(state.doc);
  if (cached) return cached;
  const references = new Map<string, string>();
  syntaxTree(state).iterate({ enter(reference) {
    if (reference.name !== 'LinkReference') return;
    const label = reference.node.getChild('LinkLabel');
    const url = reference.node.getChild('URL');
    if (label && url) {
      references.set(
        state.doc.sliceString(label.from + 1, label.to - 1).trim().toLocaleLowerCase(),
        state.doc.sliceString(url.from, url.to),
      );
    }
    return false;
  } });
  linkReferenceCache.set(state.doc, references);
  return references;
}

const FRONTMATTER_SCAN_LIMIT = 200;

/**
 * YAML frontmatter (`---\n...\n---`) confuses the Markdown grammar (the closing `---`
 * reads as a Setext heading underline), so it is detected up front and excluded from
 * normal syntax-tree processing.
 */
function frontmatterRange(state: EditorState): MarkerRange | null {
  if (state.doc.length < 4 || state.doc.sliceString(0, 3) !== '---') return null;
  const firstLine = state.doc.lineAt(0);
  if (firstLine.text.trim() !== '---') return null;
  const lastLine = Math.min(state.doc.lines, firstLine.number + FRONTMATTER_SCAN_LIMIT);
  for (let lineNo = firstLine.number + 1; lineNo <= lastLine; lineNo += 1) {
    const line = state.doc.line(lineNo);
    if (line.text.trim() === '---') return { from: 0, to: line.to };
  }
  return null;
}

export function buildLivePreviewModel(
  state: EditorState,
  visibleRanges: readonly VisibleRange[] = [{ from: 0, to: state.doc.length }],
): LivePreviewElement[] {
  const elements: LivePreviewElement[] = [];
  const visited = new Set<string>();
  const tree = syntaxTree(state);
  const linkReferences = collectLinkReferences(state);
  const frontmatter = frontmatterRange(state);
  if (frontmatter) {
    elements.push({
      kind: 'frontmatter', from: frontmatter.from, to: frontmatter.to,
      active: selectionTouches(state, frontmatter.from, frontmatter.to),
      body: state.doc.sliceString(frontmatter.from, frontmatter.to),
    });
  }

  for (const visible of visibleRanges) {
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter: (reference) => {
        if (frontmatter && reference.to <= frontmatter.to) return false;
        const key = `${reference.name}:${reference.from}:${reference.to}`;
        if (visited.has(key)) return false;
        visited.add(key);
        const node = reference.node;
        const active = selectionTouches(state, reference.from, reference.to);

        const heading = /^(ATX|Setext)Heading([1-6])$/.exec(reference.name);
        if (heading) {
          const marker = node.getChild('HeaderMark');
          if (!marker) return;
          const setext = heading[1] === 'Setext';
          const line = state.doc.lineAt(reference.from);
          const markerTo = !setext && state.doc.sliceString(marker.to, marker.to + 1) === ' ' ? marker.to + 1 : marker.to;
          elements.push({
            kind: 'heading', from: reference.from, to: reference.to, active,
            level: Number(heading[2]), lineFrom: line.from,
            marker: { from: marker.from, to: markerTo }, setext,
          });
          return;
        }

        const inlineStyles = {
          StrongEmphasis: ['strong', 'EmphasisMark'],
          Emphasis: ['emphasis', 'EmphasisMark'],
          Strikethrough: ['strike', 'StrikethroughMark'],
          InlineCode: ['code', 'CodeMark'],
          Highlight: ['highlight', 'HighlightMark'],
        } as const;
        const inline = inlineStyles[reference.name as keyof typeof inlineStyles];
        if (inline) {
          const markers = childRanges(node, inline[1]);
          if (markers.length >= 2) {
            elements.push({
              kind: 'inline', from: reference.from, to: reference.to, active,
              style: inline[0], markers,
              content: { from: markers[0].to, to: markers.at(-1)!.from },
            });
          }
          return false;
        }

        if (reference.name === 'TaskMarker') {
          elements.push({
            kind: 'task', from: reference.from, to: reference.to, active,
            checked: /x/i.test(state.doc.sliceString(reference.from, reference.to)),
          });
          return false;
        }

        if (reference.name === 'ListMark') {
          const line = state.doc.lineAt(reference.from);
          const to = state.doc.sliceString(reference.to, reference.to + 1) === ' ' ? reference.to + 1 : reference.to;
          elements.push({
            kind: 'list', from: reference.from, to, label: state.doc.sliceString(reference.from, reference.to),
            active: selectionTouches(state, line.from, line.to),
          });
          return false;
        }

        if (reference.name === 'Blockquote') {
          const firstMark = node.getChild('QuoteMark');
          if (firstMark) {
            const line = state.doc.lineAt(firstMark.from);
            const afterMark = state.doc.sliceString(firstMark.to, line.to);
            const calloutMatch = /^[ \t]*\[!([a-zA-Z][\w-]*)\](?:[+-])?[ \t]?(.*)$/.exec(afterMark);
            if (calloutMatch) {
              const bracketOffset = afterMark.indexOf('[');
              const title = calloutMatch[2]?.trim();
              const lineTo = state.doc.lineAt(reference.to).to;
              elements.push({
                kind: 'callout', from: reference.from, to: reference.to, active,
                type: calloutMatch[1].toLowerCase(), title: title || undefined,
                headerFrom: firstMark.to + bracketOffset, headerTo: line.to,
                lineFrom: line.from, lineTo,
              });
            }
          }
          return;
        }

        if (reference.name === 'QuoteMark') {
          const line = state.doc.lineAt(reference.from);
          const to = state.doc.sliceString(reference.to, reference.to + 1) === ' ' ? reference.to + 1 : reference.to;
          elements.push({ kind: 'quote', from: reference.from, to, active: selectionTouches(state, line.from, line.to), lineFrom: line.from });
          return false;
        }

        if (reference.name === 'Link') {
          if (isWikiWrapped(state, reference)) return false;
          const marks = node.getChildren('LinkMark');
          if (marks.length >= 2) {
            const url = node.getChild('URL');
            const linkLabel = node.getChild('LinkLabel');
            // A shortcut-style `[label]` with no matching reference definition still parses as a
            // Link node (CommonMark leaves validity to the consumer) — treat it as plain text
            // rather than rendering a dead link, so e.g. `[!warning]` inside a callout header
            // isn't mistaken for a link.
            const referencedUrl = linkLabel
              ? linkReferences.get(state.doc.sliceString(linkLabel.from + 1, linkLabel.to - 1).trim().toLocaleLowerCase())
              : url ? undefined : linkReferences.get(state.doc.sliceString(marks[0].to, marks[1].from).trim().toLocaleLowerCase());
            const href = url ? state.doc.sliceString(url.from, url.to) : referencedUrl;
            if (href) {
              elements.push({
                kind: 'link', from: reference.from, to: reference.to, active,
                label: state.doc.sliceString(marks[0].to, marks[1].from),
                href,
              });
            }
          }
          return false;
        }

        if (reference.name === 'Autolink') {
          const url = node.getChild('URL');
          if (url) {
            const label = state.doc.sliceString(url.from, url.to);
            elements.push({
              kind: 'link', from: reference.from, to: reference.to, active,
              label, href: label.includes('@') ? `mailto:${label}` : label,
            });
          }
          return false;
        }

        if (reference.name === 'URL') {
          const label = state.doc.sliceString(reference.from, reference.to);
          elements.push({ kind: 'link', from: reference.from, to: reference.to, active, label, href: label });
          return false;
        }

        if (reference.name === 'LinkReference') {
          const line = state.doc.lineAt(reference.from);
          elements.push({ kind: 'reference', from: reference.from, to: reference.to, active, lineFrom: line.from });
          return false;
        }

        if (reference.name === 'Image') {
          const marks = node.getChildren('LinkMark');
          const url = node.getChild('URL');
          if (marks.length >= 2 && url) {
            elements.push({
              kind: 'image', from: reference.from, to: reference.to, active,
              alt: state.doc.sliceString(marks[0].to, marks[1].from),
              src: state.doc.sliceString(url.from, url.to),
            });
          }
          return false;
        }

        if (reference.name === 'FencedCode' || reference.name === 'CodeBlock') {
          const code = node.getChild('CodeText');
          const language = node.getChild('CodeInfo');
          const indented = reference.name === 'CodeBlock';
          const from = indented ? state.doc.lineAt(reference.from).from : reference.from;
          const to = indented ? state.doc.lineAt(reference.to).to : reference.to;
          const content = indented
            ? state.doc.sliceString(from, to).split('\n').map((line) => line.replace(/^ {1,4}/, '')).join('\n')
            : code ? state.doc.sliceString(code.from, code.to) : '';
          elements.push({
            kind: 'codeBlock', from, to, active: selectionTouches(state, from, to),
            block: isCompleteLineBlock(state, from, to), code: content,
            language: language ? state.doc.sliceString(language.from, language.to) : undefined,
          });
          return false;
        }

        if (reference.name === 'Table') {
          elements.push({
            kind: 'table', from: reference.from, to: reference.to, active,
            block: isCompleteLineBlock(state, reference.from, reference.to), rows: tableRows(state, node),
          });
          return false;
        }

        if (reference.name === 'HorizontalRule') {
          elements.push({
            kind: 'rule', from: reference.from, to: reference.to, active,
            block: isCompleteLineBlock(state, reference.from, reference.to),
          });
          return false;
        }
      },
    });

    const from = state.doc.lineAt(visible.from).from;
    const to = state.doc.lineAt(Math.min(visible.to, state.doc.length)).to;
    const text = state.doc.sliceString(from, to);
    WIKI_LINK.lastIndex = 0;
    for (let match = WIKI_LINK.exec(text); match; match = WIKI_LINK.exec(text)) {
      const start = from + match.index;
      const end = start + match[0].length;
      const key = `wiki:${start}:${end}`;
      if (visited.has(key) || isInsideCode(tree.resolveInner(start, 1))) continue;
      if (frontmatter && start < frontmatter.to) continue;
      visited.add(key);
      elements.push({
        kind: 'wiki', from: start, to: end, active: selectionTouches(state, start, end),
        target: match[1].trim(), label: (match[2] ?? match[1]).trim(),
      });
    }
  }

  return elements.sort((a, b) => a.from - b.from || a.to - b.to);
}

function activate(view: EditorView, position: number) {
  view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
  view.focus();
}

export function sanitizePreviewUrl(value: string | undefined, image = false) {
  if (!value) return undefined;
  const url = value.trim();
  if (/^https?:\/\//i.test(url) || (!image && /^mailto:/i.test(url))) return url;
  if (image && /^(blob:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(url)) return url;
  if (!/^[a-z][a-z\d+.-]*:/i.test(url)) return url;
  return undefined;
}

class TextWidget extends WidgetType {
  constructor(readonly text: string, readonly className: string) { super(); }
  eq(other: WidgetType) { return other instanceof TextWidget && other.text === this.text && other.className === this.className; }
  toDOM() {
    const span = document.createElement('span');
    span.className = this.className;
    span.textContent = this.text;
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly from: number, readonly to: number, readonly checked: boolean) { super(); }
  eq(other: WidgetType) { return other instanceof CheckboxWidget && other.from === this.from && other.to === this.to && other.checked === this.checked; }
  toDOM(view: EditorView) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'cm-live-checkbox';
    input.checked = this.checked;
    input.setAttribute('aria-label', this.checked ? '완료됨' : '미완료');
    input.addEventListener('change', () => {
      view.dispatch({ changes: { from: this.from, to: this.to, insert: input.checked ? '[x]' : '[ ]' } });
      view.focus();
    });
    return input;
  }
  ignoreEvent() { return true; }
}

abstract class EditableWidget extends WidgetType {
  constructor(readonly from: number) { super(); }
  bindEdit(dom: HTMLElement, view: EditorView) {
    dom.addEventListener('click', (event) => {
      event.preventDefault();
      activate(view, this.from);
    });
  }
  eq(other: WidgetType) { return other instanceof EditableWidget && other.from === this.from; }
  abstract toDOM(view: EditorView): HTMLElement;
  ignoreEvent() { return true; }
}

class LinkWidget extends EditableWidget {
  constructor(from: number, readonly label: string, readonly href?: string) { super(from); }
  eq(other: WidgetType) { return other instanceof LinkWidget && super.eq(other) && other.label === this.label && other.href === this.href; }
  toDOM(view: EditorView) {
    const link = document.createElement('a');
    link.className = 'cm-live-link';
    link.textContent = this.label;
    const href = sanitizePreviewUrl(this.href);
    link.href = href ?? '#';
    link.title = href ? `${href} (⌘/Ctrl+클릭하여 열기)` : '클릭하여 편집';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if ((event.metaKey || event.ctrlKey) && href) window.open(href, '_blank', 'noopener,noreferrer');
      else activate(view, this.from);
    });
    return link;
  }
}

class WikiLinkWidget extends EditableWidget {
  constructor(from: number, readonly label: string, readonly target: string, readonly navigate?: (target: string) => void) { super(from); }
  eq(other: WidgetType) { return other instanceof WikiLinkWidget && super.eq(other) && other.label === this.label && other.target === this.target; }
  toDOM(view: EditorView) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-live-wiki-link';
    button.textContent = this.label;
    button.title = '클릭하여 노트 열기 (⌘/Ctrl+클릭하여 원문 편집)';
    button.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey) activate(view, this.from);
      else this.navigate?.(this.target);
    });
    return button;
  }
}

class ImageWidget extends EditableWidget {
  constructor(from: number, readonly alt: string, readonly src: string) { super(from); }
  eq(other: WidgetType) { return other instanceof ImageWidget && super.eq(other) && other.alt === this.alt && other.src === this.src; }
  toDOM(view: EditorView) {
    const image = document.createElement('img');
    image.className = 'cm-live-image';
    const src = sanitizePreviewUrl(this.src, true);
    if (src) image.src = src;
    image.alt = this.alt;
    image.loading = 'lazy';
    image.title = '클릭하여 이미지 문법 편집';
    this.bindEdit(image, view);
    return image;
  }
}

class CodeBlockWidget extends EditableWidget {
  constructor(from: number, readonly code: string, readonly language?: string) { super(from); }
  eq(other: WidgetType) { return other instanceof CodeBlockWidget && super.eq(other) && other.code === this.code && other.language === this.language; }
  toDOM(view: EditorView) {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-live-code-block';
    if (this.language) {
      const label = document.createElement('span');
      label.textContent = this.language;
      wrapper.append(label);
    }
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = this.code;
    pre.append(code);
    wrapper.append(pre);
    this.bindEdit(wrapper, view);
    return wrapper;
  }
}

const cellInlineParser = (markdownLanguage.parser as MarkdownParser).configure(Highlight);
const INLINE_STYLE_CLASSES: Record<string, string> = {
  StrongEmphasis: 'cm-live-strong',
  Emphasis: 'cm-live-emphasis',
  Strikethrough: 'cm-live-strike',
  InlineCode: 'cm-live-inline-code',
  Highlight: 'cm-live-highlight',
};
const INLINE_MARK_NODE_NAMES = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark', 'HighlightMark', 'LinkMark']);
const INLINE_LINK_NODE_NAMES = new Set(['Link', 'Image', 'Autolink', 'URL']);

/** Renders GFM-style inline Markdown (bold, italic, code, links, …) as plain DOM for non-editable widgets like table cells. */
function renderInlineMarkdown(container: HTMLElement, text: string) {
  const tree = cellInlineParser.parse(text);
  let pos = 0;
  const flushTo = (target: HTMLElement, to: number) => {
    if (to > pos) {
      target.append(document.createTextNode(text.slice(pos, to)));
      pos = to;
    }
  };
  const walk = (node: SyntaxNode, target: HTMLElement) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (INLINE_MARK_NODE_NAMES.has(child.name)) {
        flushTo(target, child.from);
        pos = child.to;
        continue;
      }
      const styleClass = INLINE_STYLE_CLASSES[child.name];
      if (styleClass) {
        flushTo(target, child.from);
        const span = document.createElement('span');
        span.className = styleClass;
        target.append(span);
        walk(child, span);
        flushTo(span, child.to);
        continue;
      }
      if (INLINE_LINK_NODE_NAMES.has(child.name)) {
        flushTo(target, child.from);
        const marksIn = child.getChildren('LinkMark');
        const labelFrom = marksIn[0]?.to ?? child.from;
        const labelTo = marksIn[1]?.from ?? child.to;
        const span = document.createElement('span');
        span.className = 'cm-live-table-link';
        span.textContent = text.slice(labelFrom, labelTo);
        target.append(span);
        pos = child.to;
        continue;
      }
      walk(child, target);
    }
  };
  walk(tree.topNode, container);
  flushTo(container, text.length);
}

class TableWidget extends EditableWidget {
  constructor(from: number, readonly rows: string[][]) { super(from); }
  eq(other: WidgetType) { return other instanceof TableWidget && super.eq(other) && JSON.stringify(other.rows) === JSON.stringify(this.rows); }
  toDOM(view: EditorView) {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-live-table-wrap';
    const table = document.createElement('table');
    this.rows.forEach((row, rowIndex) => {
      const section = rowIndex === 0 ? table.createTHead() : table.tBodies[0] ?? table.createTBody();
      const tr = section.insertRow();
      row.forEach((cell) => {
        const element = rowIndex === 0 ? document.createElement('th') : document.createElement('td');
        renderInlineMarkdown(element, cell);
        tr.append(element);
      });
    });
    wrapper.append(table);
    this.bindEdit(wrapper, view);
    return wrapper;
  }
}

class RuleWidget extends EditableWidget {
  toDOM(view: EditorView) {
    const rule = document.createElement('div');
    rule.className = 'cm-live-rule';
    rule.setAttribute('role', 'separator');
    this.bindEdit(rule, view);
    return rule;
  }
}

class FrontmatterWidget extends EditableWidget {
  constructor(from: number, readonly body: string) { super(from); }
  eq(other: WidgetType) { return other instanceof FrontmatterWidget && super.eq(other) && other.body === this.body; }
  toDOM(view: EditorView) {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-live-frontmatter';
    const label = document.createElement('span');
    label.textContent = '속성';
    wrapper.append(label);
    const pre = document.createElement('pre');
    pre.textContent = this.body.replace(/^---\n/, '').replace(/\n?---$/, '');
    wrapper.append(pre);
    this.bindEdit(wrapper, view);
    return wrapper;
  }
}

const marks = {
  strong: Decoration.mark({ class: 'cm-live-strong' }),
  emphasis: Decoration.mark({ class: 'cm-live-emphasis' }),
  strike: Decoration.mark({ class: 'cm-live-strike' }),
  code: Decoration.mark({ class: 'cm-live-inline-code' }),
  highlight: Decoration.mark({ class: 'cm-live-highlight' }),
};

const CALLOUT_TYPES: Record<string, { label: string; className: string }> = {
  note: { label: '노트', className: 'note' },
  abstract: { label: '요약', className: 'abstract' },
  summary: { label: '요약', className: 'abstract' },
  tldr: { label: '요약', className: 'abstract' },
  info: { label: '정보', className: 'info' },
  todo: { label: '할 일', className: 'info' },
  tip: { label: '팁', className: 'tip' },
  hint: { label: '팁', className: 'tip' },
  important: { label: '중요', className: 'tip' },
  success: { label: '성공', className: 'success' },
  check: { label: '성공', className: 'success' },
  done: { label: '성공', className: 'success' },
  question: { label: '질문', className: 'question' },
  help: { label: '질문', className: 'question' },
  faq: { label: '질문', className: 'question' },
  warning: { label: '경고', className: 'warning' },
  caution: { label: '경고', className: 'warning' },
  attention: { label: '경고', className: 'warning' },
  failure: { label: '실패', className: 'danger' },
  fail: { label: '실패', className: 'danger' },
  missing: { label: '실패', className: 'danger' },
  danger: { label: '위험', className: 'danger' },
  error: { label: '오류', className: 'danger' },
  bug: { label: '버그', className: 'danger' },
  example: { label: '예시', className: 'example' },
  quote: { label: '인용', className: 'quote' },
  cite: { label: '인용', className: 'quote' },
};

function calloutStyle(type: string) {
  return CALLOUT_TYPES[type] ?? { label: type, className: 'note' };
}

class CalloutHeaderWidget extends WidgetType {
  constructor(readonly type: string, readonly title?: string) { super(); }
  eq(other: WidgetType) { return other instanceof CalloutHeaderWidget && other.type === this.type && other.title === this.title; }
  toDOM() {
    const wrap = document.createElement('span');
    const style = calloutStyle(this.type);
    wrap.className = `cm-live-callout-header cm-live-callout-${style.className}`;
    wrap.setAttribute('aria-hidden', 'true');
    const label = document.createElement('strong');
    label.textContent = this.title || style.label;
    wrap.append(label);
    return wrap;
  }
}

/**
 * CodeMirror forbids `block: true` replace decorations from a `ViewPlugin` (they may only come
 * from a `StateField`), so block-level widgets (code blocks, tables, rules, frontmatter) are
 * built separately from the inline/line decorations that the live-preview `ViewPlugin` supplies.
 * See `livePreview()` below for how the two are wired into the editor.
 */
function buildDecorationParts(
  state: EditorState,
  visibleRanges: readonly VisibleRange[],
  navigate?: (target: string) => void,
): { inline: Range<Decoration>[]; block: Range<Decoration>[] } {
  const inline: Range<Decoration>[] = [];
  const block: Range<Decoration>[] = [];
  const addInline = (from: number, to: number, decoration: Decoration) => inline.push(decoration.range(from, to));
  const addBlock = (from: number, to: number, decoration: Decoration) => block.push(decoration.range(from, to));

  for (const element of buildLivePreviewModel(state, visibleRanges)) {
    if (element.kind === 'heading') {
      addInline(element.lineFrom, element.lineFrom, Decoration.line({ class: `cm-live-h${element.level}` }));
      if (!element.active) {
        if (element.setext) {
          const markerLine = state.doc.lineAt(element.marker.from);
          addInline(markerLine.from, markerLine.from, Decoration.line({ class: 'cm-live-hidden-line' }));
        } else addInline(element.marker.from, element.marker.to, Decoration.replace({}));
      }
    } else if (element.kind === 'inline') {
      addInline(element.content.from, element.content.to, marks[element.style]);
      if (!element.active) element.markers.forEach((marker) => addInline(marker.from, marker.to, Decoration.replace({})));
    } else if (element.kind === 'task') {
      if (!element.active) addInline(element.from, element.to, Decoration.replace({ widget: new CheckboxWidget(element.from, element.to, element.checked) }));
    } else if (element.kind === 'list') {
      if (!element.active) {
        const label = /^\d/.test(element.label) ? `${element.label} ` : '• ';
        addInline(element.from, element.to, Decoration.replace({ widget: new TextWidget(label, 'cm-live-list-mark') }));
      }
    } else if (element.kind === 'quote') {
      addInline(element.lineFrom, element.lineFrom, Decoration.line({ class: 'cm-live-quote' }));
      if (!element.active) addInline(element.from, element.to, Decoration.replace({ widget: new TextWidget('❯ ', 'cm-live-quote-mark') }));
    } else if (element.kind === 'callout') {
      const style = calloutStyle(element.type);
      for (let line = state.doc.lineAt(element.lineFrom); ; line = state.doc.line(line.number + 1)) {
        addInline(line.from, line.from, Decoration.line({ class: `cm-live-callout cm-live-callout-${style.className}` }));
        if (line.to >= element.lineTo) break;
      }
      const headerActive = selectionTouches(state, element.lineFrom, element.headerTo);
      if (!headerActive) addInline(element.headerFrom, element.headerTo, Decoration.replace({ widget: new CalloutHeaderWidget(element.type, element.title) }));
    } else if (element.kind === 'link') {
      if (!element.active) addInline(element.from, element.to, Decoration.replace({ widget: new LinkWidget(element.from, element.label, element.href) }));
    } else if (element.kind === 'wiki') {
      if (!element.active) addInline(element.from, element.to, Decoration.replace({ widget: new WikiLinkWidget(element.from, element.label, element.target, navigate) }));
    } else if (element.kind === 'image') {
      if (!element.active) addInline(element.from, element.to, Decoration.replace({ widget: new ImageWidget(element.from, element.alt, element.src) }));
    } else if (element.kind === 'codeBlock') {
      if (!element.active && element.block) addBlock(element.from, element.to, Decoration.replace({ widget: new CodeBlockWidget(element.from, element.code, element.language), block: true }));
    } else if (element.kind === 'table') {
      if (!element.active && element.block) addBlock(element.from, element.to, Decoration.replace({ widget: new TableWidget(element.from, element.rows), block: true }));
    } else if (element.kind === 'rule') {
      if (!element.active && element.block) addBlock(element.from, element.to, Decoration.replace({ widget: new RuleWidget(element.from), block: true }));
    } else if (element.kind === 'reference') {
      if (!element.active) addInline(element.lineFrom, element.lineFrom, Decoration.line({ class: 'cm-live-hidden-line' }));
    } else if (element.kind === 'frontmatter') {
      if (!element.active) addBlock(element.from, element.to, Decoration.replace({ widget: new FrontmatterWidget(element.from, element.body), block: true }));
    }
  }
  return { inline, block };
}

/** Full decoration set (inline + block) for a given state; used by tests and as the basis for the split builders below. */
export function buildLivePreviewDecorations(
  state: EditorState,
  visibleRanges: readonly VisibleRange[] = [{ from: 0, to: state.doc.length }],
  navigate?: (target: string) => void,
): DecorationSet {
  const { inline, block } = buildDecorationParts(state, visibleRanges, navigate);
  return Decoration.set([...inline, ...block], true);
}

const livePreviewTheme = EditorView.theme({
  '.cm-line[class*="cm-live-h"]': { fontFamily: 'var(--font-heading)', color: 'var(--markdown-heading)' },
  '.cm-line.cm-live-h1, .cm-line.cm-live-h2, .cm-line.cm-live-h3, .cm-line.cm-live-h4, .cm-line.cm-live-h5': { borderBottom: '0', textDecoration: 'none' },
  '.cm-line.cm-live-h1 *, .cm-line.cm-live-h2 *, .cm-line.cm-live-h3 *, .cm-line.cm-live-h4 *, .cm-line.cm-live-h5 *': { textDecoration: 'none' },
  '.cm-line.cm-live-h1': { paddingTop: 'calc(.55em * var(--document-spacing))', paddingBottom: '.18em', fontSize: 'var(--markdown-h1-size)', fontWeight: '740', lineHeight: '1.35', letterSpacing: '-.025em' },
  '.cm-line.cm-live-h2': { paddingTop: 'calc(.48em * var(--document-spacing))', paddingBottom: '.14em', fontSize: 'var(--markdown-h2-size)', fontWeight: '720', lineHeight: '1.4', letterSpacing: '-.02em' },
  '.cm-line.cm-live-h3': { paddingTop: 'calc(.4em * var(--document-spacing))', fontSize: 'var(--markdown-h3-size)', fontWeight: '700', lineHeight: '1.45', letterSpacing: '-.015em' },
  '.cm-line.cm-live-h4': { paddingTop: 'calc(.32em * var(--document-spacing))', fontSize: 'var(--markdown-h4-size)', fontWeight: '680', lineHeight: '1.5', letterSpacing: '-.01em' },
  '.cm-line.cm-live-h5': { paddingTop: 'calc(.24em * var(--document-spacing))', fontSize: 'var(--markdown-h5-size)', fontWeight: '660', lineHeight: '1.55' },
  '.cm-line.cm-live-h6': { paddingTop: 'calc(.2em * var(--document-spacing))', fontSize: '.9em', fontWeight: '700', color: 'var(--markdown-muted)', letterSpacing: '.02em' },
  '.cm-live-strong': { fontWeight: '750' },
  '.cm-live-emphasis': { fontStyle: 'italic' },
  '.cm-live-strike': { textDecoration: 'line-through', color: 'var(--markdown-muted)' },
  '.cm-live-inline-code': { padding: '2px 5px', border: '1px solid color-mix(in srgb, var(--line) 75%, transparent)', borderRadius: '5px', background: 'var(--markdown-code-bg)', color: 'var(--markdown-code-text)', fontFamily: 'var(--font-code)', fontSize: '.88em' },
  '.cm-live-highlight': { padding: '.05em 0', background: 'color-mix(in srgb, #ffd25a 55%, transparent)', color: 'var(--markdown-heading)', borderRadius: '2px' },
  '.cm-live-list-mark': { color: 'var(--accent)', fontWeight: '750' },
  '.cm-line.cm-live-quote': { paddingLeft: '12px', borderLeft: '3px solid var(--accent)', background: 'var(--markdown-quote-bg)', color: 'var(--markdown-muted)', fontStyle: 'italic' },
  '.cm-live-quote-mark': { display: 'inline-block', marginRight: '5px', color: 'var(--accent)', fontWeight: '700', fontStyle: 'normal' },
  '.cm-line.cm-live-callout': { paddingLeft: '12px', paddingTop: '2px', paddingBottom: '2px', fontStyle: 'normal' },
  '.cm-line[class*="cm-live-callout-"]': { borderLeftWidth: '3px', borderLeftStyle: 'solid', fontStyle: 'normal' },
  '.cm-live-callout-header': { display: 'inline-flex', alignItems: 'center', gap: '6px', fontStyle: 'normal', fontWeight: '750' },
  '.cm-live-callout-header::before': { content: '""', width: '9px', height: '9px', borderRadius: '50%', background: 'currentColor' },
  '.cm-line.cm-live-callout-note, .cm-live-callout-header.cm-live-callout-note': { borderLeftColor: '#4b8bd6', background: 'color-mix(in srgb, #4b8bd6 10%, transparent)', color: '#3971ad' },
  '.cm-line.cm-live-callout-abstract, .cm-live-callout-header.cm-live-callout-abstract': { borderLeftColor: '#3fb0c9', background: 'color-mix(in srgb, #3fb0c9 10%, transparent)', color: '#2c8ba0' },
  '.cm-line.cm-live-callout-info, .cm-live-callout-header.cm-live-callout-info': { borderLeftColor: '#4b8bd6', background: 'color-mix(in srgb, #4b8bd6 10%, transparent)', color: '#3971ad' },
  '.cm-line.cm-live-callout-tip, .cm-live-callout-header.cm-live-callout-tip': { borderLeftColor: '#3ea678', background: 'color-mix(in srgb, #3ea678 10%, transparent)', color: '#2e8560' },
  '.cm-line.cm-live-callout-success, .cm-live-callout-header.cm-live-callout-success': { borderLeftColor: '#5f9e6e', background: 'color-mix(in srgb, #5f9e6e 10%, transparent)', color: '#4a7f57' },
  '.cm-line.cm-live-callout-question, .cm-live-callout-header.cm-live-callout-question': { borderLeftColor: '#d9a441', background: 'color-mix(in srgb, #d9a441 12%, transparent)', color: '#a97c2c' },
  '.cm-line.cm-live-callout-warning, .cm-live-callout-header.cm-live-callout-warning': { borderLeftColor: '#e08a3c', background: 'color-mix(in srgb, #e08a3c 12%, transparent)', color: '#b3691f' },
  '.cm-line.cm-live-callout-danger, .cm-live-callout-header.cm-live-callout-danger': { borderLeftColor: '#c0392b', background: 'color-mix(in srgb, #c0392b 10%, transparent)', color: '#a5301f' },
  '.cm-line.cm-live-callout-example, .cm-live-callout-header.cm-live-callout-example': { borderLeftColor: '#8b6bc9', background: 'color-mix(in srgb, #8b6bc9 10%, transparent)', color: '#6d4fa8' },
  '.cm-line.cm-live-callout-quote, .cm-live-callout-header.cm-live-callout-quote': { borderLeftColor: 'var(--muted)', background: 'var(--markdown-quote-bg)', color: 'var(--markdown-muted)' },
  '.cm-live-checkbox': { width: '0.8em', height: '0.8em', margin: '0 8px 0 0', verticalAlign: '0', accentColor: 'var(--accent)', cursor: 'pointer' },
  '.cm-live-link': { color: 'var(--markdown-link)', fontWeight: '560', textDecoration: 'none', cursor: 'text' },
  '.cm-live-link:hover': { color: 'var(--markdown-link-hover)', textDecoration: 'none' },
  '.cm-live-wiki-link': { padding: '1px 6px', border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)', borderRadius: 'calc(var(--widget-radius) * .625)', background: 'var(--accent-soft)', color: 'var(--markdown-link-hover)', cursor: 'text', font: 'inherit', fontWeight: '600' },
  '.cm-live-wiki-link:hover': { borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)', background: 'color-mix(in srgb, var(--accent-soft) 72%, white)' },
  '.cm-live-image': { display: 'inline-block', maxWidth: 'min(100%, 640px)', maxHeight: '420px', border: '1px solid var(--line)', borderRadius: '9px', boxShadow: '0 4px 18px rgba(53, 45, 37, .1)', verticalAlign: 'middle', cursor: 'text' },
  '.cm-live-code-block': { position: 'relative', margin: '10px 0', padding: '18px', border: '1px solid var(--line)', borderRadius: 'var(--widget-radius)', background: 'var(--markdown-code-block-bg)', color: 'var(--markdown-code-block-text)', cursor: 'text' },
  '.cm-live-code-block > span': { position: 'absolute', top: '7px', right: '10px', color: '#aaa197', fontFamily: 'var(--font-code)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.06em' },
  '.cm-live-code-block pre': { margin: '0', overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-code)', fontSize: '14px', lineHeight: '1.65' },
  '.cm-live-table-wrap': { margin: '10px 0', overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--widget-radius)', cursor: 'text' },
  '.cm-live-table-wrap table': { width: '100%', borderCollapse: 'collapse', fontSize: '14px' },
  '.cm-live-table-wrap th, .cm-live-table-wrap td': { padding: '8px 11px', borderRight: '1px solid var(--line)', borderBottom: '1px solid var(--line)', textAlign: 'left' },
  '.cm-live-table-wrap tr:last-child td': { borderBottom: '0' },
  '.cm-live-table-wrap th:last-child, .cm-live-table-wrap td:last-child': { borderRight: '0' },
  '.cm-live-table-wrap th': { background: 'var(--markdown-code-bg)', color: 'var(--markdown-heading)', fontWeight: '700' },
  '.cm-live-table-link': { color: 'var(--markdown-link)', textDecoration: 'underline', textDecorationColor: 'color-mix(in srgb, var(--markdown-link) 45%, transparent)' },
  '.cm-live-table-wrap tbody tr:nth-child(even)': { background: 'color-mix(in srgb, var(--panel) 38%, transparent)' },
  '.cm-live-rule': { height: '1px', margin: '22px 0', background: 'var(--line)', cursor: 'text' },
  '.cm-live-frontmatter': { margin: '0 0 14px', padding: '10px 14px', border: '1px dashed var(--line)', borderRadius: 'var(--widget-radius)', background: 'var(--panel)', cursor: 'text' },
  '.cm-live-frontmatter > span': { display: 'block', marginBottom: '4px', color: 'var(--markdown-muted)', fontFamily: 'var(--font-code)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' },
  '.cm-live-frontmatter pre': { margin: '0', whiteSpace: 'pre-wrap', color: 'var(--markdown-muted)', fontFamily: 'var(--font-code)', fontSize: '12.5px', lineHeight: '1.6' },
  '.cm-line.cm-live-hidden-line': { height: '0', minHeight: '0', padding: '0', overflow: 'hidden', lineHeight: '0', fontSize: '0' },
});

export function livePreview(navigate?: (target: string) => void) {
  // Inline/line decorations (marks, hidden markers, checkboxes, links, …) can safely come from a
  // ViewPlugin and benefit from being limited to `view.visibleRanges` for large documents.
  const inlinePlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = Decoration.set(buildDecorationParts(view.state, view.visibleRanges, navigate).inline, true);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = Decoration.set(buildDecorationParts(update.state, update.view.visibleRanges, navigate).inline, true);
      }
    }
  }, { decorations: (value) => value.decorations });

  // Block-replace decorations (code blocks, tables, rules, frontmatter) must come from a
  // StateField — CodeMirror throws "Block decorations may not be specified via plugins" otherwise.
  // A StateField has no view/viewport, so this always scans the full document.
  const blockField = StateField.define<DecorationSet>({
    create: (state) => Decoration.set(buildDecorationParts(state, [{ from: 0, to: state.doc.length }], navigate).block, true),
    update: (value, tr) => {
      if (!tr.docChanged && !tr.selection) return value;
      return Decoration.set(buildDecorationParts(tr.state, [{ from: 0, to: tr.state.doc.length }], navigate).block, true);
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  return [inlinePlugin, blockField, livePreviewTheme];
}
