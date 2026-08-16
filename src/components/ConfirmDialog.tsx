import { useEffect, useId, useRef } from 'react';
import { TriangleAlert } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmButtonRef.current?.focus();
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
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="confirm-heading">
          {danger ? <TriangleAlert size={18} className="confirm-icon" /> : null}
          <h2 id={titleId}>{title}</h2>
        </header>
        <p className="confirm-message">{message}</p>
        <footer className="confirm-actions">
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
          <button
            type="button"
            ref={confirmButtonRef}
            className={danger ? 'confirm-danger' : 'confirm-primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
