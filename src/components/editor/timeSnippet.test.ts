// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { timeSnippet } from './markdownExtensions';

const HHMM = /^\d{2}:\d{2}$/;
let views: EditorView[] = [];

function createView(doc: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [timeSnippet],
      selection: { anchor: doc.length },
    }),
    parent: host,
  });
  views.push(view);
  return view;
}

/** Simulate typing text one character at a time at the cursor. */
function type(view: EditorView, text: string) {
  for (const ch of text) {
    const pos = view.state.selection.main.head;
    view.dispatch({
      changes: { from: pos, insert: ch },
      selection: { anchor: pos + 1 },
      userEvent: 'input.type',
    });
  }
}

afterEach(() => {
  views.forEach((view) => view.destroy());
  views = [];
  document.body.innerHTML = '';
});

describe('timeSnippet', () => {
  it('replaces :: with the current time at the very start of the document', () => {
    const view = createView('');
    type(view, '::');
    expect(view.state.doc.toString()).toMatch(HHMM);
  });

  it('replaces :: at the start of a line', () => {
    const view = createView('첫 줄입니다\n');
    type(view, '::');
    const lines = view.state.doc.toString().split('\n');
    expect(lines[1]).toMatch(HHMM);
    expect(lines[0]).toBe('첫 줄입니다');
  });

  it('replaces :: in the middle of a sentence', () => {
    const view = createView('회의 시작. ');
    type(view, '::');
    const doc = view.state.doc.toString();
    expect(doc.startsWith('회의 시작. ')).toBe(true);
    expect(doc.slice(-5)).toMatch(HHMM);
  });

  it('leaves a single colon untouched', () => {
    const view = createView('');
    type(view, ':');
    expect(view.state.doc.toString()).toBe(':');
  });

  it('does not replace an existing :: when typing other characters after it', () => {
    const view = createView('a::');
    type(view, 'b');
    expect(view.state.doc.toString()).toBe('a::b');
  });

  it('does not replace :: when it arrives as a single two-character insertion', () => {
    const view = createView('');
    view.dispatch({
      changes: { from: 0, insert: '::' },
      selection: { anchor: 2 },
    });
    expect(view.state.doc.toString()).toBe('::');
  });
});
