import { forEachDiagnostic, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { request } from './vault/server';

export interface SpellcheckMatch {
  from: number;
  to: number;
  message: string;
  replacements: string[];
  source: 'Bareun' | 'LanguageTool';
}

export function checkSpelling(text: string) {
  return request<{ matches: SpellcheckMatch[]; warnings: string[] }>('/api/spellcheck', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

// 검사 결과를 CodeMirror 진단으로 바꾼다. 밑줄 위 툴팁의 버튼을 누르면 제안으로 바뀌고 그 밑줄은 사라진다.
export function toDiagnostics(matches: SpellcheckMatch[]): Diagnostic[] {
  return matches.map((match) => {
    const diagnostic: Diagnostic = {
      from: match.from,
      to: match.to,
      severity: 'warning',
      source: match.source === 'Bareun' ? '바른' : 'LanguageTool',
      message: match.message,
      actions: match.replacements.slice(0, 4).map((replacement) => ({
        name: replacement || '(삭제)',
        apply: (view, from, to) => {
          view.dispatch({ changes: { from, to, insert: replacement } });
          const rest: Diagnostic[] = [];
          forEachDiagnostic(view.state, (item, itemFrom, itemTo) => {
            if (item !== diagnostic) rest.push({ ...item, from: itemFrom, to: itemTo });
          });
          view.dispatch(setDiagnostics(view.state, rest));
        },
      })),
    };
    return diagnostic;
  });
}
