import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthError, AuthManager, expiredSessionCookie, readSessionToken, sessionCookie } from './auth.mjs';
import { FileVault, VaultError } from './vault.mjs';
import { VaultWatcher } from './watcher.mjs';
import { BlogError, BlogSettingsStore, listBlogFolders, publishBlog } from './blog.mjs';
import { checkMarkdown, SpellcheckError } from './spellcheck.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicRoot = resolve(process.env.WEBOBSIDIAN_DIST_DIR ?? resolve(projectRoot, 'dist'));
const vaultRoot = resolve(process.env.WEBOBSIDIAN_VAULT_DIR ?? resolve(homedir(), 'Documents', 'SecondBrain'));
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const secureCookie = process.env.WEBOBSIDIAN_SECURE_COOKIE === 'true' || process.env.NODE_ENV === 'production';
const maxBodySize = 10 * 1024 * 1024;
// 웹 터미널: 호스트에서 실행되는 terminal-host 데몬의 유닉스 소켓(비어 있으면 기능 비활성).
const terminalSocket = process.env.WEBOBSIDIAN_TERMINAL_SOCKET ?? '';
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

function clientIdFor(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return request.socket.remoteAddress ?? 'unknown';
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...securityHeaders,
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodySize) throw new VaultError('파일 크기는 10MB를 초과할 수 없습니다.', 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new VaultError('올바른 JSON 요청이 아닙니다.');
  }
}

async function serveStatic(request, response, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let filePath = resolve(publicRoot, requested);
  if (!filePath.startsWith(`${publicRoot}/`)) throw new VaultError('올바르지 않은 경로입니다.');
  try {
    if (!(await stat(filePath)).isFile()) throw new Error();
  } catch {
    filePath = resolve(publicRoot, 'index.html');
    await access(filePath);
  }
  const noCache = filePath.endsWith('/index.html') || filePath.endsWith('/sw.js') || filePath.endsWith('/registerSW.js');
  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': noCache ? 'no-cache' : filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    ...securityHeaders,
  });
  createReadStream(filePath).pipe(response);
}

// 개인 테스트 환경에서 짧은 비밀번호를 쓸 수 있도록 최소 길이를 환경 변수로 완화한다(기본 12자).
const configuredMinLength = Number(process.env.WEBOBSIDIAN_MIN_PASSWORD_LENGTH);
const minPasswordLength = Number.isInteger(configuredMinLength) && configuredMinLength > 0
  ? configuredMinLength
  : 12;
const auth = new AuthManager(process.env.WEBOBSIDIAN_PASSWORD, { minLength: minPasswordLength });
const vault = new FileVault(vaultRoot);
await vault.initialize();
const watcher = new VaultWatcher(vaultRoot, vault.changes);
watcher.start();

