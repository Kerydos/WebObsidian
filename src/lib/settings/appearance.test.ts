import { describe, expect, it } from 'vitest';
import { appearanceVariables, defaultAppearance, parseAppearance } from './appearance';

describe('appearance settings', () => {
  it('returns defaults for missing or malformed data', () => {
    expect(parseAppearance(null)).toEqual(defaultAppearance);
    expect(parseAppearance('{bad json')).toEqual(defaultAppearance);
  });

  it('keeps valid settings', () => {
    const settings = parseAppearance(JSON.stringify({
      theme: 'dark', bodyFont: 'serif', headingFont: 'mono', codeFont: 'classic',
      documentStyle: 'wide', fontSize: 19, lineHeight: 2, accent: '#3366aa',
    }));
    expect(settings).toMatchObject({ theme: 'dark', bodyFont: 'serif', documentStyle: 'wide', fontSize: 19, accent: '#3366aa' });
  });

  it('rejects unknown choices and bounds numeric values', () => {
    const settings = parseAppearance(JSON.stringify({ theme: 'neon', fontSize: 99, lineHeight: 0, accent: 'red' }));
    expect(settings.theme).toBe(defaultAppearance.theme);
    expect(settings.fontSize).toBe(22);
    expect(settings.lineHeight).toBe(1.4);
    expect(settings.accent).toBe(defaultAppearance.accent);
  });

  it('maps settings to editor variables', () => {
    const variables = appearanceVariables({ ...defaultAppearance, bodyFont: 'serif', fontSize: 18, documentStyle: 'compact' });
    expect(variables['--font-markdown']).toContain('Noto Serif KR');
    expect(variables['--markdown-font-size']).toBe('18px');
    expect(variables['--editor-width']).toBe('760px');
  });
});
