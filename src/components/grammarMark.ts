import type { GrammarIssue } from '../lib/ai/ollamaCloud';

// 검사 결과 문장을 오류 원문 위치 기준으로 나눈 조각. issue가 있으면 해당 조각이 수정 대상이다.
export interface GrammarSegment {
  text: string;
  issue?: GrammarIssue;
}

interface GrammarMatch {
  start: number;
  end: number;
  issue: GrammarIssue;
}

// 문장 안에서 오류 원문 위치를 찾는다. 같은 시작점에서는 더 긴 원문을 우선하고,
// 앞선 오류와 겹치는 원문은 모델의 중복 응답으로 보고 건너뛴다.
function collectMatches(text: string, issues: GrammarIssue[]): GrammarMatch[] {
  const matches: GrammarMatch[] = [];
  for (const issue of issues) {
    if (!issue.original) continue;
    const start = text.indexOf(issue.original);
    if (start === -1) continue;
    matches.push({ start, end: start + issue.original.length, issue });
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const accepted: GrammarMatch[] = [];
  let lastEnd = -1;
  for (const match of matches) {
    if (match.start < lastEnd) continue;
    accepted.push(match);
    lastEnd = match.end;
  }
  return accepted;
}

// 문장을 일반 텍스트 조각과 수정 대상 조각으로 나눠 패널이 하이라이트로 그릴 수 있게 한다.
export function markGrammarIssues(sentence: string, issues: GrammarIssue[]): GrammarSegment[] {
  const segments: GrammarSegment[] = [];
  let cursor = 0;
  for (const match of collectMatches(sentence, issues)) {
    if (match.start > cursor) segments.push({ text: sentence.slice(cursor, match.start) });
    segments.push({ text: sentence.slice(match.start, match.end), issue: match.issue });
    cursor = match.end;
  }
  if (cursor < sentence.length) segments.push({ text: sentence.slice(cursor) });
  return segments;
}

// 제안이 비어 있거나 원문과 같은 항목은 적용해도 본문이 변하지 않으므로 적용 대상에서 제외한다.
export function hasApplicableFix(issues: GrammarIssue[]): boolean {
  return issues.some((issue) => issue.original && issue.suggestion && issue.suggestion !== issue.original);
}

// 본문에서 검사했던 문장 줄(trimspace 기준 일치, 여러 줄이면 마지막 줄)을 찾아 오류 원문을
// 제안 표현으로 바꾼 전체 텍스트를 반환한다. 문장이 이미 편집돼 찾지 못하면 원문을 그대로 돌려준다.
export function applyGrammarIssues(text: string, sentence: string, issues: GrammarIssue[]): string {
  if (!hasApplicableFix(issues)) return text;
  const lines = text.split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim() !== sentence) continue;
    lines[index] = markGrammarIssues(lines[index], issues)
      .map((segment) => (segment.issue?.suggestion ? segment.issue.suggestion : segment.text))
      .join('');
    return lines.join('\n');
  }
  return text;
}