const blogSettings = new BlogSettingsStore(resolve(vaultRoot, '.webobsidian-blog.json'));
// 바른(Bareun) 맞춤법 API 키. 형식이 같아 블로그 키 저장소를 그대로 쓴다.
const bareunSettings = new BlogSettingsStore(resolve(vaultRoot, '.webobsidian-bareun.json'));

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(response, 200, { status: 'ok' });
    }
    const sessionToken = readSessionToken(request.headers.cookie);
    if (request.method === 'GET' && url.pathname === '/api/auth/session') {
      return sendJson(response, 200, { authenticated: auth.isAuthenticated(sessionToken) });
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await readJson(request);
      const token = auth.login(body.password, clientIdFor(request));
      return sendJson(response, 200, { authenticated: true }, {
        'Set-Cookie': sessionCookie(token, { secure: secureCookie }),
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
      auth.logout(sessionToken);
      return sendJson(response, 200, { authenticated: false }, {
        'Set-Cookie': expiredSessionCookie({ secure: secureCookie }),
      });
    }
    if ((url.pathname.startsWith('/api/vault') || url.pathname.startsWith('/api/blog/') || url.pathname.startsWith('/api/spellcheck')) && !auth.isAuthenticated(sessionToken)) {
      return sendJson(response, 401, { error: '로그인이 필요합니다.' });
    }
    if (url.pathname === '/api/blog/settings') {
      if (request.method === 'GET') return sendJson(response, 200, { hasApiKey: !!(await blogSettings.read()) });
      if (request.method === 'PUT') {
        const body = await readJson(request);
        await blogSettings.write(body.apiKey);
        return sendJson(response, 200, { hasApiKey: !!(await blogSettings.read()) });
      }
    }
    if (url.pathname === '/api/spellcheck/settings') {
      if (request.method === 'GET') return sendJson(response, 200, { hasApiKey: !!(await bareunSettings.read()) });
      if (request.method === 'PUT') {
        const body = await readJson(request);
        await bareunSettings.write(body.apiKey);
        return sendJson(response, 200, { hasApiKey: !!(await bareunSettings.read()) });
      }
    }
    if (request.method === 'POST' && url.pathname === '/api/spellcheck') {
      const body = await readJson(request);
      return sendJson(response, 200, await checkMarkdown(body.text, {
        languageToolUrl: process.env.WEBOBSIDIAN_LANGUAGETOOL_URL,
        bareunApiKey: await bareunSettings.read(),
        bareunHost: process.env.WEBOBSIDIAN_BAREUN_HOST,
      }));
    }
    if (request.method === 'GET' && url.pathname === '/api/blog/folders') {
      return sendJson(response, 200, { folders: await listBlogFolders(process.env.WEBOBSIDIAN_BLOG_VAULT_DIR ?? resolve(projectRoot, '../blog_with_obsidian_style/vault')) });
    }
    if (request.method === 'POST' && url.pathname === '/api/blog/publish') {
      const body = await readJson(request);
      return sendJson(response, 200, await publishBlog({
        ...body,
        apiKey: await blogSettings.read(),
        host: process.env.WEBOBSIDIAN_BLOG_HOST ?? 'http://note-garden:3000',
      }));
    }
    if (request.method === 'GET' && url.pathname === '/api/vault') {
      const { entries, folders } = await vault.scan();
      return sendJson(response, 200, { name: 'Server Vault', entries, folders });
    }
    if (url.pathname === '/api/vault/file') {
      const path = url.searchParams.get('path');
      if (request.method === 'GET') return sendJson(response, 200, await vault.read(path));
      if (request.method === 'PUT') {
        const body = await readJson(request);
        return sendJson(response, 200, await vault.write(path, body.content, body));
      }
      if (request.method === 'DELETE') {
        await vault.remove(path);
        return sendJson(response, 200, { deleted: true });
      }
      if (request.method === 'PATCH') {
        const body = await readJson(request);
        return sendJson(response, 200, await vault.move(path, body.newPath));
      }
    }
    if (url.pathname === '/api/vault/folder') {
      const path = url.searchParams.get('path');
      if (request.method === 'POST') return sendJson(response, 200, await vault.createFolder(path));
      if (request.method === 'PATCH') {
        const body = await readJson(request);
        return sendJson(response, 200, await vault.moveFolder(path, body.newPath));
      }
      if (request.method === 'DELETE') {
        await vault.removeFolder(path);
        return sendJson(response, 200, { deleted: true });
      }
    }
    if (request.method === 'GET' && url.pathname === '/api/vault/events') {
      response.writeHead(200, {
        ...securityHeaders,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.write('retry: 3000\n\n');
      response.write(': connected\n\n');
      const heartbeat = setInterval(() => {
        response.write(': ping\n\n');
      }, 25000);
      const unsubscribe = vault.changes.subscribe((change) => {
        response.write(`data: ${JSON.stringify(change)}\n\n`);
      });
      request.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      return;
    }
    if (url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'API를 찾을 수 없습니다.' });
    await serveStatic(request, response, url.pathname);
  } catch (error) {
    const status = error instanceof VaultError || error instanceof AuthError || error instanceof BlogError || error instanceof SpellcheckError ? error.status : error?.code === 'ENOENT' ? 503 : 500;
    if (status === 500) console.error(error);
    sendJson(response, status, { error: status === 500 ? '서버 오류가 발생했습니다.' : error.message });
  }
});

// 웹 터미널 WebSocket: 세션 쿠키를 확인한 뒤 업그레이드 요청을 호스트 데몬 소켓으로 그대로 흘려보낸다.
server.on('upgrade', (request, socket, head) => {
  const refuse = (status, text) => socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/api/terminal') return refuse(404, 'Not Found');
  if (!auth.isAuthenticated(readSessionToken(request.headers.cookie))) return refuse(401, 'Unauthorized');
  if (!terminalSocket) return refuse(503, 'Terminal Disabled');
  const upstream = connect(terminalSocket);
  upstream.on('connect', () => {
    const headers = Object.entries(request.headers).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`);
    upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => refuse(503, 'Terminal Unavailable'));
  socket.on('error', () => upstream.destroy());
});

server.listen(port, host, () => {
  console.log(`WebObsidian: http://${host}:${port}`);
  console.log(`Vault directory: ${vaultRoot}`);
});
