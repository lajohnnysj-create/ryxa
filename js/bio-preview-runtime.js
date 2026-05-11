// =============================================================================
// /js/bio-preview-runtime.js
// -----------------------------------------------------------------------------
// Runs INSIDE the bio preview iframe (loaded via srcdoc from buildPreviewHTML
// in /js/bio.js). Wires up the desktop arrow buttons on every YouTube video
// carousel block that the user has added.
//
// Why this file exists: srcdoc iframes inherit the parent page's CSP. Since
// our parent CSP forbids inline <script> tags, this previously-inline runtime
// was blocked. Moving it to an external file under our own origin makes it
// load under script-src 'self'.
//
// This file runs in the iframe's window context, NOT the parent dashboard.
// It does NOT have access to any dashboard globals (sb, currentUser, etc).
// =============================================================================

(function() {
  function wireCarousels() {
    document.querySelectorAll('.vids').forEach(function(block) {
      var scroller = block.querySelector('.vids-r');
      var left = block.querySelector('.vids-arrow-l');
      var right = block.querySelector('.vids-arrow-r');
      if (!scroller || !left || !right) return;
      var cardWidth = 230; // 220px card + 10px gap
      function updateState() {
        var max = scroller.scrollWidth - scroller.clientWidth;
        left.disabled = scroller.scrollLeft <= 1;
        right.disabled = scroller.scrollLeft >= max - 1;
      }
      left.addEventListener('click', function(e) { e.preventDefault(); scroller.scrollBy({ left: -cardWidth, behavior: 'smooth' }); });
      right.addEventListener('click', function(e) { e.preventDefault(); scroller.scrollBy({ left: cardWidth, behavior: 'smooth' }); });
      scroller.addEventListener('scroll', updateState, { passive: true });
      updateState();
    });
  }

  // The script is loaded synchronously in the iframe's <head> via a regular
  // <script src> tag, so DOM may not be ready yet. Wait for it.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireCarousels);
  } else {
    wireCarousels();
  }
})();
