// Raw build-stamp parts injected by Vite `define` (see vite.config.js) — the
// footer renders the combined __APP_VERSION__ string; feedback events attach
// these separately. `typeof` guards keep this module importable outside Vite
// (e.g. the Node self-check), where the defines are never applied.
/* global __PKG_VERSION__, __COMMIT_SHA__ */
export const PKG_VERSION = typeof __PKG_VERSION__ !== 'undefined' ? __PKG_VERSION__ : 'dev'
export const COMMIT_SHA = typeof __COMMIT_SHA__ !== 'undefined' ? __COMMIT_SHA__ : 'dev'
