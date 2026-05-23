// =============================================================================
// testimonials.js - Shared testimonials carousel for ryxa.io
//
// USAGE:
//   1. Add this placeholder where you want testimonials to appear:
//        <div id="site-testimonials"></div>
//   2. Load this script before </body>:
//        <script src="/js/testimonials.js"></script>
//
// The module is fully self-contained: it injects its own CSS, renders the
// cards from the TESTIMONIALS array below, and wires up its own arrow
// scrolling. It does NOT depend on index-page.js or any other script.
//
// TO ADD / EDIT A TESTIMONIAL:
//   Edit the TESTIMONIALS array below. That is the only place. Every page
//   with the <div id="site-testimonials"></div> placeholder updates at once.
//
//   Each entry:
//     photo  - image path (under /testimonials/)
//     color  - panel color class: 'c-magenta' | 'c-purple' | 'c-lime' | 'c-amber'
//     stars  - number of filled stars (1-5)
//     quote  - the testimonial text (no surrounding quotation marks needed)
//     name   - person's name
//     handle - their @handle
//
// OPTIONAL: override the section heading per page with a data attribute:
//   <div id="site-testimonials" data-heading="Loved by creators"></div>
// =============================================================================

(function () {
  'use strict';

  // ---- TESTIMONIAL DATA --------------------------------------------------
  // This is the single source of truth. Edit here, updates everywhere.
  var TESTIMONIALS = [
    {
      photo: 'testimonials/pinsta.jpg',
      color: 'c-magenta',
      stars: 5,
      quote: 'I was able to grow my audience as a content creator with Ryxa! The tools that they offer are unbeatable. It has certainly helped make things easier for me!',
      name: 'Pinhwa Su',
      handle: '@xo.pinsta'
    },
    {
      photo: 'testimonials/jaed.jpg',
      color: 'c-lime',
      stars: 5,
      quote: "Being a content creator is more than just posting... it's a business. Ryxa helps simplify that side of things and makes it easier to grow with purpose. I'd recommend it to anyone serious about leveling up!",
      name: 'Jaed',
      handle: '@jaed.official'
    },
    {
      photo: 'testimonials/john-v.jpg',
      color: 'c-amber',
      stars: 5,
      quote: 'Ryxa has a very intuitive UI and the UX is quite pleasant! Having a lot of fun using this platform to elevate my online presence!',
      name: 'John Nepomuceno',
      handle: '@jvbrwn'
    },
    {
      photo: 'testimonials/jennie.jpg',
      color: 'c-blue',
      stars: 5,
      quote: 'Ryxa is jam-packed with the tools that I need for my creativity! Highly recommend!',
      name: 'Jenny Jiang',
      handle: '@imjennime'
    },
    {
      photo: 'testimonials/dylan.jpg',
      color: 'c-purple',
      stars: 5,
      quote: "Ryxa is where it's at! The best and fastest way to elevate your branding.",
      name: 'Dylan Vasquez',
      handle: '@imdylanvasquez'
    }
  ];

  // ---- DEFAULT HEADING ---------------------------------------------------
  var DEFAULT_HEADING = 'Trusted by <span>creators</span> who<br>are serious about their business';

  // ---- CSS ---------------------------------------------------------------
  // Injected once. Mirrors the original index.html testimonial styles.
  var CSS = ''
    + '.testimonials-section{padding:70px 0;overflow:hidden;}'
    + '.testimonials-heading{font-family:"Plus Jakarta Sans",sans-serif;font-size:16px;font-weight:800;text-align:center;margin:0 auto 28px;color:#14111c;letter-spacing:-0.3px;padding:0 20px;width:100%;box-sizing:border-box;}'
    + '.testimonials-section.t-dark .testimonials-heading{color:#f0eef8;}'
    + '.testimonials-heading span{color:inherit;}'
    + '.testimonials-track-wrap{position:relative;max-width:1240px;margin:0 auto;overflow:hidden;}'
    + '.testimonials-track{display:flex;gap:20px;padding:8px 0;width:max-content;animation:testimonials-marquee 50s linear infinite;cursor:grab;user-select:none;will-change:transform;}'
    + '.testimonials-track.dragging{cursor:grabbing;}'
    + '.testimonials-track-wrap:hover .testimonials-track{animation-play-state:paused;}'
    + '@keyframes testimonials-marquee{from{transform:translateX(0);}to{transform:translateX(calc(-50% - 10px));}}'
    + '@media (prefers-reduced-motion: reduce){.testimonials-track{animation:none;}}'
    + '.testimonial-card{position:relative;width:380px;min-width:380px;min-height:500px;border-radius:20px;overflow:hidden;flex-shrink:0;display:flex;flex-direction:column;-webkit-backface-visibility:hidden;backface-visibility:hidden;transform:translateZ(0);}'
    + '.testimonial-card:focus-visible{outline:3px solid #b9158d;outline-offset:3px;}'
    + '.testimonials-controls{display:flex;justify-content:flex-end;margin-top:14px;padding:0 20px;max-width:1240px;margin-left:auto;margin-right:auto;box-sizing:border-box;}'
    + '.testimonials-pause-btn{display:inline-flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.04);border:1px solid rgba(0,0,0,0.12);color:#5b5b6b;border-radius:50%;width:40px;height:40px;padding:0;cursor:pointer;transition:all 0.2s;}'
    + '.testimonials-pause-btn svg{width:16px;height:16px;display:block;}'
    + '.testimonials-pause-btn:hover{color:#14111c;border-color:#b9158d;background:rgba(185,21,141,0.08);}'
    + '.testimonials-pause-btn:focus-visible{outline:2px solid #b9158d;outline-offset:2px;}'
    + '.testimonials-section.t-dark .testimonials-pause-btn{background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.14);color:rgba(255,255,255,0.85);}'
    + '.testimonials-section.t-dark .testimonials-pause-btn:hover{color:#fff;border-color:#a78bfa;background:rgba(124,58,237,0.18);}'
    + '.testimonial-photo{height:260px;background-size:cover;background-position:center top;flex-shrink:0;transition:transform 0.5s ease;-webkit-backface-visibility:hidden;backface-visibility:hidden;transform:translateZ(0);}'
    + '.testimonial-card:hover .testimonial-photo{transform:translateZ(0) scale(1.05);}'
    + '.testimonial-panel{flex:1;padding:24px 24px 26px;display:flex;flex-direction:column;text-align:left;}'
    + '.testimonial-stars{font-size:15px;letter-spacing:2px;margin-bottom:10px;}'
    + '.testimonial-quote{font-size:14px;line-height:1.6;margin:0 0 14px;font-style:italic;}'
    + '.testimonial-meta{margin-top:auto;}'
    + '.testimonial-name{font-size:14px;font-weight:700;}'
    + '.testimonial-handle{font-size:12px;font-weight:600;opacity:0.85;}'
    + '.testimonial-panel.c-magenta{background:#b9158d;color:#fff;}'
    + '.testimonial-panel.c-magenta .testimonial-stars{color:#fff;}'
    + '.testimonial-panel.c-purple{background:#5b21b6;color:#fff;}'
    + '.testimonial-panel.c-purple .testimonial-stars{color:#fff;}'
    + '.testimonial-panel.c-lime{background:#d4e157;color:#1a1a14;}'
    + '.testimonial-panel.c-lime .testimonial-stars{color:#1a1a14;}'
    + '.testimonial-panel.c-amber{background:#f59e0b;color:#1a1308;}'
    + '.testimonial-panel.c-amber .testimonial-stars{color:#1a1308;}'
    + '.testimonial-panel.c-blue{background:#2563eb;color:#fff;}'
    + '.testimonial-panel.c-blue .testimonial-stars{color:#fff;}'
    + '@media (max-width:600px){'
    +   '.testimonials-heading{font-size:13px;letter-spacing:-0.2px;margin-bottom:20px;}'
    +   '.testimonial-card{width:300px;min-width:300px;min-height:470px;}'
    +   '.testimonial-photo{height:210px;}'
    +   '.testimonial-panel{padding:20px 20px 22px;}'
    +   '.testimonials-track{gap:16px;}'
    +   '.testimonial-arrow{width:34px;height:34px;}'
    +   '.testimonials-track-wrap{padding:0 12px;gap:8px;}'
    + '}';

  // ---- HELPERS -----------------------------------------------------------
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function starString(n) {
    var count = Math.max(0, Math.min(5, parseInt(n, 10) || 0));
    var out = '';
    for (var i = 0; i < count; i++) { out += '\u2605'; }
    return out;
  }

  function cardHtml(t) {
    var label = (t.name || '') + ', ' + (t.stars || 0) + ' stars: ' + (t.quote || '');
    return ''
      + '<div class="testimonial-card" role="listitem" tabindex="0" aria-label="' + escapeHtml(label) + '">'
      +   '<div class="testimonial-photo" style="background-image:url(\'' + escapeHtml(t.photo) + '\');" aria-hidden="true"></div>'
      +   '<div class="testimonial-panel ' + escapeHtml(t.color || 'c-magenta') + '">'
      +     '<div class="testimonial-stars" aria-hidden="true">' + starString(t.stars) + '</div>'
      +     '<p class="testimonial-quote">"' + escapeHtml(t.quote) + '"</p>'
      +     '<div class="testimonial-meta">'
      +       '<div class="testimonial-name">' + escapeHtml(t.name) + '</div>'
      +       '<div class="testimonial-handle">' + escapeHtml(t.handle) + '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  // ---- RENDER ------------------------------------------------------------
  function render() {
    var mount = document.getElementById('site-testimonials');
    if (!mount) return;            // page does not use testimonials, nothing to do
    if (!TESTIMONIALS.length) return;

    // Inject CSS once.
    if (!document.getElementById('site-testimonials-css')) {
      var style = document.createElement('style');
      style.id = 'site-testimonials-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    var heading = mount.getAttribute('data-heading');
    var headingHtml = heading ? escapeHtml(heading) : DEFAULT_HEADING;

    // Optional dark theme: <div id="site-testimonials" data-theme="dark">
    var sectionClass = 'testimonials-section';
    if (mount.getAttribute('data-theme') === 'dark') {
      sectionClass += ' t-dark';
    }

    var cards = '';
    for (var i = 0; i < TESTIMONIALS.length; i++) {
      cards += cardHtml(TESTIMONIALS[i]);
    }
    // Duplicate the set for a seamless marquee loop. The animation translates
    // the track by -50%, which lands exactly on the start of the second copy,
    // so the jump back to 0 is invisible. The second copy is aria-hidden so
    // screen readers do not announce each testimonial twice.
    var marqueeCards = cards + '<div aria-hidden="true" style="display:contents;">' + cards + '</div>';

    mount.innerHTML = ''
      + '<section class="' + sectionClass + '" role="region" aria-roledescription="carousel" aria-label="' + escapeHtml(heading || 'Customer testimonials') + '">'
      +   '<h2 class="testimonials-heading">' + headingHtml + '</h2>'
      +   '<div class="testimonials-track-wrap">'
      +     '<div class="testimonials-track" id="site-testimonials-track" role="list">' + marqueeCards + '</div>'
      +   '</div>'
      +   '<div class="testimonials-controls">'
      +     '<button type="button" class="testimonials-pause-btn" id="site-testimonials-pause" aria-pressed="false" aria-label="Pause testimonials">'
      +       '<svg class="testimonials-pause-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
      +         '<rect x="6" y="5" width="4" height="14" rx="1"></rect>'
      +         '<rect x="14" y="5" width="4" height="14" rx="1"></rect>'
      +       '</svg>'
      +     '</button>'
      +   '</div>'
      + '</section>';

    // ---- DRAG-TO-SCROLL -----------------------------------------------------
    // The marquee animates transform:translateX continuously. Drag manipulates
    // the same property, so the two cannot coexist live: we pause the animation
    // on drag-start, apply manual transform during drag, then resume the
    // animation from the dragged position on drag-end.
    //
    // Continuous wrapping: the marquee loops over a distance of `loopWidthPx`
    // (one full set of cards plus one gap). During drag we keep the transform
    // normalized into the range (-loopWidthPx, 0] by adding/subtracting
    // loopWidthPx whenever we cross a boundary. That way the user can drag
    // left or right indefinitely and the cards keep scrolling like a real
    // conveyor belt instead of jumping when the transform goes out of range.
    var track = document.getElementById('site-testimonials-track');
    if (!track) return;

    var isDown = false;
    var lastX = 0;
    var currentTranslate = 0;
    var loopWidthPx = 0;

    function computeLoopWidth() {
      // The track contains two identical sets of cards. Half the scrollWidth
      // is one set, plus 10px (half a gap) to match the keyframes offset.
      return track.scrollWidth / 2 + 10;
    }

    function readCurrentTranslate() {
      var t = window.getComputedStyle(track).transform;
      if (!t || t === 'none') return 0;
      // matrix(a, b, c, d, tx, ty), where tx is index 4
      var m = t.match(/matrix.*\((.+)\)/);
      if (!m) return 0;
      var parts = m[1].split(', ');
      return parseFloat(parts[4]) || 0;
    }

    function normalize(t) {
      if (loopWidthPx <= 0) return t;
      while (t > 0) t -= loopWidthPx;
      while (t < -loopWidthPx) t += loopWidthPx;
      return t;
    }

    // ---- PAUSE STATE & PRIMITIVES ------------------------------------------
    // Pause sources:
    //   - manual (sticky): user clicks Pause button, OR user finishes a drag.
    //     Stays paused until the user clicks Play.
    //   - focus (transient): keyboard focus on a card; auto-resumes on blur.
    //   - drag (transient, during the drag motion itself).
    // Hover-pause is pure CSS and composes automatically.
    var manualPaused = false;
    var focusPaused = false;

    function freezeAtCurrent() {
      if (loopWidthPx <= 0) loopWidthPx = computeLoopWidth();
      currentTranslate = normalize(readCurrentTranslate());
      track.style.animation = 'none';
      track.style.transform = 'translateX(' + currentTranslate + 'px)';
    }

    function resumeAnim() {
      // Only resume if no source still wants pause.
      if (manualPaused || focusPaused || isDown) return;
      var width = loopWidthPx > 0 ? loopWidthPx : computeLoopWidth();
      var pct = -currentTranslate / width;
      var delay = -(pct * 50);
      track.style.transform = '';
      track.style.animation = '';
      track.style.animationDelay = delay + 's';
    }

    // Pause button setup (icons + click handler). updateButtonUi keeps the
    // SVG icon, aria-pressed, and aria-label in sync with manualPaused.
    var pauseBtn = document.getElementById('site-testimonials-pause');
    var iconEl = pauseBtn ? pauseBtn.querySelector('.testimonials-pause-icon') : null;
    var PAUSE_SVG = '<rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect>';
    var PLAY_SVG = '<path d="M8 5v14l11-7z"></path>';

    function updateButtonUi() {
      if (!pauseBtn) return;
      pauseBtn.setAttribute('aria-pressed', manualPaused ? 'true' : 'false');
      pauseBtn.setAttribute('aria-label', manualPaused ? 'Play testimonials' : 'Pause testimonials');
      if (iconEl) iconEl.innerHTML = manualPaused ? PLAY_SVG : PAUSE_SVG;
    }

    // Shared setter so drag-end and button click both pause/resume the same
    // way and keep the visible button UI in sync.
    function setManualPaused(paused) {
      manualPaused = paused;
      updateButtonUi();
      if (paused) {
        freezeAtCurrent();
      } else {
        resumeAnim();
      }
    }

    if (pauseBtn) {
      pauseBtn.addEventListener('click', function () {
        setManualPaused(!manualPaused);
      });
    }

    // ---- DRAG --------------------------------------------------------------
    // Drag-end leaves the marquee in manual-pause state (button shows Play).
    // The user resumes by clicking Play. This sidesteps iOS touchend quirks
    // entirely: we never need to auto-resume after a touch.
    function onDown(e) {
      isDown = true;
      track.classList.add('dragging');
      loopWidthPx = computeLoopWidth();
      currentTranslate = normalize(readCurrentTranslate());
      lastX = (e.touches ? e.touches[0].pageX : e.pageX);
      track.style.animation = 'none';
      track.style.transform = 'translateX(' + currentTranslate + 'px)';
      if (e.preventDefault) e.preventDefault();
    }

    // Block the browser's native drag operation entirely on the track.
    track.addEventListener('dragstart', function (e) { e.preventDefault(); });
    track.addEventListener('selectstart', function (e) { e.preventDefault(); });

    function onMove(e) {
      if (!isDown) return;
      var isTouch = !!e.touches;
      var x = (isTouch ? e.touches[0].pageX : e.pageX);
      var dx = x - lastX;
      lastX = x;
      // Touch drag feels sluggish at 1:1 because finger contact patches are
      // imprecise. A small multiplier (1.3x) makes mobile swipes feel snappier
      // without overshooting. Desktop mouse stays at 1:1 since pointer accuracy
      // is already precise.
      if (isTouch) dx *= 1.3;
      currentTranslate = normalize(currentTranslate + dx);
      track.style.transform = 'translateX(' + currentTranslate + 'px)';
    }

    function onUp() {
      if (!isDown) return;
      isDown = false;
      track.classList.remove('dragging');
      // Drag-end always leaves the marquee in manual-pause state. The user
      // can resume by clicking Play. This avoids needing to chase iOS
      // touchend reliability issues across browser/OS versions.
      setManualPaused(true);
    }

    track.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    track.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchcancel', onUp);

    // ---- KEYBOARD FOCUS PAUSE (WCAG 2.2.2 compliance) ----------------------
    // When any card receives focus, pause; resume on focus leaving the wrap.
    var wrap = track.parentNode;
    if (wrap) {
      wrap.addEventListener('focusin', function () {
        if (focusPaused) return;
        focusPaused = true;
        freezeAtCurrent();
      });
      wrap.addEventListener('focusout', function (e) {
        if (e.relatedTarget && wrap.contains(e.relatedTarget)) return;
        focusPaused = false;
        resumeAnim();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
