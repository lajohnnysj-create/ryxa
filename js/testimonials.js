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
    + '.testimonials-track-wrap{position:relative;max-width:1240px;margin:0 auto;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 60px,#000 calc(100% - 60px),transparent 100%);mask-image:linear-gradient(90deg,transparent 0,#000 60px,#000 calc(100% - 60px),transparent 100%);}'
    + '.testimonials-track{display:flex;gap:20px;padding:8px 0;width:max-content;animation:testimonials-marquee 50s linear infinite;}'
    + '.testimonials-track-wrap:hover .testimonials-track{animation-play-state:paused;}'
    + '@keyframes testimonials-marquee{from{transform:translateX(0);}to{transform:translateX(calc(-50% - 10px));}}'
    + '@media (prefers-reduced-motion: reduce){.testimonials-track{animation:none;}}'
    + '.testimonial-card{position:relative;width:380px;min-width:380px;min-height:500px;border-radius:20px;overflow:hidden;flex-shrink:0;display:flex;flex-direction:column;}'
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
      + '<section class="' + sectionClass + '">'
      +   '<h2 class="testimonials-heading">' + headingHtml + '</h2>'
      +   '<div class="testimonials-track-wrap">'
      +     '<div class="testimonials-track" id="site-testimonials-track">' + marqueeCards + '</div>'
      +   '</div>'
      + '</section>';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
