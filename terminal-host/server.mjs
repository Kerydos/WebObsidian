// WebObsidian 웹 터미널 호스트 데몬.
// Docker 안의 WebObsidian 서버는 로그인 세션을 확인한 뒤 WebSocket 업그레이드 요청을
// 이 데몬의 유닉스 소켓으로 그대로 흘려보낸다. 데몬은 호스트의 PTY에서 tmux 세션을 열어
// claude, codex 같은 호스트 CLI를 볼트 폴더에서 실행할 수 있게 한다.
//
// 프로토콜: 클라이언트→서버 바이너리 프레임 = 키 입력, 텍스트 프레임 = JSON 제어({"resize":[cols,rows]}).
//           서버→클라이언트 바이너리 프레임 = PTY 출력.
import { chmodSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import pty from 'node-pty';
import { WebSocketServer } from 'ws';

const socketPath = resolve(process.env.WEBOBSIDIAN_TERMINAL_SOCKET ?? resolve(homedir(), '.local/state/webobsidian/terminal.sock'));
const cwd = resolve(process.env.WEBOBSIDIAN_VAULT_DIR ?? resolve(homedir(), 'Documents/SecondBrain'));
// ponytail: 모든 브라우저가 tmux 세션 하나를 공유한다. 탭마다 분리하려면 쿼리스트링으로 세션 이름을 받으면 된다.
const sessionName = process.env.WEBOBSIDIAN_TMUX_SESSION ?? 'webobsidian';

mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
if (existsSync(socketPath)) unlinkSync(socketPath);

const httpServer = createServer((_request, response) => {
  response.writeHead(426, { 'Content-Type': 'text/plain' });
  response.end('WebSocket only');
});
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (socket) => {
  const shell = pty.spawn('tmux', ['new-session', '-A', '-s', sessionName], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: process.env.LANG ?? 'C.UTF-8' },
  });
  shell.onData((data) => {
    if (socket.readyState === socket.OPEN) socket.send(Buffer.from(data, 'utf8'));
  });
  shell.onExit(() => socket.close());
  socket.on('message', (data, isBinary) => {
    if (isBinary) return shell.write(data.toString('utf8'));
    try {
      const control = JSON.parse(data.toString('utf8'));
      if (Array.isArray(control.resize)) {
        const [cols, rows] = control.resize.map((n) => Math.max(2, Math.min(500, Math.trunc(Number(n)) || 0)));
        shell.resize(cols, rows);
      }
    } catch { /* 잘못된 제어 메시지는 무시 */ }
  });
  // 접속이 끊겨도 tmux 세션은 살아 있으므로 PTY 클라이언트만 정리한다.
  socket.on('close', () => shell.kill());
});

httpServer.listen(socketPath, () => {
  chmodSync(socketPath, 0o600);
  console.log(`terminal host listening on ${socketPath} (cwd: ${cwd}, tmux session: ${sessionName})`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { httpServer.close(); process.exit(0); });
