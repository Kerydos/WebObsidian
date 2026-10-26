// 맞춤법·문법·띄어쓰기 검사: 영어는 자체 호스팅 LanguageTool, 한국어는 바른(Bareun) API.
// 마크다운에서 산문만 뽑아(prose) 두 엔진에 동시에 보내고, 결과 위치를 원문 좌표로 되돌린다.

export class SpellcheckError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const HANGUL = /[가-힣ㄱ-ㆎ]/;
const LATIN_WORD = /[A-Za-z]{2,}/;
const SOFT = 1; // 마크업 기호: 지우고 검사하지만, 걸친 제안은 그대로 둔다.
const HARD = 2; // 코드·URL·HTML 등: 지우고, 걸친 제안은 버린다(단어가 붙어 생긴 가짜 오류).

const HARD_PATTERNS = [
  /^---\n[\s\S]*?\n---[ \t]*(?=\n|$)/g, // 프론트매터(문서 맨 앞만)
  /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm, // fenced 코드
  /`+[^`\n]+?`+/g, // 인라인 코드
  /!\[\[[^\]\n]*\]\]|!\[[^\]\n]*\]\([^)\n]*\)/g, // 임베드·이미지
  /\]\([^)\n]*\)/g, // 링크의 (url) 부분
  /<[^>\n]+>|https?:\/\/[^\s)>\]]+/g, // HTML 태그, URL
  /\[![\w-]+\][+-]?/g, // 콜아웃 표식
  /\[\[[^\]|\n]*\|/g, // 별칭 있는 위키 링크의 대상 부분
  /^[ \t|:-]*-{3,}[ \t|:-]*$/gm, // 표 구분선, 수평선
  /\|/g, // 표 셀 경계
];
const SOFT_PATTERNS = [
  /^[ \t]*(?:(?:>[ \t]?)|(?:[-*+][ \t]+(?:\[[ xX]\][ \t]+)?)|(?:\d+[.)][ \t]+)|(?:#{1,6}[ \t]+))+/gm, // 줄 앞 표식
  /\*{1,3}|~~|==|(?<![A-Za-z0-9])_{1,3}|_{1,3}(?![A-Za-z0-9])/g, // 강조
  /\[\[|\]\]|\[|\]/g, // 링크 괄호
];

// 검사할 산문과, 산문 각 글자의 원문 위치·원문 글자별 제거 종류를 돌려준다.
export function extractProse(markdown) {
  const kinds = new Uint8Array(markdown.length);
  const mark = (patterns, kind) => {
    for (const pattern of patterns) {
      for (const match of markdown.matchAll(pattern)) {
        for (let index = match.index; index < match.index + match[0].length; index += 1) kinds[index] = Math.max(kinds[index], kind);
      }
    }
  };
  mark(HARD_PATTERNS, HARD);
  mark(SOFT_PATTERNS, SOFT);
  let prose = '';
  const map = [];
  for (let index = 0; index < markdown.length; index += 1) {
    // 줄바꿈은 지우지 않아 문단 구분을 유지한다.
    if (kinds[index] && markdown[index] !== '\n') continue;
    prose += markdown[index];
    map.push(index);
  }
  map.push(markdown.length);
  return { prose, map, kinds };
}

// 산문 좌표의 제안을 원문 좌표로 옮긴다. 코드·URL 등에 걸친 제안은 버린다.
export function toSourceMatches(extracted, matches) {
  const { map, kinds } = extracted;
  return matches.flatMap((match) => {
    const from = map[match.from];
    const to = match.to > match.from ? map[match.to - 1] + 1 : from;
    if (from === undefined || to === undefined) return [];
    for (let index = from; index < to; index += 1) if (kinds[index] === HARD) return [];
    return [{ ...match, from, to }];
  });
}

export function parseLanguageTool(prose, body) {
  return (body.matches ?? []).flatMap((match) => {
    const from = match.offset;
    const to = match.offset + match.length;
    // en-US 검사기는 한국어를 전부 오타로 보므로 한국어가 섞인 문장은 건너뛴다.
    if (HANGUL.test(prose.slice(from, to)) || HANGUL.test(match.sentence ?? '')) return [];
    return [{
      from,
      to,
      message: match.message,
      replacements: (match.replacements ?? []).slice(0, 5).map((item) => item.value),
      source: 'LanguageTool',
    }];
  });
}

const BAREUN_CATEGORY = {
  SPACING: '띄어쓰기', TYPO: '오타', GRAMMER: '문법', STANDARD: '표준어', WORD: '어휘',
  FOREIGN_WORD: '외래어 표기', CONFUSABLE_WORDS: '혼동하기 쉬운 말', SENTENCE: '문장',
};

export function parseBareun(body) {
  return (body.revisedBlocks ?? []).flatMap((block) => {
    const origin = block.origin ?? {};
    const revisions = block.revisions ?? [];
    const replacements = [...new Set(revisions.map((revision) => revision.revised).filter((value) => value !== origin.content))];
    if (!origin.content?.trim() || !replacements.length) return [];
    const first = revisions[0] ?? {};
    const category = BAREUN_CATEGORY[first.category] ?? '맞춤법';
    // 설명에는 <IN>…</IN> 같은 강조 태그가 섞여 온다.
    const comment = body.helps?.[first.helpId]?.comment?.replace(/<\/?[A-Z]+>/g, '');
    const from = origin.beginOffset ?? 0;
    return [{ from, to: from + (origin.length ?? origin.content.length), message: comment ? `${category}: ${comment}` : category, replacements, source: 'Bareun' }];
  });
}

async function checkLanguageTool(prose, baseUrl) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v2/check`, {
    method: 'POST',
    body: new URLSearchParams({ text: prose, language: 'en-US', disabledRules: 'WHITESPACE_RULE' }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`LanguageTool 오류(${response.status})`);
  return parseLanguageTool(prose, await response.json());
}

