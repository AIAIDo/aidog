# Dark / Light Theme — Design Spec

Date: 2026-03-10

## Summary

Add dark/light theme support to the aidog web dashboard using Tailwind CSS's `darkMode: 'class'` mechanism. The implementation uses CSS variables so no existing component files need color-class changes.

## Decisions

| Topic | Decision |
|---|---|
| Toggle placement | Top navigation bar, right side |
| Light theme style | Cool gray (slate-based, GitHub/Linear style) |
| Default | Follow OS `prefers-color-scheme`; user override persisted in `localStorage` |
| Implementation approach | CSS variables mapped to Tailwind tokens |

## Color System

`tailwind.config.js`: redefine `surface-*` colors as CSS variable references.

```js
surface: {
  950: 'var(--surface-950)',
  900: 'var(--surface-900)',
  800: 'var(--surface-800)',
  700: 'var(--surface-700)',
  600: 'var(--surface-600)',
}
```

`index.css`: two variable sets, dark as default, light via `:root.light`.

```css
:root {
  --surface-950: #020617;
  --surface-900: #0f172a;
  --surface-800: #1e293b;
  --surface-700: #334155;
  --surface-600: #475569;
  --body-bg: #0f172a;
  --body-text: #cbd5e1;
  --scrollbar-track: #1e293b;
  --scrollbar-thumb: #475569;
}

:root.light {
  --surface-950: #f8fafc;
  --surface-900: #f1f5f9;
  --surface-800: #ffffff;
  --surface-700: #e2e8f0;
  --surface-600: #cbd5e1;
  --body-bg: #f1f5f9;
  --body-text: #1e293b;
  --scrollbar-track: #f1f5f9;
  --scrollbar-thumb: #cbd5e1;
}
```

`primary-*` (amber) is unchanged across themes.

## Theme State Management

New file: `src/web/src/hooks/useTheme.js`

- On mount: read `localStorage.getItem('theme')` → fall back to `prefers-color-scheme`
- Apply: add `light` class to `<html>` for light mode; remove for dark mode
- Toggle: flip class + write to `localStorage`
- Return: `{ theme, toggleTheme }` — consumed directly in `App.jsx`, no context needed

## UI — Toggle Button

In `App.jsx` `Layout` component, add button to the right of `<header>`:

- Dark mode → show sun icon (☀️ SVG), tooltip "Switch to light"
- Light mode → show moon icon (🌙 SVG), tooltip "Switch to dark"
- Style: `text-slate-400 hover:text-slate-200 transition-colors`

## highlight.js

`App.jsx` currently imports `highlight.js/styles/github-dark.css` unconditionally. Fix: also import `highlight.js/styles/github.css` and override it for light mode:

```css
:root.light .hljs {
  /* github light theme overrides */
  background: transparent;
  color: #24292e;
}
```

Or dynamically swap the import based on theme — CSS override is simpler.

## Files Changed

| File | Change |
|---|---|
| `src/web/tailwind.config.js` | `surface-*` → CSS variable references |
| `src/web/src/index.css` | Add `:root` and `:root.light` variable blocks; update `body` styles |
| `src/web/src/hooks/useTheme.js` | New — theme hook |
| `src/web/src/App.jsx` | Wire `useTheme`; add toggle button to header |

No changes to any page or component files.
