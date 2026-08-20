import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  apiKeyFrom,
  OllamaError,
  ollamaCloudHost,
  OllamaSettingsStore,
  proxyOllama,
  publicSettingsView,
  resolveApiKey,
  sanitizeChatRequest,
} from './ollama.mjs';

class MockResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = null;
    this.headers = null;
    this.chunks = [];
    this.ended = false;
    this.destroyedFlag = false;
  }

  get writableEnded() {
    return this.ended;
  }

  get destroyed() {
    return this.destroyedFlag;
  }

  get headersSent() {
    return this.headers !== null;
  }

  writeHead(status, headers) {
    this.statusCode = status;
    this.headers = headers ?? {};
    return this;
  }

  write(chunk) {
    this.chunks.push(Buffer.from(chunk));
    return true;
  }

  end(chunk) {
    if (chunk) this.chunks.push(Buffer.from(chunk));
    this.ended = true;
    return this;
  }

  destroy() {
    this.destroyedFlag = true;
    this.emit('close');
  }

  body() {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

function authorizedRequest(key = 'test-key') {
  return { method: 'GET', headers: { authorization: `Bearer ${key}` } };
}

describe('ollama cloud proxy helpers', () => {
  it('extracts and validates bearer API keys', () => {
    expect(apiKeyFrom(authorizedRequest('abc123'))).toBe('abc123');
    expect(() => apiKeyFrom({ headers: {} })).toThrow(OllamaError);
    expect(() => apiKeyFrom({ headers: { authorization: 'Token abc' } })).toThrow(OllamaError);
    expect(() => apiKeyFrom({ headers: { authorization: `Bearer ${'x'.repeat(5000)}` } })).toThrow(expect.objectContaining({ status: 401 }));
  });

  it('validates the upstream host override', () => {
    process.env.WEBOBSIDIAN_OLLAMA_HOST = 'http://127.0.0.1:9999/';
    expect(ollamaCloudHost()).toBe('http://127.0.0.1:9999');
    process.env.WEBOBSIDIAN_OLLAMA_HOST = 'ftp://bad';
    expect(() => ollamaCloudHost()).toThrow(OllamaError);
    delete process.env.WEBOBSIDIAN_OLLAMA_HOST;
  });

  it('sanitizes chat requests to allow-listed fields', () => {
    const payload = sanitizeChatRequest({
      model: ' gpt-oss:120b ',
      messages: [{ role: 'user', content: '안녕', extra: 'ignored' }],
      stream: true,
      options: { temperature: 0 },
    });
    expect(payload).toEqual({ model: 'gpt-oss:120b', messages: [{ role: 'user', content: '안녕' }], stream: true });

    expect(() => sanitizeChatRequest({ model: '', messages: [{ role: 'user', content: 'x' }] })).toThrow(OllamaError);
    expect(() => sanitizeChatRequest({ model: 'm', messages: [] })).toThrow(OllamaError);
    expect(() => sanitizeChatRequest({ model: 'm', messages: [{ role: 'tool', content: 'x' }] })).toThrow(OllamaError);
    expect(() => sanitizeChatRequest({ model: 'm', messages: [{ role: 'user', content: 7 }] })).toThrow(OllamaError);
    expect(() => sanitizeChatRequest(null)).toThrow(OllamaError);
  });

  it('rejects unsupported proxy paths', async () => {
    await expect(proxyOllama(authorizedRequest(), new MockResponse(), '/api/ollama/pull')).rejects.toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });
});

describe('ollama cloud server settings store', () => {
  let store;
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'webobsidian-ollama-'));
    store = new OllamaSettingsStore(join(dir, '.webobsidian-ollama.json'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns empty settings when the file does not exist', async () => {
    expect(await store.read()).toEqual({ apiKey: '', model: '' });
    expect(publicSettingsView(await store.read())).toEqual({ hasApiKey: false, apiKeyHint: '••••', model: '' });
  });

  it('saves keys and models with owner-only permissions', async () => {
    const view = await store.update({ apiKey: 'sk-very-secret-key-1234', model: 'gpt-oss:120b' });
    expect(view).toEqual({ hasApiKey: true, apiKeyHint: 'sk-…1234', model: 'gpt-oss:120b' });

    const raw = JSON.parse(await readFile(store.filePath, 'utf8'));
    expect(raw).toEqual({ apiKey: 'sk-very-secret-key-1234', model: 'gpt-oss:120b' });
    const permissions = (await stat(store.filePath)).mode & 0o777;
    expect(permissions & 0o077).toBe(0); // 소유자 외에는 읽거나 쓸 수 없다.
  });

  it('patches fields independently and clears keys with null', async () => {
    await store.update({ apiKey: 'first-key-value-9999' });
    await store.update({ model: ' qwen3.5:397b ' });
    expect(await store.read()).toEqual({ apiKey: 'first-key-value-9999', model: 'qwen3.5:397b' });
    const cleared = await store.update({ apiKey: null });
    expect(cleared.hasApiKey).toBe(false);
    expect((await store.read()).model).toBe('qwen3.5:397b');
  });

  it('rejects malformed values and recovers from corrupted files', async () => {
    await expect(store.update({ apiKey: 'x'.repeat(5000) })).rejects.toThrow(OllamaError);
    await expect(store.update({ model: 'bad model!' })).rejects.toThrow(OllamaError);
    await store.update({ apiKey: 'good-key', model: 'm' });
    await writeFile(store.filePath, '{corrupt', 'utf8');
    expect(await store.read()).toEqual({ apiKey: '', model: '' });
    const recovered = await store.update({ model: 'fixed' });
    expect(recovered).toEqual({ hasApiKey: false, apiKeyHint: '••••', model: 'fixed' });
  });

  it('masks short keys completely in the public view', () => {
    expect(publicSettingsView({ apiKey: 'short', model: '' })).toEqual({ hasApiKey: true, apiKeyHint: '••••', model: '' });
  });
});

