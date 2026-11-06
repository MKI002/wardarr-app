// Applies the stored theme before React renders, so there is no flash.
// Runs as a module script, which the content security policy allows.
let pref = 'system';
try {
  pref = localStorage.getItem('wardarr.theme') ?? 'system';
} catch {
  // Storage may be unavailable; fall back to the system setting.
}
const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
