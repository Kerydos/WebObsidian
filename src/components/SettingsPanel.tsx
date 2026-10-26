import { useEffect, useId, useState, type ReactNode } from 'react';
import { Send, SpellCheck, Palette, RotateCcw, X } from 'lucide-react';
import { AppearanceSettingsSection } from './AppearanceSettings';
import { defaultAppearance, type AppearanceSettings } from '../lib/settings/appearance';

export type SettingsTab = 'appearance' | 'blog' | 'spellcheck';

interface SettingsPanelProps {
  appearance: AppearanceSettings;
  onAppearanceChange: (settings: AppearanceSettings) => void;
  initialTab?: SettingsTab;
  onClose: () => void;
}

// 화면 설정, 블로그 발행 키, 맞춤법(바른) 키를 탭으로 나눈 설정 창.
export function SettingsPanel({
  appearance,
  onAppearanceChange,
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
          <button type="button" role="tab" id="settings-tab-blog" aria-selected={tab === 'blog'} className="settings-tab" onClick={() => setTab('blog')}><Send size={15} /> 블로그</button>
          <button type="button" role="tab" id="settings-tab-spellcheck" aria-selected={tab === 'spellcheck'} className="settings-tab" onClick={() => setTab('spellcheck')}><SpellCheck size={15} /> 맞춤법</button>
        </div>

        <div className="settings-content" role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
          {tab === 'appearance'
            ? <AppearanceSettingsSection settings={appearance} onChange={onAppearanceChange} />
            : tab === 'blog'
              ? <ApiKeySection key="blog" endpoint="/api/blog/settings" legend={<><Send size={16} /> blog.kerydos.com</>} help="블로그 서버의 PUBLISH_TOKEN을 입력하세요." />
              : <ApiKeySection key="spellcheck" endpoint="/api/spellcheck/settings" legend={<><SpellCheck size={16} /> 바른(Bareun) 한국어 맞춤법</>} help={<>bareun.ai에서 가입하면 내 정보에서 API 키(koba-…)를 볼 수 있습니다. 영어는 키 없이 서버의 LanguageTool로 검사합니다.</>} />}
        </div>

        <footer className="settings-footer">
          {tab === 'appearance' ? (
            <button type="button" onClick={() => onAppearanceChange(defaultAppearance)}><RotateCcw size={15} /> 기본값 복원</button>
          ) : (
            <span className="settings-footer-note">API 키는 서버에 저장됩니다.</span>
          )}
          <button type="button" className="settings-done" onClick={onClose}>완료</button>
        </footer>
      </section>
    </div>
  );
}

function ApiKeySection({ endpoint, legend, help }: { endpoint: string; legend: ReactNode; help: ReactNode }) {
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { void fetch(endpoint).then((response) => response.json()).then((body: { hasApiKey: boolean }) => setHasKey(body.hasApiKey)).catch(() => setMessage('설정을 불러오지 못했습니다.')); }, [endpoint]);
  const save = async (apiKey: string | null) => {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey }) });
      const body = await response.json() as { hasApiKey?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error ?? '저장하지 못했습니다.');
      setHasKey(body.hasApiKey === true);
      setKey('');
      setMessage('저장했습니다.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '저장하지 못했습니다.'); }
    finally { setBusy(false); }
  };
  return <fieldset className="settings-section"><legend>{legend}</legend>
    <p className="settings-help">{help} {hasKey ? '키가 설정되어 있습니다.' : '키가 설정되지 않았습니다.'}</p>
    <label className="model-row"><span>발행 API 키</span><input className="settings-input" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder={hasKey ? '새 키로 교체' : 'API 키 입력'} /></label>
    <button type="button" className="fetch-button" disabled={busy || !key.trim()} onClick={() => void save(key)}>저장</button>
    {hasKey ? <button type="button" className="key-remove" disabled={busy} onClick={() => void save(null)}>저장된 키 삭제</button> : null}
    {message ? <p className="model-status" role="status">{message}</p> : null}
  </fieldset>;
}
