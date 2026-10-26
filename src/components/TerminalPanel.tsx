import { useEffect, useRef, useState } from 'react';
import { RotateCw, SquareTerminal, X } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalPanelProps {
  height: number;
  onClose: () => void;
}

type ConnectionState = 'connecting' | 'open' | 'closed' | 'unavailable';

// 터미널은 항상 어두운 배색을 쓴다(tmux·CLI 도구의 기본 색상과 어울리도록).
const terminalTheme = {
  background: '#14120f',
  foreground: '#e8e2d8',
  cursor: '#d7ad4a',
  selectionBackground: '#4a4234',
  black: '#14120f', brightBlack: '#5b554b',
  red: '#e06c75', brightRed: '#f28b82',
  green: '#98c379', brightGreen: '#b5e38a',
  yellow: '#d7ad4a', brightYellow: '#e9c46a',
  blue: '#61afef', brightBlue: '#8ec7ff',
  magenta: '#c678dd', brightMagenta: '#d7a2f0',
  cyan: '#56b6c2', brightCyan: '#7fd3dc',
  white: '#e8e2d8', brightWhite: '#fbf7f0',
};

export function TerminalPanel({ height, onClose }: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ConnectionState>('connecting');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, "D2Coding", monospace', theme: terminalTheme, allowProposedApi: true });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/api/terminal`);
    socket.binaryType = 'arraybuffer';
    const encoder = new TextEncoder();
    const sendResize = () => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ resize: [terminal.cols, terminal.rows] }));
    };
    let opened = false;
    socket.onopen = () => {
      opened = true;
      setState('open');
      sendResize();
      terminal.focus();
    };
    socket.onmessage = (event) => terminal.write(new Uint8Array(event.data as ArrayBuffer));
    socket.onclose = () => {
      // 한 번도 열리지 못했으면 호스트 데몬이 없거나 세션이 만료된 경우다.
      setState(opened ? 'closed' : 'unavailable');
      terminal.write('\r\n\x1b[2m[연결이 종료되었습니다]\x1b[0m\r\n');
    };
    const inputDisposable = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(encoder.encode(data));
    });
    const observer = new ResizeObserver(() => {
      fit.fit();
      sendResize();
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      inputDisposable.dispose();
      socket.close();
      terminal.dispose();
    };
  }, [attempt]);

  return (
    <aside className="inspector terminal-panel" aria-label="웹 터미널" style={{ height }}>
      <div className="inspector-heading">
        <div><span>웹 터미널</span><strong>{state === 'open' ? 'tmux: webobsidian' : state === 'connecting' ? '연결 중…' : '연결 끊김'}</strong></div>
        <div className="terminal-actions">
          {state === 'closed' || state === 'unavailable' ? <button type="button" className="topbar-button" onClick={() => setAttempt((n) => n + 1)} title="다시 연결" aria-label="다시 연결"><RotateCw size={14} /></button> : null}
          <button type="button" className="topbar-button" onClick={onClose} title="터미널 닫기" aria-label="터미널 닫기"><X size={14} /></button>
        </div>
      </div>
      <div className="terminal-host" ref={hostRef} />
      {state === 'unavailable' ? (
        <p className="terminal-notice"><SquareTerminal size={14} /> 터미널 서버에 연결할 수 없습니다. 호스트에서 <code>webobsidian-terminal</code> 서비스가 실행 중인지 확인하세요.</p>
      ) : null}
    </aside>
  );
}

export default TerminalPanel;
