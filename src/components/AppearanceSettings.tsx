import { useEffect, useId } from 'react';
import { Palette, RotateCcw, SlidersHorizontal, Type, X } from 'lucide-react';
import {
  defaultAppearance,
  type AppearanceSettings,
  type CodeFontChoice,
  type ColorTheme,
  type DocumentStyle,
  type FontChoice,
} from '../lib/settings/appearance';

interface AppearanceSettingsProps {
  settings: AppearanceSettings;
  onChange: (settings: AppearanceSettings) => void;
  onClose: () => void;
}

const themeOptions: Array<{ value: ColorTheme; label: string; description: string }> = [
  { value: 'paper', label: '종이', description: '따뜻하고 부드러운 색감' },
  { value: 'light', label: '밝게', description: '선명한 흰색 문서' },
  { value: 'dark', label: '어둡게', description: '낮은 조도의 작업 환경' },
];

export function AppearanceSettingsPanel({ settings, onChange, onClose }: AppearanceSettingsProps) {
  const titleId = useId();
  const update = <Key extends keyof AppearanceSettings,>(key: Key, value: AppearanceSettings[Key]) => {
    onChange({ ...settings, [key]: value });
  };

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
            <span>APPEARANCE</span>
            <h2 id={titleId}>화면 설정</h2>
          </div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="설정 닫기"><X size={19} /></button>
        </header>

        <div className="settings-content">
          <fieldset className="settings-section">
            <legend><Palette size={16} /> 테마</legend>
            <div className="theme-options">
              {themeOptions.map((option) => (
                <label key={option.value} className="theme-option" data-selected={settings.theme === option.value}>
                  <input
                    type="radio"
                    name="color-theme"
                    value={option.value}
                    checked={settings.theme === option.value}
                    onChange={() => update('theme', option.value)}
                  />
                  <span className={`theme-swatch theme-swatch-${option.value}`} aria-hidden="true"><i /><i /><i /></span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="settings-section">
            <legend><Type size={16} /> 글꼴</legend>
            <div className="settings-grid">
              <label>
                <span>본문 글꼴</span>
                <select value={settings.bodyFont} onChange={(event) => update('bodyFont', event.target.value as FontChoice)}>
                  <option value="sans">고딕</option>
                  <option value="serif">명조</option>
                  <option value="mono">고정폭</option>
                </select>
              </label>
              <label>
                <span>제목 글꼴</span>
                <select value={settings.headingFont} onChange={(event) => update('headingFont', event.target.value as FontChoice)}>
                  <option value="sans">고딕</option>
                  <option value="serif">명조</option>
                  <option value="mono">고정폭</option>
                </select>
              </label>
              <label>
                <span>코드 글꼴</span>
                <select value={settings.codeFont} onChange={(event) => update('codeFont', event.target.value as CodeFontChoice)}>
                  <option value="system">시스템 고정폭</option>
                  <option value="classic">Courier</option>
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className="settings-section">
            <legend><SlidersHorizontal size={16} /> 문서 스타일</legend>
            <label className="settings-row">
              <span><strong>레이아웃</strong><small>본문 폭과 여백을 선택합니다.</small></span>
              <select value={settings.documentStyle} onChange={(event) => update('documentStyle', event.target.value as DocumentStyle)}>
                <option value="comfortable">편안하게</option>
                <option value="compact">집중</option>
                <option value="wide">넓게</option>
              </select>
            </label>
            <label className="range-setting">
              <span><strong>본문 크기</strong><output>{settings.fontSize}px</output></span>
              <input type="range" min="14" max="22" step="1" value={settings.fontSize} onChange={(event) => update('fontSize', Number(event.target.value))} />
            </label>
            <label className="range-setting">
              <span><strong>줄 간격</strong><output>{settings.lineHeight.toFixed(1)}</output></span>
              <input type="range" min="1.4" max="2.2" step="0.1" value={settings.lineHeight} onChange={(event) => update('lineHeight', Number(event.target.value))} />
            </label>
            <label className="settings-row">
              <span><strong>강조 색상</strong><small>링크, 체크박스와 커서에 적용됩니다.</small></span>
              <span className="color-setting">
                <input type="color" value={settings.accent} onChange={(event) => update('accent', event.target.value)} aria-label="강조 색상" />
                <code>{settings.accent}</code>
              </span>
            </label>
          </fieldset>
        </div>

        <footer className="settings-footer">
          <button type="button" onClick={() => onChange(defaultAppearance)}><RotateCcw size={15} /> 기본값 복원</button>
          <button type="button" className="settings-done" onClick={onClose}>완료</button>
        </footer>
      </section>
    </div>
  );
}
