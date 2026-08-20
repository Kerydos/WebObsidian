import { useRef, useState } from 'react';
import { BadgeCheck, Cloud, Cpu, Eye, EyeOff, KeyRound, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import { listCloudModels, saveOllamaSettings, type CloudModelSummary, type OllamaServerSettings } from '../lib/ai/ollamaCloud';

interface OllamaSettingsSectionProps {
  settings: OllamaServerSettings;
  onUpdated: (settings: OllamaServerSettings) => void;
}

type ModelsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; models: CloudModelSummary[] };

// Ollama Cloud 연동 설정. API 키와 모델은 서버에 저장되어 로그인한 모든 브라우저가 함께 사용한다.
export function OllamaSettingsSection({ settings, onUpdated }: OllamaSettingsSectionProps) {
  const [keyDraft, setKeyDraft] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [keySaving, setKeySaving] = useState(false);
  const [keyError, setKeyError] = useState<string>();
  const [modelDraft, setModelDraft] = useState(settings.model);
  const [modelError, setModelError] = useState<string>();
  const [modelsState, setModelsState] = useState<ModelsState>({ status: 'idle' });

  const saveKey = async (apiKey: string | null) => {
    if (apiKey !== null && !apiKey.trim()) {
      setKeyError('API 키를 입력해 주세요.');
      return;
    }
    setKeySaving(true);
    setKeyError(undefined);
    try {
      onUpdated(await saveOllamaSettings(apiKey === null ? { apiKey: null } : { apiKey: apiKey.trim() }));
      if (apiKey !== null) setKeyDraft('');
      setModelsState({ status: 'idle' });
    } catch (cause) {
      setKeyError(cause instanceof Error ? cause.message : 'API 키를 저장하지 못했습니다.');
    } finally {
      setKeySaving(false);
    }
  };

  const saveModel = async (model: string) => {
    setModelError(undefined);
    try {
      const updated = await saveOllamaSettings({ model });
      onUpdated(updated);
      setModelDraft(updated.model);
    } catch (cause) {
      setModelError(cause instanceof Error ? cause.message : '모델을 저장하지 못했습니다.');
    }
  };

  // 직접 입력은 노트 자동 저장과 같이 입력을 멈춘 뒤 저장한다.
  const modelTimerRef = useRef<number | null>(null);

  const handleModelDraftChange = (value: string) => {
    setModelDraft(value);
    if (value.trim() === settings.model) return;
    if (modelTimerRef.current !== null) window.clearTimeout(modelTimerRef.current);
    modelTimerRef.current = window.setTimeout(() => void saveModel(value.trim()), 600);
  };

  const loadModels = async () => {
    if (modelsState.status === 'loading') return;
    if (!settings.hasApiKey) {
      setModelsState({ status: 'error', message: '먼저 API 키를 서버에 저장해 주세요.' });
      return;
    }
    setModelsState({ status: 'loading' });
    try {
      const models = await listCloudModels();
      if (models.length === 0) {
        setModelsState({ status: 'error', message: '계정에서 사용할 수 있는 클라우드 모델이 없습니다.' });
        return;
      }
      setModelsState({ status: 'loaded', models });
      if (!settings.model) void saveModel(models[0].name);
    } catch (cause) {
      setModelsState({
        status: 'error',
        message: cause instanceof Error ? cause.message : '모델 목록을 가져오지 못했습니다.',
      });
    }
  };

  const fetchedModels = modelsState.status === 'loaded' ? modelsState.models : [];
  const savedOnly = settings.model && !fetchedModels.some((model) => model.name === settings.model)
    ? [{ name: settings.model, parameterSize: '' }]
    : [];
  const options = [...savedOnly, ...fetchedModels];

  return (
    <>
      <fieldset className="settings-section">
        <legend><Cloud size={16} /> Ollama Cloud 연결</legend>
        <div className="settings-row">
          <span>
            <strong><KeyRound size={14} /> 서버에 저장된 API 키</strong>
            <small>모든 브라우저에서 함께 사용됩니다. 키 원문은 다시 표시되지 않습니다.</small>
          </span>
          {settings.hasApiKey ? (
            <span className="key-status" data-variant="ok"><BadgeCheck size={14} /> {settings.apiKeyHint}</span>
          ) : (
            <span className="key-status" data-variant="none">미설정</span>
          )}
        </div>
        <label className="settings-row ollama-key-row">
          <span>
            <strong>{settings.hasApiKey ? '새 API 키로 교체' : 'API 키 입력'}</strong>
            <small>키는 <a href="https://ollama.com/settings/keys" target="_blank" rel="noreferrer">ollama.com/settings/keys</a>에서 만들 수 있습니다.</small>
          </span>
          <span className="api-key-control">
            <input
              className="settings-input"
              type={keyVisible ? 'text' : 'password'}
              value={keyDraft}
              onChange={(event) => setKeyDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void saveKey(keyDraft);
                }
              }}
              placeholder="API 키를 입력하세요"
              autoComplete="off"
              spellCheck={false}
              aria-label="Ollama Cloud API 키"
            />
            <button
              type="button"
              className="api-key-toggle"
              onClick={() => setKeyVisible((visible) => !visible)}
              aria-label={keyVisible ? 'API 키 숨기기' : 'API 키 표시'}
            >
              {keyVisible ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            <button
              type="button"
              className="fetch-button"
              onClick={() => void saveKey(keyDraft)}
              disabled={keySaving || !keyDraft.trim()}
            >
              {keySaving ? <LoaderCircle size={14} className="spin" /> : null}
              저장
            </button>
          </span>
        </label>
        {settings.hasApiKey ? (
          <button type="button" className="key-remove" onClick={() => void saveKey(null)} disabled={keySaving}>
            <Trash2 size={13} /> 저장된 키 삭제
          </button>
        ) : null}
        {keyError ? <p className="model-status" data-variant="error">{keyError}</p> : null}
      </fieldset>

      <fieldset className="settings-section">
        <legend><Cpu size={16} /> 모델</legend>
        <div className="settings-row">
          <span>
            <strong>모델 선택</strong>
            <small>선택한 모델도 서버에 저장되어 모든 브라우저에 적용됩니다.</small>
          </span>
          <button
            type="button"
            className="fetch-button"
            onClick={() => void loadModels()}
            disabled={modelsState.status === 'loading'}
          >
            {modelsState.status === 'loading' ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
            모델 목록 불러오기
          </button>
        </div>
        <label className="model-row">
          <span>목록에서 선택</span>
          <select
            value={fetchedModels.some((model) => model.name === settings.model) ? settings.model : ''}
            onChange={(event) => {
              if (event.target.value) {
                setModelDraft(event.target.value);
                void saveModel(event.target.value);
              }
            }}
            disabled={options.length === 0}
          >
            {options.length === 0 ? <option value="">모델 목록을 먼저 불러와 주세요</option> : null}
            {options.map((model) => (
              <option key={model.name} value={model.name}>
                {model.parameterSize ? `${model.name} · ${model.parameterSize}` : model.name}
              </option>
            ))}
          </select>
        </label>
        <label className="model-row">
          <span>또는 직접 입력</span>
          <input
            className="settings-input"
            type="text"
            value={modelDraft}
            onChange={(event) => handleModelDraftChange(event.target.value)}
            placeholder="예: gpt-oss:120b"
            spellCheck={false}
            aria-label="모델 이름 직접 입력"
          />
        </label>
        {modelError ? <p className="model-status" data-variant="error">{modelError}</p> : null}
        {modelsState.status === 'error' ? (
          <p className="model-status" data-variant="error">{modelsState.message}</p>
        ) : null}
        {modelsState.status === 'loaded' ? (
          <p className="model-status" data-variant="ok">연결 성공 · 클라우드 모델 {modelsState.models.length}개를 불러왔습니다.</p>
        ) : null}
      </fieldset>
    </>
  );
}
