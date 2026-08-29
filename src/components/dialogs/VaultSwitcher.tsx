import { useEffect, useId } from 'react';
import { Check, Cloud, FolderOpen, HardDrive } from 'lucide-react';
import type { VaultKind } from '../../types/vault';

interface VaultSwitcherProps {
  currentKind: VaultKind;
  currentName: string;
  localSupported: boolean;
  onSelectServer: () => void;
  onSelectLocal: () => void;
  onSelectOpfs: () => void;
  onClose: () => void;
}

// 상단 바의 볼트 pill을 누르면 열리는 저장소 전환 모달. 서버 / 로컬 폴더 / 브라우저(OPFS)
// 세 가지 저장소 중 하나로 전환한다. 전환 동작 자체는 App이 저장소 어댑터를 만들어 수행한다.
export function VaultSwitcher({ currentKind, currentName, localSupported, onSelectServer, onSelectLocal, onSelectOpfs, onClose }: VaultSwitcherProps) {
  const titleId = useId();

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const options: Array<{
    kind: VaultKind;
    icon: typeof HardDrive;
    label: string;
    description: string;
    disabled: boolean;
    onSelect: () => void;
  }> = [
    {
      kind: 'server',
      icon: Cloud,
      label: 'Server Vault',
      description: '서버 폴더에 Markdown 파일로 저장합니다. 모든 기기에서 동기화됩니다.',
      disabled: false,
      onSelect: onSelectServer,
    },
    {
      kind: 'local',
      icon: FolderOpen,
      label: '로컬 폴더',
      description: localSupported
        ? 'Chromium 브라우저로 컴퓨터의 Markdown 폴더를 직접 엽니다.'
        : '이 브라우저는 폴더 열기를 지원하지 않습니다.',
      disabled: !localSupported,
      onSelect: onSelectLocal,
    },
    {
      kind: 'opfs',
      icon: HardDrive,
      label: 'Browser Vault',
      description: '브라우저 내부 저장소(OPFS)에 저장합니다. 서버 없이 이 브라우저에만 유지됩니다.',
      disabled: false,
      onSelect: onSelectOpfs,
    },
  ];

  return (
    <div className="settings-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="confirm-heading">
          <h2 id={titleId}>볼트 저장소 전환</h2>
        </header>
        <div className="vault-option-list">
          <p className="muted vault-current">현재: {currentName}</p>
          {options.map((option) => {
            const active = option.kind === currentKind;
            const Icon = option.icon;
            return (
              <button
                key={option.kind}
                type="button"
                className={active ? 'vault-option active' : 'vault-option'}
                disabled={option.disabled || active}
                onClick={option.onSelect}
              >
                <Icon size={17} />
                <span className="vault-option-text">
                  <strong>
                    {option.label}
                    {active ? <span className="vault-option-badge"><Check size={11} /> 사용 중</span> : null}
                  </strong>
                  <small>{option.description}</small>
                </span>
              </button>
            );
          })}
        </div>
        <footer className="confirm-actions">
          <button type="button" className="confirm-cancel" onClick={onClose}>닫기</button>
        </footer>
      </section>
    </div>
  );
}
