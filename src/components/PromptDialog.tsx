import { useEffect, useId, useRef, useState } from 'react';

interface PromptDialogProps {
  title: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  // 입력값이 쓸 수 없으면 이유를 돌려준다(입력란 아래에 표시하고 확인을 막음).
  validate?: (value: string) => string | undefined;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

// 한 줄 입력 모달. Enter로 확인, Esc나 바깥 클릭으로 취소한다.
export function PromptDialog({ title, initialValue = '', placeholder, confirmLabel = '확인', validate, onConfirm, onCancel }: PromptDialogProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();
  const error = trimmed ? validate?.(trimmed) : undefined;

  useEffect(() => {
    inputRef.current?.select();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);

  return (
    <div className="settings-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <form className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={(event) => {
        event.preventDefault();
        if (trimmed && !error) onConfirm(trimmed);
      }}>
        <header className="confirm-heading">
          <h2 id={titleId}>{title}</h2>
        </header>
        <input
          ref={inputRef}
          className="settings-input"
          value={value}
          placeholder={placeholder}
          aria-labelledby={titleId}
          aria-invalid={Boolean(error)}
          onChange={(event) => setValue(event.target.value)}
        />
        {error ? <p className="prompt-error" role="alert">{error}</p> : null}
        <footer className="confirm-actions">
          <button type="button" onClick={onCancel}>취소</button>
          <button type="submit" className="confirm-primary" disabled={!trimmed || Boolean(error)}>{confirmLabel}</button>
        </footer>
      </form>
    </div>
  );
}
