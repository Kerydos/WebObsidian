import { describe, expect, it } from 'vitest';
import { checkMarkdown, extractProse, parseBareun, parseLanguageTool, toSourceMatches } from './spellcheck.mjs';

describe('spellcheck', () => {
  it('extracts prose from markdown and maps positions back', () => {
    const markdown = '# 제목\n- **강조**는 [링크](https://x.y) `code` 끝\n```js\nconst a = 1;\n```\n';
    const extracted = extractProse(markdown);
    expect(extracted.prose).toBe('제목\n강조는 링크  끝\n\n\n\n');
    const at = extracted.prose.indexOf('강조는');
    const [match] = toSourceMatches(extracted, [{ from: at, to: at + 3, message: '', replacements: [], source: 'Bareun' }]);
    // 소프트 마크업(**)에 걸친 제안은 원문 범위로 넓혀 유지한다.
    expect(markdown.slice(match.from, match.to)).toBe('강조**는');
  });

  it('drops suggestions that span removed code or URLs', () => {
    const markdown = 'run `npm i` now';
    const extracted = extractProse(markdown);
    expect(extracted.prose).toBe('run  now');
    expect(toSourceMatches(extracted, [{ from: 3, to: 5, message: '', replacements: [' '], source: 'LanguageTool' }])).toEqual([]);
    const [kept] = toSourceMatches(extracted, [{ from: 5, to: 8, message: '', replacements: ['later'], source: 'LanguageTool' }]);
    expect(markdown.slice(kept.from, kept.to)).toBe('now');
  });

  it('keeps frontmatter, wiki targets and callout markers out of the prose', () => {
    expect(extractProse('---\ntags: [a]\n---\n> [!note] 메모\n[[폴더/노트|별칭]]').prose).toBe('\n\n\n 메모\n별칭');
  });

  it('parses LanguageTool matches and skips Korean sentences', () => {
    const prose = 'He go home. 안녕 teh';
    const matches = parseLanguageTool(prose, { matches: [
      { offset: 3, length: 2, message: 'Verb agreement', replacements: [{ value: 'goes' }], sentence: 'He go home.' },
      { offset: 12, length: 2, message: 'Spelling', replacements: [], sentence: '안녕 teh' },
    ] });
    expect(matches).toEqual([{ from: 3, to: 5, message: 'Verb agreement', replacements: ['goes'], source: 'LanguageTool' }]);
  });

  it('parses Bareun revisions with help comments', () => {
    const matches = parseBareun({
      revisedBlocks: [
        { origin: { content: '할수', beginOffset: 0, length: 2 }, revised: '할 수', revisions: [{ revised: '할 수', category: 'SPACING', helpId: 'h1' }] },
        { origin: { content: '있다', beginOffset: 3, length: 2 }, revised: '있다', revisions: [{ revised: '있다' }] },
      ],
      helps: { h1: { comment: '<IN>의존 명사</IN>는 띄어 씁니다.' } },
    });
    expect(matches).toEqual([{ from: 0, to: 2, message: '띄어쓰기: 의존 명사는 띄어 씁니다.', replacements: ['할 수'], source: 'Bareun' }]);
  });

  it('reports missing engines as warnings instead of failing', async () => {
    const result = await checkMarkdown('할수 있다 and teh end', {});
    expect(result.matches).toEqual([]);
    expect(result.warnings).toHaveLength(2);
  });
});
