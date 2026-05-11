// =============================================================================
// /js/pdfjs-loader.js — PDF.js library loader
// -----------------------------------------------------------------------------
// PDF.js is loaded from a CDN as an ES module. Tools that use PDF.js (currently
// PDF Sign and Contract Analyzer) wait on window.__pdfjsReady before using
// pdfjsLib, which is set on window when this module finishes importing.
//
// This file replaces two inline <script> blocks that previously lived at the
// top of dashboard.html — extracted 2026-05-11 so dashboard.html has zero
// inline script blocks and can deploy with strict CSP (no 'unsafe-inline'
// for script-src).
//
// Load as: <script type="module" src="/js/pdfjs-loader.js"></script>
// =============================================================================

// Create the ready promise FIRST so any tool script that runs before the
// module import completes can still await on it.
window.__pdfjsReady = new Promise((resolve) => {
  window.__resolvePdfjs = resolve;
});

import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
window.pdfjsLib = pdfjsLib;
window.__resolvePdfjs(pdfjsLib);
