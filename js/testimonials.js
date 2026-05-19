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
      photo: 'testimonials/jennie.jpg',
      color: 'c-blue',
      stars: 5,
      quote: 'Ryxa is jam-packed with the tools that I need for my creativity! Highly recommend!',
      name: 'Jenny Jiang',
      handle: '@imjennime'
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
    + '.testimonials-section.t-dark .testimonial-arrow{background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.14);color:rgba(255,255,255,0.7);}'
    + '.testimonials-section.t-dark .testimonial-arrow:hover{color:#fff;border-color:#a78bfa;background:rgba(124,58,237,0.18);}'
    + '.testimonials-heading span{color:inherit;}'
    + '.testimonials-track-wrap{position:relative;display:flex;align-items:center;gap:12px;padding:0 20px;max-width:1240px;margin:0 auto;}'
    + '.testimonials-track{display:flex;gap:20px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;scrollbar-width:none;-ms-overflow-style:none;padding:8px 0;flex:1;min-width:0;-webkit-overflow-scrolling:touch;}'
    + '.testimonials-track::-webkit-scrollbar{display:none;}'
    + '.testimonial-arrow{background:rgba(0,0,0,0.04);border:1px solid rgba(0,0,0,0.12);color:#5b5b6b;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:all 0.2s;z-index:2;}'
    + '.testimonial-arrow:hover{color:#14111c;border-color:#b9158d;background:rgba(185,21,141,0.08);}'
    + '.testimonial-card{position:relative;width:380px;min-width:380px;height:440px;border-radius:20px;overflow:hidden;flex-shrink:0;scroll-snap-align:center;scroll-snap-stop:always;display:flex;flex-direction:column;}'
    + '.testimonial-photo{height:260px;background-size:cover;background-position:center top;flex-shrink:0;transition:transform 0.5s ease;}'
    + '.testimonial-card:hover .testimonial-photo{transform:scale(1.05);}'
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
    + '.testimonial-panel.c-blue{background:#1d4ed8;color:#fff;}'
    + '.testimonial-panel.c-blue .testimonial-stars{color:#fff;}'
    + '@media (max-width:600px){'
    +   '.testimonials-heading{font-size:13px;letter-spacing:-0.2px;margin-bottom:20px;}'
    +   '.testimonial-card{width:300px;min-width:300px;height:400px;}'
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
    return ''
      + '<div class="testimonial-card">'
      +   '<div class="testimonial-photo" style="background-image:url(\'' + escapeHtml(t.photo) + '\');"></div>'
      +   '<div class="testimonial-panel ' + escapeHtml(t.color || 'c-magenta') + '">'
      +     '<div class="testimonial-stars">' + starString(t.stars) + '</div>'
      +     '<p class="testimonial-quote">"' + escapeHtml(t.quote) + '"</p>'
      +     '<div class="testimonial-meta">'
      +       '<div class="testimonial-name">' + escapeHtml(t.name) + '</div>'
      +       '<div class="testimonial-handle">' + escapeHtml(t.handle) + '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  var ARROW_LEFT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  var ARROW_RIGHT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';

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

    mount.innerHTML = ''
      + '<section class="' + sectionClass + '">'
      +   '<h2 class="testimonials-heading">' + headingHtml + '</h2>'
      +   '<div class="testimonials-track-wrap">'
      +     '<button type="button" class="testimonial-arrow" data-testimonials-dir="-1" aria-label="Previous testimonial">' + ARROW_LEFT + '</button>'
      +     '<div class="testimonials-track" id="site-testimonials-track">' + cards + '</div>'
      +     '<button type="button" class="testimonial-arrow" data-testimonials-dir="1" aria-label="Next testimonial">' + ARROW_RIGHT + '</button>'
      +   '</div>'
      + '</section>';

    // Wire up the arrows. Self-contained, no external delegation needed.
    var arrows = mount.querySelectorAll('.testimonial-arrow');
    for (var a = 0; a < arrows.length; a++) {
      arrows[a].addEventListener('click', function () {
        var dir = parseInt(this.getAttribute('data-testimonials-dir'), 10) || 1;
        var track = document.getElementById('site-testimonials-track');
        if (!track) return;
        var card = track.querySelector('.testimonial-card');
        var amount = card ? card.offsetWidth + 20 : 400;
        track.scrollBy({ left: dir * amount, behavior: 'smooth' });
      });
    }

    // Desktop click-and-drag to scroll the carousel.
    var dragTrack = document.getElementById('site-testimonials-track');
    if (dragTrack) {
      var isDown = false, startX = 0, scrollStart = 0;
      dragTrack.addEventListener('mousedown', function (e) {
        isDown = true;
        dragTrack.style.cursor = 'grabbing';
        startX = e.pageX - dragTrack.offsetLeft;
        scrollStart = dragTrack.scrollLeft;
        e.preventDefault();
      });
      dragTrack.addEventListener('mouseleave', function () { isDown = false; dragTrack.style.cursor = 'grab'; });
      dragTrack.addEventListener('mouseup', function () { isDown = false; dragTrack.style.cursor = 'grab'; });
      dragTrack.addEventListener('mousemove', function (e) {
        if (!isDown) return;
        var x = e.pageX - dragTrack.offsetLeft;
        var walk = (x - startX) * 1.5;
        dragTrack.scrollLeft = scrollStart - walk;
      });
      dragTrack.style.cursor = 'grab';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