async function checkBareun(prose, apiKey, host) {
  const response = await fetch(`${host.replace(/\/+$/, '')}/bareun.RevisionService/CorrectError`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    // UTF16 좌표는 자바스크립트 문자열 인덱스와 같다.
    body: JSON.stringify({ document: { content: prose, language: 'ko_KR' }, encodingType: 'UTF16' }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({}));
  // 바른 오류 메시지는 키 원문을 담고 있어 화면에 보내기 전에 가린다.
  if (!response.ok) throw new Error(body.message ? `바른: ${String(body.message).replaceAll(apiKey, 'API 키')}` : `바른 API 오류(${response.status})`);
  return parseBareun(body);
}

// 두 엔진은 서로 독립적으로 실패할 수 있다. 실패한 쪽은 경고로만 알린다.
export async function checkMarkdown(markdown, { languageToolUrl, bareunApiKey, bareunHost = 'https://api.bareun.ai' }) {
  if (typeof markdown !== 'string') throw new SpellcheckError('검사할 텍스트가 없습니다.');
  if (markdown.length > 200_000) throw new SpellcheckError('한 번에 검사할 수 있는 길이(20만 자)를 넘었습니다.', 413);
  const extracted = extractProse(markdown);
  const { prose } = extracted;
  const warnings = [];
  const run = async (enabled, skipReason, task) => {
    if (!enabled) {
      if (skipReason) warnings.push(skipReason);
      return [];
    }
    try { return await task(); }
    catch (error) {
      warnings.push(error?.name === 'TimeoutError' ? '검사 서버 응답이 너무 늦습니다.' : error?.message ?? String(error));
      return [];
    }
  };
  const [english, korean] = await Promise.all([
    run(LATIN_WORD.test(prose) && Boolean(languageToolUrl), LATIN_WORD.test(prose) && !languageToolUrl ? '영어 검사 서버(LanguageTool)가 설정되지 않았습니다.' : '', () => checkLanguageTool(prose, languageToolUrl)),
    run(HANGUL.test(prose) && Boolean(bareunApiKey), HANGUL.test(prose) && !bareunApiKey ? '설정 > 맞춤법에서 바른 API 키를 입력하면 한국어도 검사합니다.' : '', () => checkBareun(prose, bareunApiKey, bareunHost)),
  ]);
  const matches = toSourceMatches(extracted, [...korean, ...english]).sort((a, b) => a.from - b.from);
  return { matches, warnings };
}
