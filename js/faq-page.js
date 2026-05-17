/* faq-page.js: FAQ accordion + category tabs.
   CSP-compatible: no inline handlers. Wires via data-action delegation. */
(function () {
  'use strict';

  function toggleFaq(questionEl) {
    var item = questionEl.closest('.faq-item');
    if (!item) return;
    var isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(function (i) {
      i.classList.remove('open');
    });
    if (!isOpen) item.classList.add('open');
  }

  function showCategory(cat, btn) {
    document.querySelectorAll('.cat-tab').forEach(function (t) {
      t.classList.remove('active');
    });
    if (btn) btn.classList.add('active');
    document.querySelectorAll('.faq-category').forEach(function (c) {
      c.style.display = (cat === 'all' || c.dataset.category === cat) ? 'block' : 'none';
    });
  }

  function init() {
    // Delegated click handling for both FAQ questions and category tabs.
    document.addEventListener('click', function (e) {
      var actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      var action = actionEl.getAttribute('data-action');

      if (action === 'toggle-faq') {
        toggleFaq(actionEl);
      } else if (action === 'show-category') {
        showCategory(actionEl.getAttribute('data-category'), actionEl);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
