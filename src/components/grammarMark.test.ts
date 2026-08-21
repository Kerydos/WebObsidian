import { describe, expect, it } from 'vitest';
import type { GrammarIssue } from '../lib/ai/ollamaCloud';
import { applyGrammarIssues, hasApplicableFix, markGrammarIssues } from './grammarMark';

function issue(original: string, suggestion: string): GrammarIssue {
  return { original, suggestion, reason: '' };
}

describe('markGrammarIssues', () => {
  it('splits the sentence into plain and issue segments around matched originals', () => {
    const segments = markGrammarIssues('아침에밥을 먹었다', [issue('아침에밥을', '아침에 밥을')]);
    expect(segments).toEqual([
      { text: '아침에밥을', issue: issue('아침에밥을', '아침에 밥을') },
      { text: ' 먹었다' },
    ]);
  });

  it('orders multiple issues by their position in the sentence', () => {
    const issues = [issue('먹었다', '먹었다.'), issue('아침에밥을', '아침에 밥을')];
    const segments = markGrammarIssues('아침에밥을 먹었다', issues);
    expect(segments.map((segment) => segment.text)).toEqual(['아침에밥을', ' ', '먹었다']);
    expect(segments[0].issue?.suggestion).toBe('아침에 밥을');
    expect(segments[2].issue?.suggestion).toBe('먹었다.');
  });

  it('keeps text not present in the sentence unmarked', () => {
    expect(markGrammarIssues('문제 없는 문장', [issue('없는 오류', '수정')])).toEqual([{ text: '문제 없는 문장' }]);
  });

  it('prefers the longer original at the same start and skips overlapping matches', () => {
    const issues = [issue('밥을', '쌀을'), issue('아침에밥을 먹', '아침에 밥을 먹')];
    const segments = markGrammarIssues('아침에밥을 먹었다', issues);
    expect(segments).toEqual([
      { text: '아침에밥을 먹', issue: issue('아침에밥을 먹', '아침에 밥을 먹') },
      { text: '었다' },
    ]);
  });
});

describe('hasApplicableFix', () => {
  it('is false without a usable suggestion', () => {
    expect(hasApplicableFix([])).toBe(false);
    expect(hasApplicableFix([issue('원본', '')])).toBe(false);
    expect(hasApplicableFix([issue('원본', '원본')])).toBe(false);
  });

  it('is true when at least one issue differs from its original', () => {
    expect(hasApplicableFix([issue('원본', ''), issue('원본', '수정')])).toBe(true);
  });
});

describe('applyGrammarIssues', () => {
  it('replaces originals with suggestions on the matching line only', () => {
    // lineTextAt은 목록 접두사를 포함한 줄 원문을 그대로 문장으로 돌려준다.
    const text = '# 제목\n\n- 아침에밥을 먹었다\n다음 줄';
    const result = applyGrammarIssues(text, '- 아침에밥을 먹었다', [issue('아침에밥을', '아침에 밥을')]);
    expect(result).toBe('# 제목\n\n- 아침에 밥을 먹었다\n다음 줄');
  });

  it('targets the last line when the sentence appears more than once', () => {
    const text = '같은 문장이다\n앞 줄\n같은 문장이다';
    const result = applyGrammarIssues(text, '같은 문장이다', [issue('문장이다', '문장이다.')]);
    expect(result).toBe('같은 문장이다\n앞 줄\n같은 문장이다.');
  });

  it('applies every issue on the line at once without double replacement', () => {
    const result = applyGrammarIssues('그렇게했다고 한다', '그렇게했다고 한다', [
      issue('그렇게했다고', '그렇게 했다고'),
      issue('했다고', '했다고!'),
    ]);
    expect(result).toBe('그렇게 했다고 한다');
  });

  it('returns the text unchanged when the sentence is not found as a line', () => {
    const text = '이미 수정된 본문';
    expect(applyGrammarIssues(text, '없는 문장', [issue('문장', '문장!')])).toBe(text);
  });

  it('returns the text unchanged when no issue has a usable suggestion', () => {
    const text = '그대로인 문장';
    expect(applyGrammarIssues(text, '그대로인 문장', [issue('그대로인', '그대로인')])).toBe(text);
  });
});
