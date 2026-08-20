import { useEffect, useId, useState } from 'react';
import { Cloud, Palette, RotateCcw, X } from 'lucide-react';
import { AppearanceSettingsSection } from './AppearanceSettings';
import { OllamaSettingsSection } from './OllamaSettings';
import { defaultAppearance, type AppearanceSettings } from '../lib/settings/appearance';
import type { OllamaServerSettings } from '../lib/ai/ollamaCloud';

export type SettingsTab = 'appearance' | 'ollama';

interface SettingsPanelProps {
  appearance: AppearanceSettings;
  onAppearanceChange: (settings: AppearanceSettings) => void;
  ollama: OllamaServerSettings;
  onOllamaUpdated: (settings: OllamaServerSettings) => void;
  initialTab?: SettingsTab;
  onClose: () => void;
}

// 화면 설정과 Ollama Cloud 설정을 탭으로 나눈 설정 창.
export function SettingsPanel({
  appearance,
  onAppearanceChange,
  ollama,
  onOllamaUpdated,
  initialTab = 'appearance',
  onClose,
}: SettingsPanelProps) {
  const titleId = useId();
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="settings-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="settings-heading">
          <div>
            <span>SETTINGS</span>
            <h2 id={titleId}>설정</h2>
          </div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="설정 닫기"><X size={19} /></button>
        </header>

        <div className="settings-tabs" role="tablist" aria-label="설정 항목">
          <button
            type="button"
            role="tab"
            id="settings-tab-appearance"
            aria-selected={tab === 'appearance'}
            className="settings-tab"
            onClick={() => setTab('appearance')}
          >
            <Palette size={15} /> 화면
          </button>
          <button
            type="button"
            role="tab"
            id="settings-tab-ollama"
            aria-selected={tab === 'ollama'}
            className="settings-tab"
            onClick={() => setTab('ollama')}
          >
            <Cloud size={15} /> Ollama Cloud
          </button>
        </div>

        <div className="settings-content" role="tabpanel" aria-labelledby={tab === 'appearance' ? 'settings-tab-appearance' : 'settings-tab-ollama'}>
          {tab === 'appearance'
            ? <AppearanceSettingsSection settings={appearance} onChange={onAppearanceChange} />
            : <OllamaSettingsSection settings={ollama} onUpdated={onOllamaUpdated} />}
        </div>

        <footer className="settings-footer">
          {tab === 'appearance' ? (
            <button type="button" onClick={() => onAppearanceChange(defaultAppearance)}><RotateCcw size={15} /> 기본값 복원</button>
          ) : (
            <span className="settings-footer-note">API 키와 모델은 서버에 저장됩니다.</span>
          )}
          <button type="button" className="settings-done" onClick={onClose}>완료</button>
        </footer>
      </section>
    </div>
  );
}
