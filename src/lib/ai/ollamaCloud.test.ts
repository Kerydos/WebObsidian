import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkGrammar, fetchOllamaSettings, listCloudModels, saveOllamaSettings, streamCloudChat } from './ollamaCloud';

const fetchMock = vi.fn();
const dispatchEvent = vi.fn();
vi.stubGlobal('fetch', fetchMock);
vi.stubGlobal('window', { dispatchEvent });
afterEach(() => {
  fetchMock.mockReset();
  dispatchEvent.mockClear();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function ndjsonResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': 'application/x-ndjson' } });
}

describe('ollama server settings api', () => {
  it('fetches and sanitizes the stored settings view', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hasApiKey: true, apiKeyHint: 'sk-…1234', model: 'gpt-oss:120b', extra: 'ignored' }));
    await expect(fetchOllamaSettings()).resolves.toEqual({ hasApiKey: true, apiKeyHint: 'sk-…1234', model: 'gpt-oss:120b' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/ollama/settings');
  });

  it('saves settings patches without the browser holding the key', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hasApiKey: true, apiKeyHint: 'sk-…9999', model: 'qwen3.5:397b' }));
    await expect(saveOllamaSettings({ apiKey: 'new-key', model: 'qwen3.5:397b' })).resolves.toEqual({
      hasApiKey: true,
      apiKeyHint: 'sk-…9999',
      model: 'qwen3.5:397b',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/ollama/settings');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ apiKey: 'new-key', model: 'qwen3.5:397b' });
  });

  it('signals logout only for session-gate 401s, not missing-key 401s', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: '로그인이 필요합니다.' }, 401));
    await expect(fetchOllamaSettings()).rejects.toThrow('로그인이 필요합니다.');
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'webobsidian:unauthorized' }));

    dispatchEvent.mockClear();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: '저장된 Ollama Cloud API 키가 없습니다. 설정에서 API 키를 저장해 주세요.' }, 401));
    await expect(fetchOllamaSettings()).rejects.toThrow('저장된 Ollama Cloud API 키가 없습니다.');
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});

describe('listCloudModels', () => {
  it('maps the tags payload using the server-stored key', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      models: [
        { name: 'gpt-oss:120b', model: 'gpt-oss:120b', details: { parameter_size: '117B' } },
        { model: 'minimax-m3' },
        'junk',
      ],
    }));
    const models = await listCloudModels();
    expect(models).toEqual([
      { name: 'gpt-oss:120b', parameterSize: '117B' },
      { name: 'minimax-m3', parameterSize: '' },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/ollama/tags');
    expect(init?.headers).toBeUndefined(); // API 키 헤더를 브라우저가 담지 않는다.
  });

  it('propagates server error messages', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Ollama Cloud API 키가 올바르지 않습니다.' }, 401));
    await expect(listCloudModels()).rejects.toThrow('Ollama Cloud API 키가 올바르지 않습니다.');
  });

  it('returns an empty list for unexpected payloads', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    expect(await listCloudModels()).toEqual([]);
  });
});

describe('streamCloudChat', () => {
  it('accumulates streamed deltas across chunk boundaries', async () => {
    const first = `${JSON.stringify({ message: { role: 'assistant', content: '하늘은 ' } })}\n`;
    const second = `${JSON.stringify({ message: { role: 'assistant', content: '왜 파랑' } })}\n`;
    // 한 줄이 두 청크로 쪼개져 도착하는 경우도 처리한다.
    const line = JSON.stringify({ message: { role: 'assistant', content: '까요?' } });
    const thirdA = `${line}`.slice(0, 20);
    const thirdB = `${line}`.slice(20) + '\n';
    const done = `${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true })}\n`;
    fetchMock.mockResolvedValueOnce(ndjsonResponse([first, second, thirdA, thirdB, done]));

    const deltas: string[] = [];
    const full = await streamCloudChat({
      model: 'gpt-oss:120b',
      messages: [{ role: 'user', content: '하늘은 왜 파랑까요?' }],
      onDelta: (delta) => deltas.push(delta),
    });

    expect(full).toBe('하늘은 왜 파랑까요?');
    expect(deltas).toEqual(['하늘은 ', '왜 파랑', '까요?']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/ollama/chat');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      model: 'gpt-oss:120b',
      messages: [{ role: 'user', content: '하늘은 왜 파랑까요?' }],
      stream: true,
    });
  });

  it('surfaces chat API failures', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'model not found' }, 404));
    await expect(streamCloudChat({ model: 'nope', messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow('model not found');
  });
});

describe('checkGrammar', () => {
  it('sends a non-streaming request and parses a JSON array response', async () => {
    const issues = [{ original: '되요', suggestion: '돼요', reason: "'되-'와 '되어-'의 준말 구분" }];
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: { role: 'assistant', content: JSON.stringify(issues) } }));

    await expect(checkGrammar({ model: 'gpt-oss:120b', text: '이렇게 하면 되요.' })).resolves.toEqual(issues);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/ollama/chat');
    const parsedBody = JSON.parse(init.body);
    expect(parsedBody.stream).toBe(false);
    expect(parsedBody.model).toBe('gpt-oss:120b');
    expect(parsedBody.messages[1]).toEqual({ role: 'user', content: '이렇게 하면 되요.' });
  });

  it('extracts a JSON array wrapped in a code fence with surrounding prose', async () => {
    const content = '검사 결과입니다.\n```json\n[{"original":"않되","suggestion":"안 돼","reason":"부정 표현 오류"}]\n```';
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: { content } }));
    await expect(checkGrammar({ model: 'm', text: 't' })).resolves.toEqual([
      { original: '않되', suggestion: '안 돼', reason: '부정 표현 오류' },
    ]);
  });

  it('returns an empty list when there are no issues or the response is unparsable', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: { content: '[]' } }));
    await expect(checkGrammar({ model: 'm', text: 't' })).resolves.toEqual([]);

    fetchMock.mockResolvedValueOnce(jsonResponse({ message: { content: 'not json at all' } }));
    await expect(checkGrammar({ model: 'm', text: 't' })).resolves.toEqual([]);
  });

  it('propagates upstream errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: '저장된 Ollama Cloud API 키가 없습니다.' }, 401));
    await expect(checkGrammar({ model: 'm', text: 't' })).rejects.toThrow('저장된 Ollama Cloud API 키가 없습니다.');
  });
});
