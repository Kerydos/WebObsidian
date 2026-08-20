// Ollama Cloud(https://ollama.com) API 프록시와 서버 측 설정 저장소.
// API 키는 서버의 설정 파일(vault 루트의 dotfile)에 저장되어 로그인한 모든 브라우저가 함께 사용한다.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';

const DEFAULT_HOST = 'https://ollama.com';
const maxApiKeyLength = 4096;
const modelPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/;
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

export class OllamaError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function ollamaCloudHost() {
  const host = (process.env.WEBOBSIDIAN_OLLAMA_HOST ?? DEFAULT_HOST).trim().replace(/\/+$/, '');
  if (!/^https?:\/\/\S+$/.test(host)) {
    throw new OllamaError('WEBOBSIDIAN_OLLAMA_HOST는 http 또는 https URL이어야 합니다.');
  }
  return host;
}

export function apiKeyFrom(request) {
  const header = request?.headers?.authorization;
  if (typeof header !== 'string') throw new OllamaError('Ollama Cloud API 키를 입력해 주세요.', 401);
  const match = /^Bearer\s+(\S.*)$/i.exec(header.trim());
  const key = match?.[1]?.trim() ?? '';
  if (!key || key.length > maxApiKeyLength) throw new OllamaError('Ollama Cloud API 키를 입력해 주세요.', 401);
  return key;
}

// 요청 헤더에 명시적 키가 있으면 그것을, 없으면 서버에 저장된 키를 사용한다.
export function resolveApiKey(request, storedKey = '') {
  const header = request?.headers?.authorization;
  if (typeof header === 'string' && header.trim()) return apiKeyFrom(request);
  const key = typeof storedKey === 'string' ? storedKey.trim() : '';
  if (key && key.length <= maxApiKeyLength) return key;
  throw new OllamaError('저장된 Ollama Cloud API 키가 없습니다. 설정에서 API 키를 저장해 주세요.', 401);
}

// 설정 파일에 기록하기 전 값의 형식을 검증한다. undefined는 '변경 없음', null은 삭제를 뜻한다.
export function sanitizeApiKey(value) {
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (typeof value !== 'string') throw new OllamaError('API 키 형식이 올바르지 않습니다.');
  const key = value.trim();
  if (key.length > maxApiKeyLength) throw new OllamaError('API 키가 너무 깁니다.');
  return key;
}

export function sanitizeModel(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new OllamaError('모델 이름이 올바르지 않습니다.');
  const model = value.trim();
  if (model && !modelPattern.test(model)) throw new OllamaError('모델 이름이 올바르지 않습니다.');
  return model;
}

// API 키 원문은 브라우저로 돌려주지 않고 설정 여부와 마스킹 힌트만 공개한다.
export function publicSettingsView(stored) {
  const apiKey = typeof stored?.apiKey === 'string' ? stored.apiKey : '';
  return {
    hasApiKey: apiKey !== '',
    apiKeyHint: apiKey.length >= 12 ? `${apiKey.slice(0, 3)}…${apiKey.slice(-4)}` : '••••',
    model: typeof stored?.model === 'string' ? stored.model : '',
  };
}

// 서버의 Ollama Cloud 설정 파일 저장소. 쓰기는 FileVault처럼 큐로 직렬화하고
// 파일은 소유자만 읽을 수 있도록 0600 권한으로 생성한다.
export class OllamaSettingsStore {
  constructor(filePath) {
    this.filePath = resolvePath(filePath);
    this.writeQueue = Promise.resolve();
  }

