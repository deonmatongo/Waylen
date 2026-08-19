/**
 * Progressive enhancement only.
 *
 * Every page works with JavaScript disabled: forms are real form posts,
 * navigation is real links. This file adds the mobile menu toggles and a few
 * conveniences on top. Nothing here is load-bearing.
 */
(function () {
  'use strict';

  /** Mobile navigation + dropdown sub-menus on the public site. */
  function initPublicNav() {
    var toggle = document.querySelector('[data-nav-toggle]');
    var nav = document.getElementById('site-nav');
    if (!toggle || !nav) return;

    toggle.addEventListener('click', function () {
      var isOpen = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });

    // Dropdown trigger buttons (items with children)
    nav.querySelectorAll('.site-nav__link--trigger').forEach(function (trigger) {
      var item = trigger.closest('.site-nav__item--has-dropdown');
      if (!item) return;

      trigger.addEventListener('click', function () {
        var isOpen = item.classList.toggle('is-open');
        trigger.setAttribute('aria-expanded', String(isOpen));
        // Close sibling dropdowns
        nav.querySelectorAll('.site-nav__item--has-dropdown').forEach(function (sibling) {
          if (sibling !== item) {
            sibling.classList.remove('is-open');
            var sibTrigger = sibling.querySelector('.site-nav__link--trigger');
            if (sibTrigger) sibTrigger.setAttribute('aria-expanded', 'false');
          }
        });
      });
    });

    // Close all dropdowns on Escape
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        if (nav.classList.contains('is-open')) {
          nav.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
          toggle.focus();
        }
        nav.querySelectorAll('.site-nav__item--has-dropdown.is-open').forEach(function (item) {
          item.classList.remove('is-open');
          var t = item.querySelector('.site-nav__link--trigger');
          if (t) { t.setAttribute('aria-expanded', 'false'); t.focus(); }
        });
      }
    });

    // Close dropdown when clicking outside on desktop
    document.addEventListener('click', function (event) {
      if (!nav.contains(event.target)) {
        nav.querySelectorAll('.site-nav__item--has-dropdown.is-open').forEach(function (item) {
          item.classList.remove('is-open');
          var t = item.querySelector('.site-nav__link--trigger');
          if (t) t.setAttribute('aria-expanded', 'false');
        });
      }
    });
  }

  /** Sidebar toggle in the portal and back-office shells. */
  function initAppSidebar() {
    var toggle = document.querySelector('[data-sidebar-toggle]');
    var sidebar = document.getElementById('app-sidebar');
    if (!toggle || !sidebar) return;

    toggle.addEventListener('click', function () {
      var isOpen = sidebar.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
  }

  /**
   * Guards against double submission — a second click on "Upload" or "Record
   * payment" would otherwise create a duplicate record.
   */
  function initSubmitGuards() {
    document.querySelectorAll('form').forEach(function (form) {
      form.addEventListener('submit', function () {
        var button = form.querySelector('button[type="submit"]');
        if (!button || button.disabled) return;

        // Deferred so the button is not disabled before the browser has
        // serialised it as part of the submission.
        window.setTimeout(function () {
          button.disabled = true;
          button.dataset.originalText = button.textContent;
          button.textContent = 'Working…';
        }, 0);
      });
    });
  }

  /**
   * Client-side size check on file inputs, so a student on a slow connection
   * finds out before uploading rather than after. The server enforces the real
   * limit regardless.
   */
  function initUploadHints() {
    var MAX_BYTES = 15 * 1024 * 1024;

    document.querySelectorAll('input[type="file"]').forEach(function (input) {
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;

        var existing = input.parentElement.querySelector('[data-upload-error]');
        if (existing) existing.remove();

        if (file.size > MAX_BYTES) {
          var error = document.createElement('p');
          error.className = 'field-error';
          error.setAttribute('data-upload-error', '');
          error.textContent =
            'That file is ' +
            (file.size / 1024 / 1024).toFixed(1) +
            ' MB. The limit is 15 MB — please compress it and try again.';
          input.parentElement.appendChild(error);
          input.value = '';
        }
      });
    });
  }

  /** Dismisses flash messages after a while so they do not linger. */
  function initFlashDismiss() {
    var messages = document.querySelectorAll('.flash');
    if (!messages.length) return;

    window.setTimeout(function () {
      messages.forEach(function (message) {
        // Errors stay put — the user may still need to read them.
        if (message.classList.contains('flash--error')) return;
        message.style.transition = 'opacity 300ms';
        message.style.opacity = '0';
        window.setTimeout(function () {
          message.remove();
        }, 300);
      });
    }, 6000);
  }

  /**
   * Custom select dropdowns — replaces every select.field__select with a fully
   * branded panel while keeping the real <select> in the DOM so forms submit
   * normally. Keyboard-navigable and ARIA-compliant.
   */
  function initCustomSelects() {
    var CHEVRON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
    var TICK    = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="2 6 5 9 10 3"/></svg>';
    var SEARCH  = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;position:absolute;left:18px;top:50%;transform:translateY(-50%);color:rgba(13,31,76,0.35)" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

    var uid = 0;

    function buildSelect(select) {
      if (select.dataset.csInit) return;
      select.dataset.csInit = '1';

      var id       = ++uid;
      var isInline = select.classList.contains('field__select--inline');
      var optCount = select.options.length;
      var hasSearch = optCount > 8 && !isInline;

      /* wrapper */
      var wrapper = document.createElement('div');
      wrapper.className = 'cs' + (isInline ? ' cs--inline' : '');

      /* trigger */
      var trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'cs__trigger';
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-controls', 'cs-panel-' + id);
      var ariaLabel = select.getAttribute('aria-label') || select.getAttribute('name') || null;
      if (ariaLabel) trigger.setAttribute('aria-label', ariaLabel);

      var valueEl = document.createElement('span');
      valueEl.className = 'cs__trigger-value';

      var iconEl = document.createElement('span');
      iconEl.className = 'cs__trigger-icon';
      iconEl.innerHTML = CHEVRON;

      trigger.appendChild(valueEl);
      trigger.appendChild(iconEl);

      /* panel */
      var panel = document.createElement('div');
      panel.id = 'cs-panel-' + id;
      panel.className = 'cs__panel';
      panel.setAttribute('role', 'listbox');
      panel.setAttribute('tabindex', '-1');

      /* optional search */
      var searchInput = null;
      if (hasSearch) {
        var sw = document.createElement('div');
        sw.className = 'cs__search-wrap';
        sw.style.position = 'relative';
        sw.innerHTML = SEARCH;
        searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'cs__search';
        searchInput.placeholder = 'Search…';
        searchInput.setAttribute('aria-label', 'Search options');
        searchInput.style.paddingLeft = '2rem';
        sw.appendChild(searchInput);
        panel.appendChild(sw);
      }

      /* option list */
      var list = document.createElement('ul');
      list.className = 'cs__list';
      list.setAttribute('role', 'listbox');

      var emptyEl = document.createElement('li');
      emptyEl.className = 'cs__empty';
      emptyEl.textContent = 'No options match.';
      emptyEl.style.display = 'none';

      Array.from(select.options).forEach(function(opt) {
        var li = document.createElement('li');
        li.className = 'cs__option';
        li.setAttribute('role', 'option');
        li.setAttribute('data-value', opt.value);
        li.setAttribute('aria-selected', 'false');

        if (!opt.value && opt.value !== 0) li.classList.add('cs__option--placeholder');
        if (opt.disabled) li.classList.add('cs__option--disabled');

        var lbl = document.createElement('span');
        lbl.className = 'cs__option-label';
        lbl.textContent = opt.text;
        li.appendChild(lbl);

        var chk = document.createElement('span');
        chk.className = 'cs__option-check';
        chk.innerHTML = TICK;
        li.appendChild(chk);

        list.appendChild(li);
      });

      list.appendChild(emptyEl);
      panel.appendChild(list);
      wrapper.appendChild(trigger);
      wrapper.appendChild(panel);

      /* hide native select, keep in DOM for form submission */
      select.style.cssText = 'position:absolute;opacity:0;width:1px;height:1px;pointer-events:none;';
      select.setAttribute('tabindex', '-1');
      select.setAttribute('aria-hidden', 'true');

      select.parentNode.insertBefore(wrapper, select);
      wrapper.appendChild(select);

      /* ── helpers ──────────────────────────────────────────────────────── */

      function getOpts(visibleOnly) {
        var all = Array.from(list.querySelectorAll('.cs__option:not(.cs__option--disabled):not(.cs__empty)'));
        if (!visibleOnly) return all;
        return all.filter(function(o) { return o.style.display !== 'none'; });
      }

      function setFocused(el) {
        list.querySelectorAll('.cs__option').forEach(function(o) { o.classList.remove('is-focused'); });
        if (el) { el.classList.add('is-focused'); el.scrollIntoView({ block: 'nearest' }); }
      }

      function syncValue() {
        var sel = select.options[select.selectedIndex];
        var val = sel ? sel.value : '';
        valueEl.textContent = sel ? sel.text : '';
        valueEl.classList.toggle('cs__trigger-value--placeholder', !val);
        list.querySelectorAll('.cs__option').forEach(function(li) {
          var match = li.getAttribute('data-value') === val;
          li.classList.toggle('is-selected', match);
          li.setAttribute('aria-selected', String(match));
        });
      }

      function filterOptions(q) {
        var needle = q.trim().toLowerCase();
        var visibleCount = 0;
        list.querySelectorAll('.cs__option:not(.cs__empty)').forEach(function(li) {
          var match = !needle || li.querySelector('.cs__option-label').textContent.toLowerCase().indexOf(needle) !== -1;
          li.style.display = match ? '' : 'none';
          if (match) visibleCount++;
        });
        emptyEl.style.display = visibleCount ? 'none' : '';
      }

      function open() {
        document.querySelectorAll('.cs.is-open').forEach(function(other) {
          if (other !== wrapper) {
            other.classList.remove('is-open');
            var t = other.querySelector('.cs__trigger');
            if (t) t.setAttribute('aria-expanded', 'false');
          }
        });

        wrapper.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');

        /* flip panel upward if too close to viewport bottom */
        var rect = wrapper.getBoundingClientRect();
        var spaceBelow = window.innerHeight - rect.bottom;
        if (spaceBelow < 240 && rect.top > 240) {
          panel.classList.add('cs__panel--up');
        } else {
          panel.classList.remove('cs__panel--up');
        }

        if (searchInput) { searchInput.value = ''; filterOptions(''); searchInput.focus(); }

        var current = list.querySelector('.is-selected') || getOpts(true)[0];
        if (current) setFocused(current);
      }

      function close() {
        wrapper.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
        list.querySelectorAll('.cs__option').forEach(function(o) { o.classList.remove('is-focused'); });
      }

      function choose(li) {
        select.value = li.getAttribute('data-value');
        select.dispatchEvent(new Event('change', { bubbles: true }));
        syncValue();
        close();
        trigger.focus();
      }

      /* ── events ───────────────────────────────────────────────────────── */

      trigger.addEventListener('click', function(e) {
        e.stopPropagation();
        wrapper.classList.contains('is-open') ? close() : open();
      });

      list.addEventListener('click', function(e) {
        var li = e.target.closest('.cs__option');
        if (li && !li.classList.contains('cs__option--disabled') && !li.classList.contains('cs__empty')) {
          choose(li);
        }
      });

      trigger.addEventListener('keydown', function(e) {
        var opts  = getOpts(true);
        var focused = list.querySelector('.is-focused');
        var idx   = focused ? opts.indexOf(focused) : -1;
        var isOpen = wrapper.classList.contains('is-open');

        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            if (!isOpen) { open(); return; }
            setFocused(opts[Math.min(idx + 1, opts.length - 1)]);
            break;
          case 'ArrowUp':
            e.preventDefault();
            if (idx > 0) setFocused(opts[idx - 1]);
            break;
          case 'Enter':
          case ' ':
            e.preventDefault();
            isOpen && focused ? choose(focused) : open();
            break;
          case 'Escape':
          case 'Tab':
            close();
            break;
        }
      });

      if (searchInput) {
        searchInput.addEventListener('input', function() { filterOptions(searchInput.value); });
        searchInput.addEventListener('keydown', function(e) {
          var opts = getOpts(true);
          var focused = list.querySelector('.is-focused');
          var idx = focused ? opts.indexOf(focused) : -1;
          if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(opts[Math.min(idx + 1, opts.length - 1)]); }
          if (e.key === 'ArrowUp')   { e.preventDefault(); if (idx > 0) setFocused(opts[idx - 1]); }
          if (e.key === 'Enter' && focused) { e.preventDefault(); choose(focused); }
          if (e.key === 'Escape') { close(); trigger.focus(); }
        });
      }

      syncValue();
    }

    document.querySelectorAll('select.field__select').forEach(buildSelect);

    /* close all on outside click */
    document.addEventListener('click', function() {
      document.querySelectorAll('.cs.is-open').forEach(function(cs) {
        cs.classList.remove('is-open');
        var t = cs.querySelector('.cs__trigger');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /** Fade+lift each top-level content block into view on first scroll past it. */
  function initScrollReveal() {
    var containers = document.querySelectorAll('.site__main, .app__main');
    if (!containers.length) return;

    var targets = [];
    containers.forEach(function (container) {
      Array.prototype.forEach.call(container.children, function (child, i) {
        if (child.classList.contains('flash-stack')) return;
        child.classList.add('reveal');
        child.style.setProperty('--reveal-delay', Math.min(i, 6) * 60 + 'ms');
        targets.push(child);
      });
    });
    if (!targets.length) return;

    var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced || !('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }

    document.documentElement.setAttribute('data-motion-ready', '');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    targets.forEach(function (el) { io.observe(el); });
  }

  /**
   * Loops the "Live client dashboard" mockup's application-progress stages so
   * the panel reads as active rather than a static screenshot. Purely
   * decorative (the panel is aria-hidden) — never touches real data.
   */
  function initHeroJourney() {
    var stages = document.querySelectorAll('.cp-journey__stage');
    if (stages.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var startIndex = Array.prototype.findIndex.call(stages, function (stage) {
      return stage.classList.contains('cp-journey__stage--active');
    });
    if (startIndex === -1) return;

    var sequence = [];
    for (var i = startIndex; i < stages.length; i++) sequence.push(i);
    sequence.push(null); // every stage complete — hold here briefly before looping

    var step = 0;
    function render(activeIndex) {
      stages.forEach(function (stage, i) {
        stage.classList.remove('cp-journey__stage--active');
        stage.classList.toggle('cp-journey__stage--done', activeIndex === null || i < activeIndex);
        if (i === activeIndex) stage.classList.add('cp-journey__stage--active');
      });
    }

    setInterval(function () {
      step = (step + 1) % sequence.length;
      render(sequence[step]);
    }, 2600);
  }

  /** Safety net for browsers that ignore the `autoplay` attribute on first paint. */
  function initHeroVideo() {
    var video = document.querySelector('.cp-hero__video');
    if (!video) return;
    var start = function () {
      if (!video.paused) return;
      var attempt = video.play();
      if (attempt && typeof attempt.catch === 'function') attempt.catch(function () {});
    };
    start();
    video.addEventListener('loadeddata', start);
    video.addEventListener('canplay', start);
  }

/**
   * Cookie consent. Shown once per browser until a real choice is recorded —
   * "Accept all" / "Necessary only" / a saved custom preference all write a
   * JSON record (`{necessary, analytics, decidedAt}`) to localStorage, not
   * just a dismissed flag. There is no analytics integration to gate yet, but
   * any that gets added later should read `cookieConsent().analytics` before
   * loading, so this UI never needs rebuilding to become "real".
   */
  var COOKIE_CONSENT_KEY = 'waylen-cookie-consent';

  function readCookieConsent() {
    try {
      var raw = window.localStorage.getItem(COOKIE_CONSENT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null; // Private browsing, corrupted value, storage disabled, etc.
    }
  }

  function writeCookieConsent(analytics) {
    var record = { necessary: true, analytics: Boolean(analytics), decidedAt: Date.now() };
    try {
      window.localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(record));
    } catch (err) {
      /* Can't persist — the banner will just show again next visit. */
    }
    return record;
  }

  function initCookieBanner() {
    var banner = document.querySelector('[data-cookie-banner]');
    if (!banner || readCookieConsent()) return;

    banner.hidden = false;

    var prefsPanel = banner.querySelector('[data-cookie-prefs]');
    var manageButton = banner.querySelector('[data-cookie-manage]');
    var analyticsToggle = banner.querySelector('[data-cookie-analytics]');

    function closeBanner() {
      banner.hidden = true;
    }

    if (manageButton && prefsPanel) {
      manageButton.addEventListener('click', function () {
        var willOpen = prefsPanel.hidden;
        prefsPanel.hidden = !willOpen;
        manageButton.setAttribute('aria-expanded', String(willOpen));
      });
    }

    var acceptAllButton = banner.querySelector('[data-cookie-accept-all]');
    if (acceptAllButton) {
      acceptAllButton.addEventListener('click', function () {
        writeCookieConsent(true);
        closeBanner();
      });
    }

    var necessaryOnlyButton = banner.querySelector('[data-cookie-necessary-only]');
    if (necessaryOnlyButton) {
      necessaryOnlyButton.addEventListener('click', function () {
        writeCookieConsent(false);
        closeBanner();
      });
    }

    var saveButton = banner.querySelector('[data-cookie-save]');
    if (saveButton) {
      saveButton.addEventListener('click', function () {
        writeCookieConsent(analyticsToggle && analyticsToggle.checked);
        closeBanner();
      });
    }
  }

  function init() {
    initPublicNav();
    initAppSidebar();
    initCustomSelects();
    initSubmitGuards();
    initUploadHints();
    initFlashDismiss();
    initScrollReveal();
    initHeroVideo();
    initHeroJourney();
    initCookieBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
