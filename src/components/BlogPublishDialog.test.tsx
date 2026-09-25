import { describe, expect, it } from 'vitest';
import { folderPublishItems } from './BlogPublishDialog';

describe('folder publishing', () => {
  it('preserves descendant folders under the chosen blog folder', () => {
    expect(folderPublishItems('기록', '에세이', [
      { path: '기록/첫 글.md', content: '# first' },
      { path: '기록/하위/둘째.md', content: '# second' },
    ])).toEqual([
      { folder: '에세이', title: '첫 글', content: '# first' },
      { folder: '에세이/하위', title: '둘째', content: '# second' },
    ]);
  });
});
