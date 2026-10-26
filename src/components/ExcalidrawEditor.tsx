import { useEffect, useMemo, useRef, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { parseExcalidraw, serializeExcalidraw, type ExcalidrawScene } from '../lib/excalidraw';

interface ExcalidrawEditorProps {
  value: string;
  readOnly?: boolean;
  dark?: boolean;
  onChange: (value: string) => void;
}

export default function ExcalidrawEditor({ value, readOnly = false, dark = false, onChange }: ExcalidrawEditorProps) {
  // 에디터는 노트·모드가 바뀔 때마다 다시 마운트되므로 처음 값만 장면으로 읽는다.
  const [initialValue] = useState(value);
  const parsed = useMemo(() => {
    try { return { scene: parseExcalidraw(initialValue) }; }
    catch (cause) { return { error: cause instanceof Error ? cause.message : String(cause) }; }
  }, [initialValue]);

  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  const lastRef = useRef(initialValue);
  const pendingRef = useRef<ExcalidrawScene | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const flush = () => {
    window.clearTimeout(timerRef.current);
    const scene = pendingRef.current;
    pendingRef.current = null;
    if (!scene) return;
    const next = serializeExcalidraw(scene);
    if (next === lastRef.current) return;
    lastRef.current = next;
    onChangeRef.current(next);
  };
  // 언마운트(노트 전환) 직전에 남은 변경을 넘긴다.
  useEffect(() => flush, []);

  if ('error' in parsed) return <div className="center-state"><p>{parsed.error}</p></div>;

  return (
    <div className="excalidraw-host">
      <Excalidraw
        initialData={{ ...parsed.scene, scrollToContent: true } as never}
        viewModeEnabled={readOnly}
        theme={dark ? 'dark' : 'light'}
        langCode="ko-KR"
        onChange={(elements, appState, files) => {
          if (readOnly) return;
          // onChange는 포인터 이동마다 호출되므로 직렬화는 잠시 모았다가 한 번에 한다.
          pendingRef.current = { elements, appState: appState as unknown as Record<string, unknown>, files };
          window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(flush, 400);
        }}
      />
    </div>
  );
}
