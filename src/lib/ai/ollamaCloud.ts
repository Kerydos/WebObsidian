// Ollama Cloud(https://ollama.com) 클라이언트. 실제 요청은 같은 서버의 /api/ollama/*
// 프록시를 경유하며, API 키는 서버에 저장된 것을 사용한다(브라우저는 키를 다루지 않는다).
export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface CloudModelSummary {
  name: string;
  parameterSize: string;
}

// 서버에 저장된 Ollama Cloud 설정. API 키 원문은 내려오지 않고 설정 여부와 힌트만 제공된다.
export interface OllamaServerSettings {
  hasApiKey: boolean;
  apiKeyHint: string;
  model: string;
}

export const emptyOllamaServerSettings: OllamaServerSettings = { hasApiKey: false, apiKeyHint: '', model: '' };

function sanitizeSettingsView(value: unknown): OllamaServerSettings {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    hasApiKey: record.hasApiKey === true,
    apiKeyHint: typeof record.apiKeyHint === 'string' ? record.apiKeyHint : '',
    model: typeof record.model === 'string' ? record.model : '',
  };
}

async function errorFromResponse(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? `Ollama Cloud 요청에 실패했습니다. (${response.status})`);
}

// 세션 게이트에서 걸린 401(로그인 필요)은 로그인 화면 전환 이벤트로 알린다.
// 프록시 자체의 401(저장된 API 키 없음 등)은 일반 오류로 처리한다.
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    if (response.status === 401) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (body.error === '로그인이 필요합니다.') {
        window.dispatchEvent(new Event('webobsidian:unauthorized'));
      }
      throw new Error(body.error ?? `요청에 실패했습니다. (${response.status})`);
    }
    throw await errorFromResponse(response);
  }
  return (await response.json().catch(() => ({}))) as T;
}

export function fetchOllamaSettings(): Promise<OllamaServerSettings> {
  return requestJson('/api/ollama/settings').then(sanitizeSettingsView);
}

// apiKey를 생략하면 기존 키를 유지하고, null을 전달하면 삭제한다.
export function saveOllamaSettings(patch: { apiKey?: string | null; model?: string }): Promise<OllamaServerSettings> {
  return requestJson('/api/ollama/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).then(sanitizeSettingsView);
}

export async function listCloudModels(signal?: AbortSignal): Promise<CloudModelSummary[]> {
  const body = await requestJson<{ models?: unknown }>('/api/ollama/tags', { signal });
  if (!Array.isArray(body.models)) return [];
  const models: CloudModelSummary[] = [];
  for (const entry of body.models) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === 'string' && record.name ? record.name : typeof record.model === 'string' ? record.model : '';
    if (!name) continue;
    const details = (record.details && typeof record.details === 'object' ? record.details : {}) as Record<string, unknown>;
    const parameterSize = typeof details.parameter_size === 'string' ? details.parameter_size : '';
    models.push({ name, parameterSize });
  }
  return models;
}

export async function streamCloudChat(options: {
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}): Promise<string> {
  const response = await fetch('/api/ollama/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: options.model, messages: options.messages, stream: true }),
    signal: options.signal,
  });
  if (!response.ok) throw await errorFromResponse(response);
  if (!response.body) throw new Error('Ollama Cloud 응답 스트림을 읽을 수 없습니다.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const emit = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: { message?: { content?: unknown } };
    try {
      parsed = JSON.parse(trimmed) as { message?: { content?: unknown } };
    } catch {
      return; // 잘못된 NDJSON 줄은 건너뛴다.
    }
    const content = parsed?.message?.content;
    if (typeof content === 'string' && content) {
      full += content;
      options.onDelta?.(content);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      emit(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf('\n');
    }
  }
  emit(buffer + decoder.decode());
  return full;
}
