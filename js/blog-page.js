/* blog-page.js: Blog index pagination.
   CSP-compatible: no inline handlers, wires its own listeners. */
(function () {
  'use strict';

  var POSTS_PER_PAGE = 6;
  var grid = document.querySelector('.blog-grid');
  var paginationEl = document.getElementById('blog-pagination');
  if (!grid || !paginationEl) return;

  var allCards = Array.prototype.slice.call(grid.querySelectorAll('.blog-card'));
  var totalPages = Math.ceil(allCards.length / POSTS_PER_PAGE);

  // Hide pagination if only one page
  if (totalPages <= 1) {
    paginationEl.style.display = 'none';
    return;
  }

  function showPage(page) {
    page = Math.max(1, Math.min(totalPages, page));
    var start = (page - 1) * POSTS_PER_PAGE;
    var end = start + POSTS_PER_PAGE;
    allCards.forEach(function (card, i) {
      card.style.display = (i >= start && i < end) ? '' : 'none';
    });
    renderPagination(page);
    // Update URL hash without scrolling
    if (page > 1) {
      history.replaceState(null, '', '#page-' + page);
    } else {
      history.replaceState(null, '', window.location.pathname);
    }
    // Scroll to top of grid smoothly
    var rect = grid.getBoundingClientRect();
    if (rect.top < 0) {
      window.scrollTo({ top: window.scrollY + rect.top - 80, behavior: 'smooth' });
    }
  }

  function renderPagination(currentPage) {
    var html = '';

    // Previous button
    html += '<button type="button" ' + (currentPage === 1 ? 'disabled' : '') + ' aria-label="Previous page" data-page="' + (currentPage - 1) + '">\u2190 Previous</button>';

    // Page numbers (with ellipsis for large counts)
    var pages = getPageNumbers(currentPage, totalPages);
    pages.forEach(function (p) {
      if (p === '...') {
        html += '<span class="page-ellipsis" aria-hidden="true">\u2026</span>';
      } else {
        html += '<button type="button" ' + (p === currentPage ? 'class="active" aria-current="page"' : '') + ' aria-label="Page ' + p + '" data-page="' + p + '">' + p + '</button>';
      }
    });

    // Next button
    html += '<button type="button" ' + (currentPage === totalPages ? 'disabled' : '') + ' aria-label="Next page" data-page="' + (currentPage + 1) + '">Next \u2192</button>';

    paginationEl.innerHTML = html;

    // Wire up clicks
    paginationEl.querySelectorAll('button[data-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = parseInt(btn.getAttribute('data-page'), 10);
        if (!isNaN(p)) showPage(p);
      });
    });
  }

  function getPageNumbers(current, total) {
    // Show all pages if 7 or fewer, otherwise compact with ellipsis
    if (total <= 7) {
      var arr = [];
      for (var i = 1; i <= total; i++) arr.push(i);
      return arr;
    }

    var pages = [1];
    if (current > 3) pages.push('...');
    var rangeStart = Math.max(2, current - 1);
    var rangeEnd = Math.min(total - 1, current + 1);
    for (var j = rangeStart; j <= rangeEnd; j++) pages.push(j);
    if (current < total - 2) pages.push('...');
    pages.push(total);
    return pages;
  }

  // Read initial page from URL hash
  var initialPage = 1;
  var hash = window.location.hash;
  if (hash && hash.indexOf('#page-') === 0) {
    var requestedPage = parseInt(hash.substring(6), 10);
    if (!isNaN(requestedPage) && requestedPage >= 1 && requestedPage <= totalPages) {
      initialPage = requestedPage;
    }
  }

  showPage(initialPage);
})();
