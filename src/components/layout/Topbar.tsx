import { BookOpen, Bot, Check, CircleAlert, HardDrive, LoaderCircle, LogOut, Menu, PencilLine, Send, Settings2, Sparkles } from 'lucide-react';
import type { SaveState } from '../../hooks/useVault';

interface TopbarProps {
  repositoryName: string;
  saveState: SaveState;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  onOpenSettings: () => void;
  onOpenVaultSwitcher: () => void;
  onLogout: () => void;
  activePath?: string;
  editing: boolean;
  onToggleEditing: () => void;
  onPublish?: () => void;
  publishLabel: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
}

export function Topbar({ repositoryName, saveState, assistantOpen, onToggleAssistant, onOpenSettings, onOpenVaultSwitcher, onLogout, activePath, editing, onToggleEditing, onPublish, publishLabel, menuOpen, onToggleMenu }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <button className="topbar-button menu-button" onClick={onToggleMenu} title="메뉴" aria-label="파일 탐색기 열기" aria-expanded={menuOpen}><Menu size={16} /></button>
        <span className="brand-mark"><Sparkles size={16} /></span>
        <strong>WebObsidian</strong>
        <button
          type="button"
          className="vault-pill"
          onClick={onOpenVaultSwitcher}
          title="볼트 저장소 전환"
          aria-label={`현재 볼트: ${repositoryName}. 클릭하면 저장소를 전환할 수 있습니다.`}
        >
          <HardDrive size={13} /> {repositoryName}
        </button>
      </div>
      <div className="topbar-actions">
        <div className="save-status" data-state={saveState}>
          {saveState === 'saving' ? <LoaderCircle size={14} className="spin" /> : null}
          {saveState === 'saved' ? <Check size={14} /> : null}
          {saveState === 'error' ? <CircleAlert size={14} /> : null}
          <span className="btn-label">{saveState === 'dirty' ? '편집 중' : saveState === 'saving' ? '저장 중' : saveState === 'error' ? '저장 실패' : '저장됨'}</span>
        </div>
        {activePath ? <button className="logout-button" onClick={onToggleEditing} title={editing ? '읽기 모드로 전환' : '편집 모드로 전환'}>
          {editing ? <><BookOpen size={15} /><span className="btn-label">읽기</span></> : <><PencilLine size={15} /><span className="btn-label">편집</span></>}
        </button> : null}
        {onPublish ? <button className="logout-button" onClick={onPublish} title={`선택한 ${publishLabel}`}><Send size={15} /><span className="btn-label">{publishLabel}</span></button> : null}
        <button
          className={assistantOpen ? 'topbar-button active' : 'topbar-button'}
          onClick={onToggleAssistant}
          title="AI 도우미"
          aria-label="AI 도우미 열기"
          aria-pressed={assistantOpen}
        >
          <Bot size={16} />
        </button>
        <button className="topbar-button" onClick={onOpenSettings} title="설정" aria-label="설정 열기"><Settings2 size={16} /></button>
        <button className="logout-button" onClick={onLogout} title="로그아웃"><LogOut size={15} /><span className="btn-label">로그아웃</span></button>
      </div>
    </header>
  );
}
