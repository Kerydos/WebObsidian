import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { lineTextAt } from './sentenceCommit';

describe('lineTextAt', () => {
  it('returns the trimmed text of the line containing the given offset', () => {
    const doc = Text.of(['첫 문장입니다']);
    expect(lineTextAt(doc, doc.line(1).to)).toBe('첫 문장입니다');
  });

  it('only returns the line the cursor was on, not earlier paragraph lines', () => {
    const doc = Text.of(['이전 문단', '', '이 줄만 확인한다', '다음 줄']);
    expect(lineTextAt(doc, doc.line(3).to)).toBe('이 줄만 확인한다');
  });

  it('returns an empty string for a blank line', () => {
    const doc = Text.of(['문장', '']);
    expect(lineTextAt(doc, doc.line(2).to)).toBe('');
  });
});
