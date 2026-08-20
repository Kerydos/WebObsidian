import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { paragraphEndingAt } from './paragraphCommit';

describe('paragraphEndingAt', () => {
  it('returns just the current line when it is the first line of the document', () => {
    const doc = Text.of(['첫 문장입니다']);
    expect(paragraphEndingAt(doc, 1)).toBe('첫 문장입니다');
  });

  it('collects contiguous non-blank lines above the given line into one paragraph', () => {
    const doc = Text.of(['이전 문단', '', '이 문단의 첫 줄', '이 문단의 둘째 줄']);
    expect(paragraphEndingAt(doc, 4)).toBe('이 문단의 첫 줄\n이 문단의 둘째 줄');
  });

  it('still resolves to the paragraph above when the target line itself is blank', () => {
    // Enter를 두 번 눌러 빈 줄을 만든 경우에도 같은 문단 텍스트를 반환한다(호출부에서 중복 검사를 걸러낸다).
    const doc = Text.of(['이전 문단 내용', '']);
    expect(paragraphEndingAt(doc, 2)).toBe('이전 문단 내용');
  });
});
