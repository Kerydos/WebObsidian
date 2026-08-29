import { useCallback, useEffect, useRef, useState } from 'react';
import { checkGrammar } from '../lib/ai/ollamaCloud';
import { messageOf } from '../lib/message';
import type { GrammarCheckResult } from '../components/GrammarCheckPanel';
import { applyGrammarIssues, hasApplicableFix } from '../components/grammarMark';

const GRAMMAR_CHECK_STORAGE_KEY = 'webobsidian:grammarcheck:v1';

interface UseGrammarCheckerOptions {
  model: string;
  configured: boolean;
  activePath?: string;
  getEditorValue: () => string;
  setEditorValue: (value: string) => void;
}

// Enter로 문장을 마칠 때마다 엔터 직전 줄(그 문장)만 서버의 Ollama Cloud 모델로 검사한다.
// 새 문장이 들어오면 진행 중이던 검사를 취소하고, 이전에 표시하던 결과도 즉시 지운 뒤
// 최신 요청의 결과만 다시 표시한다.
export function useGrammarChecker({ model, configured, activePath, getEditorValue, setEditorValue }: UseGrammarCheckerOptions) {
  const [enabled, setEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(GRAMMAR_CHECK_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [result, setResult] = useState<GrammarCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController | null>(null);
  const lastTextRef = useRef('');
  const resultIdRef = useRef(0);

  useEffect(() => {
    try {
      window.localStorage.setItem(GRAMMAR_CHECK_STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      // The setting still applies for this session when browser storage is unavailable.
    }
  }, [enabled]);

  // 노트를 전환하면 이전 노트에 대한 검사 결과와 중복 방지 기록을 비운다.
  // 본문과 무관한 별도 상태의 정리이므로 effect에서 즉시 초기화하는 것이 의도다.
  useEffect(() => {
    abortRef.current?.abort();
    lastTextRef.current = '';
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResult(null);
    setChecking(false);
    setError(undefined);
  }, [activePath]);

  const checkSentence = useCallback((sentence: string) => {
    if (!enabled || !configured) return;
    if (sentence === lastTextRef.current) return;
    lastTextRef.current = sentence;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(undefined);
    setResult(null);
    setChecking(true);
    void checkGrammar({ model, text: sentence, signal: controller.signal })
      .then((issues) => {
        if (controller.signal.aborted) return;
        resultIdRef.current += 1;
        setResult({ id: resultIdRef.current, sentence, issues });
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(messageOf(cause));
      })
      .finally(() => {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setChecking(false);
        }
      });
  }, [enabled, configured, model]);

  // 검사 결과의 수정 제안을 본문(에디터 내용)에 반영한다. 저장은 기존 자동 저장 흐름을 따른다.
  const apply = useCallback(() => {
    const current = result;
    if (!current || current.applied) return;
    if (!hasApplicableFix(current.issues)) {
      setError('적용할 수정이 없습니다.');
      return;
    }
    const before = getEditorValue();
    const after = applyGrammarIssues(before, current.sentence, current.issues);
    if (after === before) {
      setError('본문에서 해당 문장을 찾을 수 없어 적용하지 못했습니다.');
      return;
    }
    setError(undefined);
    setEditorValue(after);
    setResult({ ...current, applied: true });
  }, [result, getEditorValue, setEditorValue]);

  return { enabled, setEnabled, result, checking, error, checkSentence, apply };
}

export type GrammarChecker = ReturnType<typeof useGrammarChecker>;
