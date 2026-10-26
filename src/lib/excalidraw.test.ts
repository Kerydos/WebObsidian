import { describe, expect, it } from 'vitest';
import { isExcalidrawPath, parseExcalidraw, serializeExcalidraw } from './excalidraw';

describe('excalidraw', () => {
  it('detects drawing paths', () => {
    expect(isExcalidrawPath('a/그림.excalidraw.md')).toBe(true);
    expect(isExcalidrawPath('a/note.md')).toBe(false);
  });

  it('round-trips a scene and drops deleted elements and unused files', () => {
    const markdown = serializeExcalidraw({
      elements: [
        { id: 't1', type: 'text', text: '안녕' },
        { id: 'i1', type: 'image', fileId: 'f1' },
        { id: 'gone', type: 'rectangle', isDeleted: true },
      ],
      appState: { viewBackgroundColor: '#000', zoom: 2 },
      files: { f1: { id: 'f1' }, f2: { id: 'f2' } },
    });
    expect(markdown).toContain('안녕 ^t1');
    const scene = parseExcalidraw(markdown);
    expect(scene.elements.map((element) => element.id)).toEqual(['t1', 'i1']);
    expect(Object.keys(scene.files ?? {})).toEqual(['f1']);
    expect(scene.appState).toEqual({ viewBackgroundColor: '#000', gridSize: null });
  });

  it('treats an empty file as an empty scene and rejects compressed drawings', () => {
    expect(parseExcalidraw('').elements).toEqual([]);
    expect(() => parseExcalidraw('```compressed-json\nabc\n```')).toThrow();
  });
});
