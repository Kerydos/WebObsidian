// 과거 버전이 브라우저 localStorage에 저장하던 Ollama Cloud 설정.
// 현재 설정은 서버에 저장되므로 이 모듈은 서버로의 일회성 마이그레이션에만 사용한다.
export interface LegacyOllamaSettings {
  apiKey: string;
  model: string;
}

export const OLLAMA_STORAGE_KEY = 'webobsidian:ollama:v1';

const modelPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/;
const maxApiKeyLength = 4096;

export function parseOllamaSettings(value: string | null): LegacyOllamaSettings {
  if (!value) return { apiKey: '', model: '' };
  try {
    const parsed = JSON.parse(value) as Partial<LegacyOllamaSettings>;
    return {
      apiKey:
        typeof parsed.apiKey === 'string' && parsed.apiKey.trim() && parsed.apiKey.length <= maxApiKeyLength
          ? parsed.apiKey.trim()
          : '',
      model: typeof parsed.model === 'string' && modelPattern.test(parsed.model.trim()) ? parsed.model.trim() : '',
    };
  } catch {
    return { apiKey: '', model: '' };
  }
}

export function readLegacyOllamaSettings(): LegacyOllamaSettings {
  try {
    return parseOllamaSettings(window.localStorage.getItem(OLLAMA_STORAGE_KEY));
  } catch {
    return { apiKey: '', model: '' };
  }
}

export function clearLegacyOllamaSettings(): void {
  try {
    window.localStorage.removeItem(OLLAMA_STORAGE_KEY);
  } catch {
    // 저장소에 접근할 수 없으면 마이그레이션 실패로 간주하지 않는다.
  }
}