describe('ollama cloud api key resolution', () => {
  it('prefers the request header key over the stored key', () => {
    expect(resolveApiKey(authorizedRequest('header-key'), 'stored-key')).toBe('header-key');
    expect(resolveApiKey({ headers: {} }, 'stored-key')).toBe('stored-key');
    expect(resolveApiKey({ headers: {} }, '  stored-key  ')).toBe('stored-key');
  });

  it('requires a key from either source', () => {
    expect(() => resolveApiKey({ headers: {} }, '')).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => resolveApiKey({ headers: {} }, undefined)).toThrow(OllamaError);
    // 헤더가 비정식 형식이면 저장된 키가 있어도 거부한다(명시적 의도 우선).
    expect(() => resolveApiKey({ headers: { authorization: 'Token abc' } }, 'stored-key')).toThrow(OllamaError);
  });
});

// PART3
describe('ollama cloud proxy forwarding', () => {

  let upstream;
  let upstreamHandler;

  beforeEach(async () => {
    upstreamHandler = null;
    upstream = createServer((request, response) => upstreamHandler?.(request, response));
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    process.env.WEBOBSIDIAN_OLLAMA_HOST = `http://127.0.0.1:${upstream.address().port}`;
  });

  afterEach(async () => {
    delete process.env.WEBOBSIDIAN_OLLAMA_HOST;
    await new Promise((resolve) => upstream.close(resolve));
  });

  it('forwards model listing with the API key', async () => {
    let received;
    upstreamHandler = (request, response) => {
      received = { url: request.url, authorization: request.headers.authorization };
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ models: [{ name: 'gpt-oss:120b', model: 'gpt-oss:120b' }] }));
    };
    const response = new MockResponse();
    await proxyOllama(authorizedRequest('secret-key'), response, '/api/ollama/tags');

    expect(received.url).toBe('/api/tags');
    expect(received.authorization).toBe('Bearer secret-key');
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body())).toEqual({ models: [{ name: 'gpt-oss:120b', model: 'gpt-oss:120b' }] });
  });

  it('maps upstream auth failures to OllamaError', async () => {
    upstreamHandler = (request, response) => {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'invalid api key' }));
    };
    await expect(proxyOllama(authorizedRequest('bad'), new MockResponse(), '/api/ollama/tags')).rejects.toThrow(
      expect.objectContaining({ status: 401, message: 'invalid api key' }),
    );
  });

  it('forwards non-streaming chat requests and responses', async () => {
    let received;
    upstreamHandler = (request, response) => {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        received = { url: request.url, body: JSON.parse(body) };
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ message: { role: 'assistant', content: '안녕하세요!' }, done: true }));
      });
    };
    const response = new MockResponse();
    await proxyOllama({ method: 'POST', headers: { authorization: 'Bearer k' } }, response, '/api/ollama/chat', {
      model: 'gpt-oss:120b',
      messages: [{ role: 'user', content: '안녕' }],
      stream: false,
    });

    expect(received.url).toBe('/api/chat');
    expect(received.body).toEqual({ model: 'gpt-oss:120b', messages: [{ role: 'user', content: '안녕' }], stream: false });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body()).message.content).toBe('안녕하세요!');
  });

  it('streams NDJSON chat responses through', async () => {
    upstreamHandler = (request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      response.write(`${JSON.stringify({ message: { role: 'assistant', content: '하' } })}\n`);
      response.write(`${JSON.stringify({ message: { role: 'assistant', content: '이' } })}\n`);
      response.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true })}\n`);
    };
    const response = new MockResponse();
    await proxyOllama({ method: 'POST', headers: { authorization: 'Bearer k' } }, response, '/api/ollama/chat', {
      model: 'gpt-oss:120b',
      messages: [{ role: 'user', content: '스트리밍 테스트' }],
      stream: true,
    });

    expect(response.headers['Content-Type']).toContain('application/x-ndjson');
    expect(response.ended).toBe(true);
    const lines = response.body().trim().split('\n').map((line) => JSON.parse(line));
    expect(lines.map((line) => line.message.content)).toEqual(['하', '이', '']);
    expect(lines.at(-1).done).toBe(true);
  });

  it('reports unreachable upstreams as bad gateway', async () => {
    process.env.WEBOBSIDIAN_OLLAMA_HOST = 'http://127.0.0.1:1';
    await expect(proxyOllama(authorizedRequest(), new MockResponse(), '/api/ollama/tags')).rejects.toThrow(
      expect.objectContaining({ status: 502, message: 'Ollama Cloud에 연결할 수 없습니다.' }),
    );
  });

  it('uses the stored key when the request carries no Authorization header', async () => {
    let receivedAuthorization;
    upstreamHandler = (request, response) => {
      receivedAuthorization = request.headers.authorization;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ models: [] }));
    };
    const response = new MockResponse();
    await proxyOllama({ method: 'GET', headers: {} }, response, '/api/ollama/tags', null, 'stored-server-key');

    expect(receivedAuthorization).toBe('Bearer stored-server-key');
    expect(response.statusCode).toBe(200);
  });

  it('rejects proxying when neither header nor stored key exists', async () => {
    await expect(proxyOllama({ method: 'GET', headers: {} }, new MockResponse(), '/api/ollama/tags')).rejects.toThrow(
      expect.objectContaining({ status: 401, message: '저장된 Ollama Cloud API 키가 없습니다. 설정에서 API 키를 저장해 주세요.' }),
    );
  });
});
