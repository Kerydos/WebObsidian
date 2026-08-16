import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { buildLivePreviewDecorations, buildLivePreviewModel, sanitizePreviewUrl } from './livePreview';

function modelFor(doc: string, anchor = doc.length) {
  const state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [markdown({ base: markdownLanguage })],
  });
  return buildLivePreviewModel(state);
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
    const state = EditorState.create({ doc: document, selection: { anchor: document.length }, extensions: [markdown({ base: markdownLanguage })] });
    expect(() => buildLivePreviewDecorations(state)).not.toThrow();
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

  it('rejects executable URLs in preview widgets', () => {
    expect(sanitizePreviewUrl('javascript:alert(1)')).toBeUndefined();
    expect(sanitizePreviewUrl('https://example.com')).toBe('https://example.com');
    expect(sanitizePreviewUrl('./image.png', true)).toBe('./image.png');
  });
});
