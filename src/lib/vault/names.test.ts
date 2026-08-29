import { describe, expect, it } from 'vitest';
import { dailyNoteBaseName, uniqueBaseName } from './names';

describe('uniqueBaseName', () => {
  it('returns the base name when it is not taken', () => {
    expect(uniqueBaseName(new Set(['다른노트.md']), '0901_기록', '.md')).toBe('0901_기록');
  });

  it('appends increasing numbers until the name is free', () => {
    const taken = new Set(['0901_기록.md', '0901_기록 2.md']);
    expect(uniqueBaseName(taken, '0901_기록', '.md')).toBe('0901_기록 3');
  });

  it('works without a suffix', () => {
    expect(uniqueBaseName(new Set(['새폴더']), '새폴더', '')).toBe('새폴더 2');
  });
});

describe('dailyNoteBaseName', () => {
  it('pads month and day to two digits', () => {
    expect(dailyNoteBaseName(new Date(2026, 8, 5))).toBe('0905_기록');
  });
});
