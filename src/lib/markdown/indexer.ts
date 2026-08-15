export interface WikiLink {
  target: string;
  alias?: string;
  subpath?: string;
  embed: boolean;
  line: number;
}

export interface NoteIndex {
  path: string;
  title: string;
  tags: string[];
  links: WikiLink[];
}

const WIKI_LINK = /(!?)\[\[([^\[\]|#]+)(?:#([^\[\]|]+))?(?:\|([^\[\]]+))?\]\]/g;
const TAG = /(^|\s)(#[\p{L}\p{N}_/-]+)/gu;

function withoutInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, '');
}

export function indexMarkdown(path: string, markdown: string): NoteIndex {
  const links: WikiLink[] = [];
  const tags = new Set<string>();
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let title = path.split('/').at(-1)?.replace(/\.md$/i, '') ?? path;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (title === path.split('/').at(-1)?.replace(/\.md$/i, '') && /^#\s+/.test(rawLine)) {
      title = rawLine.replace(/^#\s+/, '').trim();
    }
    const line = withoutInlineCode(rawLine);
    WIKI_LINK.lastIndex = 0;
    for (const match of line.matchAll(WIKI_LINK)) {
      links.push({
        target: match[2].trim(),
        subpath: match[3]?.trim(),
        alias: match[4]?.trim(),
        embed: match[1] === '!',
        line: index + 1,
      });
    }
    TAG.lastIndex = 0;
    for (const match of line.matchAll(TAG)) tags.add(match[2]);
  }

  return { path, title, tags: [...tags], links };
}

export function noteKey(value: string): string {
  return value.replace(/\.md$/i, '').toLocaleLowerCase();
}

export function resolveLink(target: string, paths: string[]): string | undefined {
  const key = noteKey(target);
  const exact = paths.find((path) => noteKey(path) === key);
  if (exact) return exact;
  const matches = paths.filter((path) => noteKey(path.split('/').at(-1) ?? path) === key);
  return matches.length === 1 ? matches[0] : undefined;
}

export function backlinksFor(targetPath: string, notes: NoteIndex[]): NoteIndex[] {
  const paths = notes.map((note) => note.path);
  return notes.filter((note) =>
    note.links.some((link) => resolveLink(link.target, paths) === targetPath),
  );
}
