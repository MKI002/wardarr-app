export type ThemePref = 'system' | 'dark' | 'light';

let media: MediaQueryList | null = null;
let listener: (() => void) | null = null;

/** Applies a theme preference; `system` follows the OS setting live. */
export function applyTheme(pref: ThemePref): void {
  try {
    localStorage.setItem('wardarr.theme', pref);
  } catch {
    // Storage may be unavailable.
  }
  media ??= matchMedia('(prefers-color-scheme: dark)');
  if (listener) media.removeEventListener('change', listener);
  const set = () => {
    const dark = pref === 'dark' || (pref === 'system' && media!.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e0f16' : '#f6f6fb');
  };
  listener = pref === 'system' ? set : null;
  if (listener) media.addEventListener('change', listener);
  set();
}
