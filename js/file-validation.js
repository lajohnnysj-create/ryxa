// Shared file-validation utilities.
//
// Both Digital Products (js/products.js) and Course lesson files (js/course.js)
// upload user files to the same Cloudflare R2 bucket (configured via
// R2_BUCKET_NAME in Vercel env, currently 'ryxa-digital-products') via the
// /api/r2-upload-url presigned-URL flow, with the same 500MB-per-account
// shared cap. They both need the same validation: file extension allowlist,
// magic-byte content check, ZIP-bomb inspection, byte formatting. This
// module is the single source of truth so the two tools never drift.
//
// Exposes one global: window.FileValidation. Use it as:
//   var v = await FileValidation.validateFileType(file);
//   if (!v.ok) showModalAlert('File rejected', v.error);
//
// Loaded as a plain <script> before any code that uses it (see dashboard.html
// or wherever the script tags live).

(function() {
  'use strict';

  // ---------------------------------------------------------------------------
  // Hard limits (server-side caps in api/r2-upload-url.js are the source of truth)
  // ---------------------------------------------------------------------------
  var MAX_FILE_BYTES    = 1024 * 1024 * 1024;          // 1 GB
  var MAX_ACCOUNT_BYTES = 10 * 1024 * 1024 * 1024;     // 10 GB shared between
                                                       // Digital Products and Course Lesson Files
  // No per-product or per-lesson caps. The 10 GB account cap is the backstop.

  // ---------------------------------------------------------------------------
  // Allowed file extensions (lowercase)
  // ---------------------------------------------------------------------------
  // Same allowlist for both digital products and course lesson files.
  // Video formats (mp4/mov/webm) are intentionally NOT allowed - video
  // belongs in Course Builder via Bunny Stream, not in the downloadable-
  // files bucket.
  var ALLOWED_EXTS = [
    'pdf','epub','mobi','txt','md','docx','pages',
    'csv','xlsx','numbers',
    'pptx','key',
    'jpg','jpeg','png','gif','webp','svg',
    'psd','ai','indd','sketch','fig','afphoto','afdesign',
    'cube','3dl','lrtemplate','xmp','dng',
    'atn','abr','asl','tpl',
    'drp',
    'mp3','wav','aiff','m4a','flac',
    'otf','ttf','woff','woff2',
    'brush','brushset','procreate',
    'blend','obj','fbx','stl','glb','gltf',
    'zip','rar','7z'
  ];

  // ---------------------------------------------------------------------------
  // Magic byte signatures (file content type check)
  // ---------------------------------------------------------------------------
  // Stops trivial extension renames: someone changing virus.exe to virus.pdf
  // will fail the magic-byte check. Not foolproof (a crafted file with valid
  // magic bytes could still embed payload), but raises the bar materially.
  var MAGIC_BYTES = {
    pdf:  ['25504446'],
    zip:  ['504B0304', '504B0506', '504B0708'],
    rar:  ['526172211A0700', '526172211A070100'],
    '7z': ['377ABCAF271C'],
    png:  ['89504E470D0A1A0A'],
    gif:  ['474946383761', '474946383961'],
    jpg:  ['FFD8FF'],
    jpeg: ['FFD8FF'],
    webp: ['52494646'],
    docx: ['504B0304'],
    xlsx: ['504B0304'],
    pptx: ['504B0304'],
    epub: ['504B0304'],
    psd:  ['38425053'],
    mp3:  ['494433', 'FFFB', 'FFF3', 'FFF2'],
    wav:  ['52494646'],
    aiff: ['464F524D'],
    flac: ['664C6143'],
    m4a:  ['00000020667479704D344120', '0000001C667479704D344120'],
    otf:  ['4F54544F'],
    ttf:  ['00010000', '74727565'],
    woff: ['774F4646'],
    woff2:['774F4632'],
    brush:    ['504B0304'],
    brushset: ['504B0304'],
    procreate:['504B0304'],
    blend:['424C454E444552'],
    glb:  ['676C5446']
    // obj, fbx, stl, gltf, drp are text or proprietary binary; rely on extension only
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function formatBytes(bytes) {
    bytes = Number(bytes || 0);
    if (bytes === 0) return '0 MB';
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function slugify(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  }

  function readMagicBytes(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var bytes = new Uint8Array(e.target.result);
        var hex = '';
        for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0').toUpperCase();
        resolve(hex);
      };
      reader.onerror = function() { reject(new Error('Could not read file')); };
      reader.readAsArrayBuffer(file.slice(0, 16));
    });
  }

  async function validateFileType(file) {
    var name = file.name.toLowerCase();
    var ext = name.split('.').pop();
    if (ALLOWED_EXTS.indexOf(ext) === -1) {
      return { ok: false, error: 'File type ".' + ext + '" not allowed. Only ebooks, templates, presets, design files, and similar downloads are accepted.' };
    }
    var sigList = MAGIC_BYTES[ext];
    if (sigList) {
      try {
        var hex = await readMagicBytes(file);
        var matches = sigList.some(function(sig) { return hex.startsWith(sig); });
        if (!matches) return { ok: false, error: 'File "' + file.name + '" appears to be corrupt or its content does not match the .' + ext + ' extension.' };
      } catch (e) {
        return { ok: false, error: 'Could not verify file content. Please try again.' };
      }
    }
    return { ok: true };
  }

  async function inspectZipContents(file) {
    var BLOCKED = ['exe','msi','bat','cmd','com','scr','cpl','ps1','vbs','wsf','app','dmg','pkg','sh','run','bin','jar','apk','ipa','iso','html','htm'];
    try {
      var size = file.size;
      var readStart = Math.max(0, size - 65536);
      var buf = await file.slice(readStart).arrayBuffer();
      var text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      var pattern = new RegExp('[a-zA-Z0-9_\\-\\. /\\\\]+\\.(' + BLOCKED.join('|') + ')(?=\\x00|\\x01|\\x02|\\x03|PK)', 'gi');
      var matches = text.match(pattern);
      if (matches && matches.length > 0) {
        return { ok: false, error: 'ZIP file contains blocked file types (' + matches.slice(0, 3).join(', ') + '). Remove these and re-upload.' };
      }
      return { ok: true };
    } catch (e) {
      console.error('ZIP inspection failed:', e);
      return { ok: false, error: 'Could not inspect ZIP contents. Please try again or use an uncompressed file.' };
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  window.FileValidation = {
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    MAX_ACCOUNT_BYTES: MAX_ACCOUNT_BYTES,
    ALLOWED_EXTS: ALLOWED_EXTS,
    formatBytes: formatBytes,
    slugify: slugify,
    validateFileType: validateFileType,
    inspectZipContents: inspectZipContents
  };
})();
