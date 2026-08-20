import { useEffect, useRef, useState } from 'react';
import { Bot, ClipboardCopy, CornerDownLeft, FileInput, LoaderCircle, RotateCcw, Settings2, Square, X } from 'lucide-react';
import { streamCloudChat, type ChatMessage, type OllamaServerSettings } from '../lib/ai/ollamaCloud';

interface AssistantPanelProps {
  open: boolean;
  settings: OllamaServerSettings;
  noteTitle?: string;
  noteContent: string;
  onOpenSettings: () => void;
  onInsertToNote: (text: string) => void;
  onClose: () => void;
}

type ConversationMessage = { role: 'user' | 'assistant'; content: string };

const maxNoteContextLength = 8000;
const maxHistoryMessages = 20;

const assistantPrompt =
  '당신은 노트 앱 WebObsidian에 통합된 한국어 AI 비서입니다. 노트 작성, 요약, 정리, 아이디어 확장을 돕고 필요할 때 Markdown 서식으로 답합니다.';

// Ollama Cloud 모델과 대화하며 답변을 노트에 삽입할 수 있는 AI 도우미 패널.
export function AssistantPanel({ open, settings, noteTitle, noteContent, onOpenSettings, onInsertToNote, onClose }: AssistantPanelProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState('');
  const [includeNote, setIncludeNote] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  // 패널을 닫으면 진행 중인 응답도 취소한다. 상태는 유지해 다시 열 때 대화를 이어간다.
  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);

  if (!open) return null;
  const configured = settings.hasApiKey && settings.model !== '';

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || streaming || !configured) return;
    setError(undefined);
    setInput('');
    const history: ConversationMessage[] = [...messages, { role: 'user', content: prompt }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const request: ChatMessage[] = [{ role: 'system', content: assistantPrompt }];
    if (includeNote && noteTitle) {
      const clipped = noteContent.length > maxNoteContextLength
        ? `${noteContent.slice(0, maxNoteContextLength)}\n…(이하 생략)`
        : noteContent;
      request[0].content += `\n\n참고로 사용자가 현재 열어 둔 노트 "${noteTitle}"의 내용은 다음과 같습니다.\n\n${clipped}`;
    }
    request.push(...history.slice(-maxHistoryMessages));

    try {
      await streamCloudChat({
        model: settings.model,
        messages: request,
        signal: controller.signal,
        onDelta: (delta) => setMessages((current) => {
          if (current.length === 0) return current;
          const last = current[current.length - 1];
          if (last.role !== 'assistant') return current;
          return [...current.slice(0, -1), { role: 'assistant', content: last.content + delta }];
        }),
      });
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(cause instanceof Error ? cause.message : '응답을 받아오지 못했습니다.');
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 클립보드 권한이 없으면 조용히 무시한다.
    }
  };

  return (
    <aside className="assistant-panel" aria-label="AI 도우미">
      <header className="assistant-heading">
        <div>
          <span>OLLAMA CLOUD</span>
          <strong>AI 도우미</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="AI 도우미 닫기"><X size={18} /></button>
      </header>

      {!configured ? (
        <div className="assistant-empty">
          <Bot size={28} />
          <p>서버에 Ollama Cloud API 키와 모델을 저장하면 이 패널에서 AI의 도움을 받아 노트를 작성할 수 있습니다. 설정은 로그인한 모든 브라우저에서 함께 사용됩니다.</p>
          <button type="button" onClick={onOpenSettings}><Settings2 size={15} /> Ollama Cloud 설정 열기</button>
        </div>
      ) : (
        <>
          <div className="assistant-meta">
            <span className="assistant-model"><Bot size={13} /> {settings.model}</span>
            <label className="assistant-context-toggle">
              <input
                type="checkbox"
                checked={includeNote && Boolean(noteTitle)}
                onChange={(event) => setIncludeNote(event.target.checked)}
                disabled={!noteTitle}
              />
              {noteTitle ? `현재 노트 참조: ${noteTitle}` : '참조할 노트 없음'}
            </label>
          </div>

          <div className="assistant-messages" ref={scrollRef}>
            {messages.length === 0 ? (
              <p className="assistant-hint">노트 내용을 요약하거나, 이어 쓸 문장, 아이디어를 부탁해 보세요. 답변은 현재 노트에 바로 삽입할 수 있습니다.</p>
            ) : (
              messages.map((message, index) => (
                <div key={index} className="assistant-bubble" data-role={message.role}>
                  {message.content || (streaming && index === messages.length - 1 ? <LoaderCircle className="spin" size={14} /> : '…')}
                  {message.role === 'assistant' && message.content ? (
                    <span className="assistant-bubble-actions">
                      <button type="button" onClick={() => onInsertToNote(message.content)} disabled={!noteTitle} title={noteTitle ? '현재 노트 끝에 삽입' : '노트를 먼저 열어 주세요'}>
                        <FileInput size={13} /> 노트에 삽입
                      </button>
                      <button type="button" onClick={() => void copy(message.content)}><ClipboardCopy size={13} /> 복사</button>
                    </span>
                  ) : null}
                </div>
              ))
            )}
            {error ? <p className="assistant-error" role="alert">{error}</p> : null}
          </div>

          <footer className="assistant-composer">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={streaming ? '응답 생성 중…' : '무엇을 도와드릴까요? (Enter 전송, Shift+Enter 줄바꿈)'}
              disabled={streaming}
              aria-label="AI 도우미 메시지"
            />
            <div className="assistant-actions">
              {streaming ? (
                <button type="button" className="assistant-stop" onClick={stop}><Square size={13} /> 중지</button>
              ) : (
                <button type="button" className="assistant-send" onClick={() => void send()} disabled={!input.trim()}>
                  <CornerDownLeft size={14} /> 보내기
                </button>
              )}
              {messages.length > 0 ? (
                <button type="button" className="assistant-clear" onClick={() => setMessages([])}><RotateCcw size={13} /> 대화 초기화</button>
              ) : null}
            </div>
          </footer>
        </>
      )}
    </aside>
  );
}

