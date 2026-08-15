import Dexie, { type EntityTable, type Table } from 'dexie';

export interface CachedNote {
  vault: string;
  path: string;
  modifiedAt: number;
  content: string;
}

export interface Setting {
  key: string;
  value: unknown;
}

class WebObsidianDatabase extends Dexie {
  notes!: Table<CachedNote, [string, string]>;
  settings!: EntityTable<Setting, 'key'>;

  constructor() {
    super('web-obsidian');
    this.version(1).stores({
      notes: '[vault+path], vault, modifiedAt',
      settings: 'key',
    });
  }
}

export const db = new WebObsidianDatabase();
