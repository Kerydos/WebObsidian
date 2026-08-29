import { useEffect, useState } from 'react';
import { APPEARANCE_STORAGE_KEY, parseAppearance, type AppearanceSettings } from '../lib/settings/appearance';

function readStoredAppearance(): AppearanceSettings {
  try {
    return parseAppearance(window.localStorage.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return parseAppearance(null);
  }
}

// 브라우저에 유지되는 테마·글꼴·문서 스타일 설정. 변경 즉시 localStorage에 저장한다.
export function useAppearanceTheme() {
  const [appearance, setAppearance] = useState<AppearanceSettings>(readStoredAppearance);

  useEffect(() => {
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
    } catch {
      // The setting still applies for this session when browser storage is unavailable.
    }
  }, [appearance]);

  return { appearance, setAppearance };
}
