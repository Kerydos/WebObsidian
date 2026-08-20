import { CircleAlert, LoaderCircle, SpellCheck2 } from 'lucide-react';
import type { GrammarIssue } from '../lib/ai/ollamaCloud';

export interface GrammarCheckResult {
  id: number;
  sentence: string;
  issues: GrammarIssue[];
}

interface GrammarCheckPanelProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  configured: boolean;
  checking: boolean;
  error?: string;
  result: GrammarCheckResult | null;
}

function excerpt(text: string, max = 90) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

// Enter로 문장을 마칠 때마다(엔터 직전 줄만) 서버에 저장된 Ollama Cloud 모델로 띄어쓰기·문법을
// 검사해 결과를 보여 주는 우측 패널 섹션. 결과는 항상 최신 한 건만 표시하고 이전 표시는 지운다.
export function GrammarCheckPanel({ enabled, onToggle, configured, checking, error, result }: GrammarCheckPanelProps) {
  return (
    <section className="grammar-panel">
      <h2>
        <span className="grammar-panel-title"><SpellCheck2 size={14} /> 맞춤법 검사</span>
        <button
          type="button"
          className={enabled ? 'grammar-toggle on' : 'grammar-toggle'}
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? '맞춤법 검사 끄기' : '맞춤법 검사 켜기'}
          onClick={() => onToggle(!enabled)}
        >
          <span className="grammar-toggle-knob" />
        </button>
      </h2>

      {!enabled ? (
        <p className="muted">꺼져 있습니다. 켜면 Enter로 문장을 마칠 때마다 직전 문장을 검사합니다.</p>
      ) : !configured ? (
        <p className="muted">설정에서 Ollama Cloud API 키와 모델을 먼저 저장해 주세요.</p>
      ) : (
        <div className="grammar-results">
          {checking ? (
            <p className="grammar-status"><LoaderCircle className="spin" size={13} /> 검사 중…</p>
          ) : null}
          {error ? <p className="grammar-status error"><CircleAlert size={13} /> {error}</p> : null}
          {!result && !checking && !error ? (
            <p className="muted">문장을 쓰고 Enter를 누르면 검사 결과가 여기에 표시됩니다.</p>
          ) : null}
          {result && !checking ? (
            <article key={result.id} className="grammar-result" data-clean={result.issues.length === 0}>
              <p className="grammar-paragraph">{excerpt(result.sentence)}</p>
              {result.issues.length === 0 ? (
                <p className="grammar-clean">문제 없음</p>
              ) : (
                <ul className="grammar-issue-list">
                  {result.issues.map((issue, index) => (
                    <li key={index}>
                      <span className="grammar-issue-diff">
                        <span className="grammar-issue-original">{issue.original}</span>
                        {issue.suggestion ? <><span aria-hidden="true"> → </span><span className="grammar-issue-suggestion">{issue.suggestion}</span></> : null}
                      </span>
                      {issue.reason ? <span className="grammar-issue-reason">{issue.reason}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ) : null}
        </div>
      )}
    </section>
  );
}
