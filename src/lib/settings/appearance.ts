import type { CSSProperties } from 'react';

export type ColorTheme = 'paper' | 'light' | 'dark';
export type FontChoice = 'sans' | 'serif' | 'mono';
export type CodeFontChoice = 'system' | 'classic';
export type DocumentStyle = 'comfortable' | 'compact' | 'wide';

export interface AppearanceSettings {
  theme: ColorTheme;
  bodyFont: FontChoice;
  headingFont: FontChoice;
  codeFont: CodeFontChoice;
  documentStyle: DocumentStyle;
  fontSize: number;
  lineHeight: number;
  accent: string;
}

export const APPEARANCE_STORAGE_KEY = 'webobsidian:appearance:v1';

export const defaultAppearance: AppearanceSettings = {
  theme: 'paper',
  bodyFont: 'sans',
  headingFont: 'sans',
  codeFont: 'system',
  documentStyle: 'comfortable',
  fontSize: 16,
  lineHeight: 1.8,
  accent: '#bf5f3b',
};

const themes = new Set<ColorTheme>(['paper', 'light', 'dark']);
const fonts = new Set<FontChoice>(['sans', 'serif', 'mono']);
const codeFonts = new Set<CodeFontChoice>(['system', 'classic']);
const documentStyles = new Set<DocumentStyle>(['comfortable', 'compact', 'wide']);
const colorPattern = /^#[\da-f]{6}$/i;

function boundedNumber(value: unknown, minimum: number, maximum: number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

export function parseAppearance(value: string | null): AppearanceSettings {
  if (!value) return defaultAppearance;
  try {
    const parsed = JSON.parse(value) as Partial<AppearanceSettings>;
    return {
      theme: themes.has(parsed.theme as ColorTheme) ? parsed.theme as ColorTheme : defaultAppearance.theme,
      bodyFont: fonts.has(parsed.bodyFont as FontChoice) ? parsed.bodyFont as FontChoice : defaultAppearance.bodyFont,
      headingFont: fonts.has(parsed.headingFont as FontChoice) ? parsed.headingFont as FontChoice : defaultAppearance.headingFont,
      codeFont: codeFonts.has(parsed.codeFont as CodeFontChoice) ? parsed.codeFont as CodeFontChoice : defaultAppearance.codeFont,
      documentStyle: documentStyles.has(parsed.documentStyle as DocumentStyle) ? parsed.documentStyle as DocumentStyle : defaultAppearance.documentStyle,
      fontSize: boundedNumber(parsed.fontSize, 14, 22, defaultAppearance.fontSize),
      lineHeight: boundedNumber(parsed.lineHeight, 1.4, 2.2, defaultAppearance.lineHeight),
      accent: typeof parsed.accent === 'string' && colorPattern.test(parsed.accent) ? parsed.accent : defaultAppearance.accent,
    };
  } catch {
    return defaultAppearance;
  }
}

const fontStacks: Record<FontChoice, string> = {
  sans: "Pretendard, 'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  serif: "'Noto Serif KR', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif",
  mono: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
};

const codeFontStacks: Record<CodeFontChoice, string> = {
  system: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
  classic: "'Courier New', Courier, monospace",
};

const styleWidths: Record<DocumentStyle, string> = {
  comfortable: '860px',
  compact: '760px',
  wide: '1080px',
};

type AppearanceVariables = CSSProperties & Record<`--${string}`, string | number>;

export function appearanceVariables(settings: AppearanceSettings): AppearanceVariables {
  return {
    '--font-markdown': fontStacks[settings.bodyFont],
    '--font-heading': fontStacks[settings.headingFont],
    '--font-code': codeFontStacks[settings.codeFont],
    '--markdown-font-size': `${settings.fontSize}px`,
    '--markdown-line-height': settings.lineHeight,
    '--editor-width': styleWidths[settings.documentStyle],
    '--accent': settings.accent,
  };
}
