import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthError, AuthManager, expiredSessionCookie, readSessionToken, sessionCookie } from './auth.mjs';
import { FileVault, VaultError } from './vault.mjs';
import { OllamaError, OllamaSettingsStore, proxyOllama, publicSettingsView } from './ollama.mjs';
import { VaultWatcher } from './watcher.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicRoot = resolve(process.env.WEBOBSIDIAN_DIST_DIR ?? resolve(projectRoot, 'dist'));
const vaultRoot = resolve(process.env.WEBOBSIDIAN_VAULT_DIR ?? resolve(projectRoot, 'vault'));
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const secureCookie = process.env.WEBOBSIDIAN_SECURE_COOKIE === 'true' || process.env.NODE_ENV === 'production';
const maxBodySize = 10 * 1024 * 1024;
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

const auth = new AuthManager(process.env.WEBOBSIDIAN_PASSWORD);
const vault = new FileVault(vaultRoot);
await vault.initialize();
const watcher = new VaultWatcher(vaultRoot, vault.changes);
watcher.start();
// Ollama Cloud 설정(공유 API 키, 모델)은 vault 루트의 dotfile에 저장해 모든 브라우저가 공유한다.
const ollamaSettings = new OllamaSettingsStore(
  process.env.WEBOBSIDIAN_OLLAMA_SETTINGS_FILE ?? resolve(vaultRoot, '.webobsidian-ollama.json'),
);

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
    if ((url.pathname.startsWith('/api/vault') || url.pathname.startsWith('/api/ollama/')) && !auth.isAuthenticated(sessionToken)) {
      return sendJson(response, 401, { error: '로그인이 필요합니다.' });
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
    // Ollama Cloud: 설정은 서버 파일에 저장하고, 프록시는 저장된 키를 사용한다(헤더 직접 전달도 허용).
    if (url.pathname === '/api/ollama/settings') {
      if (request.method === 'GET') {
        return sendJson(response, 200, publicSettingsView(await ollamaSettings.read()));
      }
      if (request.method === 'PUT') {
        const body = await readJson(request);
        return sendJson(response, 200, await ollamaSettings.update(body));
      }
    }
    if (url.pathname === '/api/ollama/tags' && request.method === 'GET') {
      await proxyOllama(request, response, url.pathname, null, (await ollamaSettings.read()).apiKey);
      return;
    }
    if (url.pathname === '/api/ollama/chat' && request.method === 'POST') {
      const body = await readJson(request);
      await proxyOllama(request, response, url.pathname, body, (await ollamaSettings.read()).apiKey);
      return;
    }
    if (url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'API를 찾을 수 없습니다.' });
    await serveStatic(request, response, url.pathname);
  } catch (error) {
    const status = error instanceof VaultError || error instanceof AuthError || error instanceof OllamaError ? error.status : error?.code === 'ENOENT' ? 503 : 500;
    if (status === 500) console.error(error);
    sendJson(response, status, { error: status === 500 ? '서버 오류가 발생했습니다.' : error.message });
  }
});

server.listen(port, host, () => {
  console.log(`WebObsidian: http://${host}:${port}`);
  console.log(`Vault directory: ${vaultRoot}`);
});