  async read() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
      return {
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
        model: typeof parsed.model === 'string' ? parsed.model : '',
      };
    } catch (error) {
      if (error?.code === 'ENOENT') return { apiKey: '', model: '' };
      // 손상된 설정 파일은 빈 설정으로 취급한다. 새로 저장하면 파일이 복구된다.
      return { apiKey: '', model: '' };
    }
  }

  update(patch) {
    const operation = this.writeQueue.then(() => this.updateNow(patch));
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async updateNow(patch) {
    const apiKey = sanitizeApiKey(patch?.apiKey);
    const model = sanitizeModel(patch?.model);
    const current = await this.read();
    const next = {
      apiKey: apiKey === undefined ? current.apiKey : apiKey,
      model: model === undefined ? current.model : model,
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    return publicSettingsView(next);
  }
}

// 클라이언트 요청 중 프록시에 필요한 필드만 허용해 업스트림으로 전달한다.
export function sanitizeChatRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OllamaError('올바른 요청이 아닙니다.');
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  if (!model || model.length > 200) throw new OllamaError('모델 이름이 올바르지 않습니다.');
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 100) {
    throw new OllamaError('대화 메시지가 올바르지 않습니다.');
  }
  const messages = body.messages.map((message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new OllamaError('대화 메시지가 올바르지 않습니다.');
    if (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') {
      throw new OllamaError('대화 메시지가 올바르지 않습니다.');
    }
    if (typeof message.content !== 'string') throw new OllamaError('대화 메시지가 올바르지 않습니다.');
    return { role: message.role, content: message.content };
  });
  return { model, messages, stream: body.stream === true };
}

function upstreamPathFor(pathname) {
  if (pathname === '/api/ollama/tags') return '/api/tags';
  if (pathname === '/api/ollama/chat') return '/api/chat';
  throw new OllamaError('지원하지 않는 Ollama Cloud 요청입니다.', 404);
}

function mappedStatus(status) {
  return status === 401 || status === 403 || status === 404 || status === 429 ? status : 502;
}

async function upstreamErrorMessage(upstream) {
  const text = await upstream.text().catch(() => '');
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error.trim();
  } catch {
    // JSON이 아니면 아래에서 원문 텍스트를 사용한다.
  }
  const clipped = text.trim().slice(0, 200);
  if (clipped) return clipped;
  if (upstream.status === 401 || upstream.status === 403) return 'Ollama Cloud API 키가 올바르지 않습니다.';
  return `Ollama Cloud 요청이 실패했습니다. (${upstream.status})`;
}

async function streamUpstream(upstream, response) {
  response.writeHead(200, {
    ...securityHeaders,
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });
  try {
    for await (const chunk of upstream.body) {
      if (response.writableEnded || response.destroyed) return;
      response.write(chunk);
    }
    response.end();
  } catch {
    // 클라이언트 연결 종료·업스트림 중단 시 이미 전송된 내용까지만 전달한다.
    response.destroy();
  }
}

export async function proxyOllama(request, response, pathname, body, storedApiKey = '') {
  const apiKey = resolveApiKey(request, storedApiKey);
  const upstreamPath = upstreamPathFor(pathname);
  const payload = pathname === '/api/ollama/chat' ? sanitizeChatRequest(body) : null;
  const timeoutMs = pathname === '/api/ollama/chat' ? 600_000 : 20_000;
  // 브라우저가 응답을 기다리는 도중 접속을 끊으면 업스트림 요청도 함께 취소한다.
  const closeController = new AbortController();
  if (typeof response.once === 'function') response.once('close', () => closeController.abort());

  let upstream;
  try {
    upstream = await fetch(`${ollamaCloudHost()}${upstreamPath}`, {
      method: payload ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: payload?.stream ? 'application/x-ndjson' : 'application/json',
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), closeController.signal]),
    });
  } catch (error) {
    if (response.writableEnded || response.destroyed) return;
    if (error?.name === 'TimeoutError') throw new OllamaError('Ollama Cloud 응답이 너무 늦습니다.', 504);
    throw new OllamaError('Ollama Cloud에 연결할 수 없습니다.', 502);
  }
  if (!upstream.ok) {
    throw new OllamaError(await upstreamErrorMessage(upstream), mappedStatus(upstream.status));
  }
  if (payload?.stream) return streamUpstream(upstream, response);

  const text = await upstream.text();
  try {
    JSON.parse(text);
  } catch {
    throw new OllamaError('Ollama Cloud 응답을 이해할 수 없습니다.', 502);
  }
  response.writeHead(200, {
    ...securityHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(text);
}
