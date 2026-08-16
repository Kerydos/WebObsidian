// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState, type Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { buildLivePreviewDecorations, buildLivePreviewModel, livePreview, sanitizePreviewUrl } from './livePreview';
import { Highlight, listIndentKeymap } from './markdownExtensions';

function stateFor(doc: string, anchor = doc.length) {
  return EditorState.create({
    doc,
    selection: { anchor },
    extensions: [markdown({ base: markdownLanguage, extensions: Highlight })],
  });
}

function modelFor(doc: string, anchor = doc.length) {
  return buildLivePreviewModel(stateFor(doc, anchor));
}

describe('in-place Markdown live preview', () => {
  it('recognizes inline Markdown, links, and interactive tasks', () => {
    const model = modelFor([
      '# Heading',
      '',
      '**bold** *italic* ~~done~~ `code` [site](https://example.com) [[Note|Alias]]',
      '',
      '- [ ] todo',
      '- [x] complete',
      '',
      'plain cursor',
    ].join('\n'));

    expect(model).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'heading', level: 1, active: false }),
      expect.objectContaining({ kind: 'inline', style: 'strong', active: false }),
      expect.objectContaining({ kind: 'inline', style: 'emphasis', active: false }),
      expect.objectContaining({ kind: 'inline', style: 'strike', active: false }),
      expect.objectContaining({ kind: 'inline', style: 'code', active: false }),
      expect.objectContaining({ kind: 'link', label: 'site', href: 'https://example.com' }),
      expect.objectContaining({ kind: 'wiki', label: 'Alias', target: 'Note' }),
      expect.objectContaining({ kind: 'task', checked: false }),
      expect.objectContaining({ kind: 'task', checked: true }),
    ]));
  });

  it('reveals source syntax when the cursor enters an element', () => {
    const active = modelFor('**bold** and plain', 4);
    const inactive = modelFor('**bold** and plain', 14);

    expect(active.find((element) => element.kind === 'inline')).toMatchObject({ style: 'strong', active: true });
    expect(inactive.find((element) => element.kind === 'inline')).toMatchObject({ style: 'strong', active: false });
  });

  it('recognizes block widgets without parsing Markdown inside code', () => {
    const document = [
      '```md',
      '**not bold**',
      '```',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| Test | Pass |',
      '',
      '---',
      '',
      'plain cursor',
    ].join('\n');
    const model = modelFor(document);

    expect(model).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'codeBlock', language: 'md', code: '**not bold**' }),
      expect.objectContaining({ kind: 'table', rows: [['Name', 'Value'], ['Test', 'Pass']] }),
      expect.objectContaining({ kind: 'rule' }),
    ]));
    expect(model.some((element) => element.kind === 'inline' && element.style === 'strong')).toBe(false);
    expect(() => buildLivePreviewDecorations(stateFor(document))).not.toThrow();
  });

  it('supports setext headings and images', () => {
    const model = modelFor('Heading\n=======\n\n![Alt](https://example.com/image.png)\n\nplain cursor');

    expect(model).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'heading', level: 1, setext: true }),
      expect.objectContaining({ kind: 'image', alt: 'Alt', src: 'https://example.com/image.png' }),
    ]));
  });

  it('renders indented code blocks as complete line widgets', () => {
    const model = modelFor('    const x = 1\n    const y = 2\n\nplain cursor');

    expect(model).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'codeBlock', block: true, code: 'const x = 1\nconst y = 2' }),
    ]));
  });

  it('resolves reference links and recognizes autolinks', () => {
    const model = modelFor('[Guide][docs]\n\n[docs]: https://example.com/docs\n\nVisit https://example.com now\n\nplain cursor');

    expect(model).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'link', label: 'Guide', href: 'https://example.com/docs' }),
      expect.objectContaining({ kind: 'link', label: 'https://example.com', href: 'https://example.com' }),
      expect.objectContaining({ kind: 'reference', active: false }),
    ]));
  });

  it('does not treat an undefined shortcut reference like `[label]` as a link', () => {
    const model = modelFor('This is [not a link] here\n\nplain cursor');

    expect(model.some((element) => element.kind === 'link')).toBe(false);
  });

  it('resolves a defined shortcut reference link (`[label]` reusing its own text as the reference name)', () => {
    const model = modelFor('See [docs] for more\n\n[docs]: https://example.com/docs\n\nplain cursor');

    expect(model).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'link', label: 'docs', href: 'https://example.com/docs' }),
    ]));
  });

  it('rejects executable URLs in preview widgets', () => {
    expect(sanitizePreviewUrl('javascript:alert(1)')).toBeUndefined();
    expect(sanitizePreviewUrl('https://example.com')).toBe('https://example.com');
    expect(sanitizePreviewUrl('./image.png', true)).toBe('./image.png');
  });

  it('recognizes ==highlight== spans', () => {
    const model = modelFor('This is ==important== text\n\nplain cursor');

    expect(model).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'inline', style: 'highlight', active: false }),
    ]));
  });

  it('recognizes nested unordered and ordered lists', () => {
    const model = modelFor(['- top', '  - nested', '1. first', '   1. nested ordered', '', 'plain cursor'].join('\n'));
    const lists = model.filter((element) => element.kind === 'list');

    expect(lists).toHaveLength(4);
    expect(lists.map((list) => (list as { label: string }).label)).toEqual(['-', '-', '1.', '1.']);
  });

  it('recognizes nested blockquotes', () => {
    const model = modelFor(['> outer', '>> inner', '', 'plain cursor'].join('\n'));
    const quoteMarks = model.filter((element) => element.kind === 'quote');

    expect(quoteMarks.length).toBeGreaterThanOrEqual(2);
  });

  it('recognizes Obsidian-style callouts and renders a typed header widget', () => {
    const document = ['> [!warning] Careful', '> this needs attention', '', 'plain cursor'].join('\n');
    const model = modelFor(document);
    const callout = model.find((element) => element.kind === 'callout');

    expect(callout).toMatchObject({ kind: 'callout', type: 'warning', title: 'Careful', active: false });

    const decorations = buildLivePreviewDecorations(stateFor(document));
    const iter = decorations.iter();
    let sawHeaderWidget = false;
    while (iter.value) {
      const spec = iter.value.spec as { widget?: { toDOM?: () => HTMLElement } };
      if (spec.widget?.toDOM) {
        const dom = spec.widget.toDOM();
        if (dom.className.includes('cm-live-callout-header')) {
          sawHeaderWidget = true;
          expect(dom.textContent).toBe('Careful');
        }
      }
      iter.next();
    }
    expect(sawHeaderWidget).toBe(true);
  });

  it('keeps the callout header styled while editing the body, but reveals it when the cursor is on the header line', () => {
    const document = ['> [!note] Heads up', '> body line', '', 'plain cursor'].join('\n');
    const bodyCursor = document.indexOf('body line') + 2;
    const headerCursor = document.indexOf('Heads up');

    const editingBody = modelFor(document, bodyCursor).find((element) => element.kind === 'callout')!;
    const editingHeader = modelFor(document, headerCursor).find((element) => element.kind === 'callout')!;
    expect(editingBody).toBeDefined();
    expect(editingHeader).toBeDefined();

    const bodyDecorations = buildLivePreviewDecorations(stateFor(document, bodyCursor));
    const headerDecorations = buildLivePreviewDecorations(stateFor(document, headerCursor));
    const hasHeaderWidget = (set: typeof bodyDecorations) => {
      const iter = set.iter();
      while (iter.value) {
        const spec = iter.value.spec as { widget?: { constructor: { name: string } } };
        if (spec.widget?.constructor.name === 'CalloutHeaderWidget') return true;
        iter.next();
      }
      return false;
    };
    expect(hasHeaderWidget(bodyDecorations)).toBe(true);
    expect(hasHeaderWidget(headerDecorations)).toBe(false);
  });

  it('falls back to a capitalized default title for callouts without one', () => {
    const model = modelFor(['> [!tip]', '> shortcut', '', 'plain cursor'].join('\n'));
    const callout = model.find((element) => element.kind === 'callout');

    expect(callout).toMatchObject({ type: 'tip', title: undefined });
  });

  it('renders nested inline Markdown inside table cells instead of raw source text', () => {
    const document = ['| Name | Detail |', '| --- | --- |', '| **Bold** cell | see [docs](https://example.com/docs) |', '', 'plain cursor'].join('\n');
    const decorations = buildLivePreviewDecorations(stateFor(document));
    const iter = decorations.iter();
    let tableDom: HTMLElement | undefined;
    while (iter.value) {
      const spec = iter.value.spec as { widget?: { toDOM?: (view: unknown) => HTMLElement } };
      if (spec.widget?.toDOM && spec.widget.constructor.name === 'TableWidget') {
        tableDom = spec.widget.toDOM(undefined);
      }
      iter.next();
    }
    expect(tableDom).toBeDefined();
    const boldCell = tableDom!.querySelector('td .cm-live-strong');
    expect(boldCell?.textContent).toBe('Bold');
    const linkCell = tableDom!.querySelector('td .cm-live-table-link');
    expect(linkCell?.textContent).toBe('docs');
  });

  it('indents and outdents list items with Tab / Shift-Tab, and leaves the cursor untouched outside lists', () => {
    const inList = stateFor('- item', 6);
    const indent = listIndentKeymap.find((binding) => binding.key === 'Tab')!;
    let ran = false;
    indent.run!({
      state: inList,
      dispatch: (transaction: Transaction) => {
        ran = true;
        expect(transaction.state.doc.toString().startsWith('  - item') || transaction.state.doc.toString().startsWith('\t- item')).toBe(true);
      },
    } as never);
    expect(ran).toBe(true);

    const outsideList = stateFor('plain text', 4);
    const handled = indent.run!({ state: outsideList, dispatch: () => { throw new Error('should not dispatch'); } } as never);
    expect(handled).toBe(false);
  });

  it('isolates YAML frontmatter instead of letting it be misparsed as a heading/link', () => {
    const document = ['---', 'title: Test', 'tags: [a, b]', '---', '', '# Body', '', 'content'].join('\n');
    const model = modelFor(document);
    const frontmatter = model.find((element) => element.kind === 'frontmatter');

    expect(frontmatter).toMatchObject({ from: 0, active: false });
    expect(model.some((element) => element.kind === 'heading' && element.level === 2)).toBe(false);
    expect(model).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'heading', level: 1, active: false }),
    ]));

    const decorations = buildLivePreviewDecorations(stateFor(document));
    const iter = decorations.iter();
    let widgetDom: HTMLElement | undefined;
    while (iter.value) {
      const spec = iter.value.spec as { widget?: { toDOM?: (view: unknown) => HTMLElement } };
      if (spec.widget?.constructor.name === 'FrontmatterWidget') widgetDom = spec.widget.toDOM!(undefined);
      iter.next();
    }
    expect(widgetDom?.querySelector('pre')?.textContent).toBe('title: Test\ntags: [a, b]');
  });

  it('does not treat a plain leading horizontal rule as frontmatter', () => {
    const model = modelFor(['---', '', 'plain cursor'].join('\n'));

    expect(model.some((element) => element.kind === 'frontmatter')).toBe(false);
    expect(model).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'rule' })]));
  });

  it('mounts in a real EditorView and renders block widgets (tables, code blocks, rules, frontmatter) without the "Block decorations may not be specified via plugins" CodeMirror error', () => {
    const noteContent = [
      '---',
      'title: Test',
      '---',
      '',
      '# Heading',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| **Bold** | plain |',
      '',
      '---',
      '',
      'plain cursor',
    ].join('\n');

    const container = document.createElement('div');
    document.body.append(container);
    let view: EditorView | undefined;
    try {
      expect(() => {
        view = new EditorView({
          state: EditorState.create({
            doc: noteContent,
            extensions: [markdown({ base: markdownLanguage, extensions: Highlight }), livePreview()],
          }),
          parent: container,
        });
        // Force the render/measure pass, which is where CodeMirror validates that block
        // decorations were not supplied by a ViewPlugin, then move the cursor and force it again
        // (mirrors what happens as the user clicks around a real document).
        view.requestMeasure();
        view.dispatch({ selection: { anchor: noteContent.length } });
        view.requestMeasure();
      }).not.toThrow();
    } finally {
      view?.destroy();
      container.remove();
    }
  });

  it('navigates on a plain click of a rendered wiki link, and reveals the source on Cmd/Ctrl+click', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const navigated: string[] = [];
    let view: EditorView | undefined;
    try {
      view = new EditorView({
        state: EditorState.create({
          doc: 'See [[Target Note|Alias]] for details',
          extensions: [markdown({ base: markdownLanguage, extensions: Highlight }), livePreview((target) => navigated.push(target))],
        }),
        parent: container,
      });
      view.requestMeasure();

      const link = container.querySelector<HTMLButtonElement>('.cm-live-wiki-link');
      expect(link?.textContent).toBe('Alias');

      link!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(navigated).toEqual(['Target Note']);

      const selectionBefore = view.state.selection.main.head;
      link!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      expect(navigated).toEqual(['Target Note']); // unchanged — Ctrl+click edits instead of navigating
      expect(view.state.selection.main.head).not.toBe(selectionBefore);
    } finally {
      view?.destroy();
      container.remove();
    }
  });
});
