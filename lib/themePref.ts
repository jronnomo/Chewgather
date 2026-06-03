// Device-level mirror of the dark-mode preference.
//
// The app's theme is a manual toggle (`preferences.isDarkMode`), surfaced through
// ThemeContext's `useColors()`. But some surfaces render OUTSIDE the provider tree
// — notably the top-level ErrorBoundary fallback in `app/_layout.tsx`, which is a
// class component mounted above AppProvider/ThemeProvider and so cannot call
// `useColors()`. AppContext mirrors the current value here so those provider-less
// surfaces can still theme correctly. (F-009-002)
let darkMode = false;

export function setDarkModePref(value: boolean): void {
  darkMode = value;
}

export function getDarkModePref(): boolean {
  return darkMode;
}
