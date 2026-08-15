import MiniSearch from 'minisearch';
import type { NoteIndex } from '../markdown/indexer';

export interface SearchDocument extends NoteIndex {
  content: string;
}

function tokenize(value: string): string[] {
  const words = value.toLocaleLowerCase().match(/[\p{L}\p{N}_/-]+/gu) ?? [];
  const tokens = [...words];
  for (const word of words) {
    if (/^[가-힣]{3,}$/.test(word)) {
      for (let index = 0; index < word.length - 1; index += 1) tokens.push(word.slice(index, index + 2));
    }
  }
  return tokens;
}

export class VaultSearchIndex {
  private readonly index = new MiniSearch<SearchDocument>({
    idField: 'path',
    fields: ['title', 'content', 'tags'],
    storeFields: ['path', 'title', 'tags'],
    tokenize,
    searchOptions: { prefix: true, fuzzy: 0.15, boost: { title: 3, tags: 2 } },
  });

  replaceAll(documents: SearchDocument[]) {
    this.index.removeAll();
    this.index.addAll(documents);
  }

  search(query: string) {
    if (!query.trim()) return [];
    return this.index.search(query).map((result) => ({
      path: String(result.path),
      title: String(result.title),
    }));
  }
}
