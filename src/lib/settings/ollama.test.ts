// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { clearLegacyOllamaSettings, OLLAMA_STORAGE_KEY, parseOllamaSettings, readLegacyOllamaSettings } from './ollama';

describe('legacy local ollama settings', () => {
  it('returns empty defaults for missing or malformed data', () => {
    expect(parseOllamaSettings(null)).toEqual({ apiKey: '', model: '' });
    expect(parseOllamaSettings('{bad json')).toEqual({ apiKey: '', model: '' });
    expect(parseOllamaSettings('[]')).toEqual({ apiKey: '', model: '' });
  });

  it('keeps valid settings and trims whitespace', () => {
    expect(parseOllamaSettings(JSON.stringify({ apiKey: ' sk-live-key ', model: ' gpt-oss:120b ' })))
      .toEqual({ apiKey: 'sk-live-key', model: 'gpt-oss:120b' });
  });

  it('rejects invalid models and oversized keys', () => {
    const settings = parseOllamaSettings(JSON.stringify({ apiKey: 'x'.repeat(5000), model: 'bad model!' }));
    expect(settings).toEqual({ apiKey: '', model: '' });
    expect(parseOllamaSettings(JSON.stringify({ apiKey: 'key', model: 'qwen3.5:397b' })).model).toBe('qwen3.5:397b');
  });

  it('reads and clears the stored legacy value', () => {
    window.localStorage.setItem(OLLAMA_STORAGE_KEY, JSON.stringify({ apiKey: 'legacy-key', model: 'gpt-oss:120b' }));
    expect(readLegacyOllamaSettings()).toEqual({ apiKey: 'legacy-key', model: 'gpt-oss:120b' });
    clearLegacyOllamaSettings();
    expect(readLegacyOllamaSettings()).toEqual({ apiKey: '', model: '' });
  });
});
