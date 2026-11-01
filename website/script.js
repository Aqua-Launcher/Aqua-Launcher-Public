/* Aqua Launcher site — small, dependency-free interactions. */
(() => {
  'use strict';

  const header = document.querySelector('[data-header]');
  const nav = document.querySelector('[data-nav]');
  const navToggle = document.querySelector('[data-nav-toggle]');
  const navBackdrop = document.querySelector('[data-nav-backdrop]');
  const navLinks = [...document.querySelectorAll('.nav__link')];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Header state + scrollspy --------------------------------------------- */
  const sections = navLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  const setActiveLink = () => {
    const marker = window.scrollY + 140;
    let current = null;

    for (const section of sections) {
      if (section.offsetTop <= marker) current = section;
    }

    navLinks.forEach((link) => {
      const active = current !== null && link.getAttribute('href') === `#${current.id}`;
      link.classList.toggle('is-active', active);
      if (active) {
        link.setAttribute('aria-current', 'location');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  };

  const onScroll = () => {
    header?.classList.toggle('is-scrolled', window.scrollY > 10);
    setActiveLink();
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* Mobile navigation ---------------------------------------------------- */
  const isMobileNav = () => window.matchMedia('(max-width: 980px)').matches;

  const closeNav = ({ restoreFocus = false } = {}) => {
    if (!nav || !navToggle) return;
    nav.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Open menu');
    document.body.classList.remove('nav-open');
    if (navBackdrop) navBackdrop.hidden = true;
    if (restoreFocus && isMobileNav()) navToggle.focus();
  };

  const openNav = () => {
    if (!nav || !navToggle) return;
    nav.classList.add('is-open');
    navToggle.setAttribute('aria-expanded', 'true');
    navToggle.setAttribute('aria-label', 'Close menu');
    document.body.classList.add('nav-open');
    if (navBackdrop) navBackdrop.hidden = false;
    nav.querySelector('a')?.focus();
  };

  navToggle?.addEventListener('click', () => {
    if (navToggle.getAttribute('aria-expanded') === 'true') {
      closeNav({ restoreFocus: true });
    } else {
      openNav();
    }
  });

  navBackdrop?.addEventListener('click', () => closeNav({ restoreFocus: true }));

  navLinks.forEach((link) => link.addEventListener('click', () => closeNav()));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nav?.classList.contains('is-open')) {
      closeNav({ restoreFocus: true });
    }
  });

  window.matchMedia('(min-width: 981px)').addEventListener('change', (event) => {
    if (event.matches) closeNav();
  });

  /* Reveal on scroll -----------------------------------------------------
     A rect check on a rAF tick is used instead of IntersectionObserver so a
     missed observer callback can never leave content invisible. */
  const revealItems = [...document.querySelectorAll('.reveal')];

  const showVisibleReveals = () => {
    const trigger = window.innerHeight - 36;
    revealItems.forEach((item) => {
      if (item.classList.contains('is-in')) return;
      const rect = item.getBoundingClientRect();
      if (rect.top < trigger && rect.bottom > 0) item.classList.add('is-in');
    });
  };

  let revealFrame = 0;
  const queueRevealCheck = () => {
    if (revealFrame || reduceMotion.matches) return;
    revealFrame = window.requestAnimationFrame(() => {
      revealFrame = 0;
      showVisibleReveals();
    });
  };

  if (reduceMotion.matches) {
    revealItems.forEach((item) => item.classList.add('is-in'));
  } else {
    showVisibleReveals();
    window.addEventListener('scroll', queueRevealCheck, { passive: true });
    window.addEventListener('resize', queueRevealCheck);
    window.addEventListener('load', showVisibleReveals);
  }

  /* Screenshot tabs ------------------------------------------------------ */
  const tabs = [...document.querySelectorAll('[data-tour-tab]')];
  const panels = [...document.querySelectorAll('[data-tour-panel]')];
  const tourCaption = document.querySelector('[data-tour-caption]');

  const selectTab = (id, { focus = false } = {}) => {
    const nextTab = tabs.find((tab) => tab.dataset.tourTab === id);
    const nextPanel = panels.find((panel) => panel.dataset.tourPanel === id);
    if (!nextTab || !nextPanel) return;

    tabs.forEach((tab) => {
      const active = tab === nextTab;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });

    panels.forEach((panel) => {
      panel.hidden = panel !== nextPanel;
    });

    const trigger = nextPanel.querySelector('[data-lightbox]');
    if (tourCaption && trigger?.dataset.caption) {
      tourCaption.textContent = trigger.dataset.caption;
    }

    if (focus) nextTab.focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab.dataset.tourTab));

    tab.addEventListener('keydown', (event) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();

      let nextIndex = index;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;

      selectTab(tabs[nextIndex].dataset.tourTab, { focus: true });
    });
  });

  /* Screenshot lightbox -------------------------------------------------- */
  const dialog = document.querySelector('[data-lightbox-dialog]');
  const dialogImage = document.querySelector('[data-lightbox-img]');
  const dialogCaption = document.querySelector('[data-lightbox-caption]');
  const dialogClose = document.querySelector('[data-lightbox-close]');
  const lightboxTriggers = [...document.querySelectorAll('[data-lightbox]')];

  const supportsDialog = dialog && typeof dialog.showModal === 'function';

  lightboxTriggers.forEach((trigger) => {
    trigger.addEventListener('click', () => {
      if (!dialog || !dialogImage) return;
      dialogImage.src = trigger.dataset.src || '';
      dialogImage.alt = trigger.dataset.alt || '';
      if (dialogCaption) dialogCaption.textContent = trigger.dataset.caption || '';

      if (supportsDialog) {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    });
  });

  dialogClose?.addEventListener('click', () => {
    if (supportsDialog) dialog.close();
    else dialog?.removeAttribute('open');
  });

  dialog?.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    if (supportsDialog) dialog.close();
    else dialog.removeAttribute('open');
  });

  /* Copy build commands -------------------------------------------------- */
  const copyStatus = document.querySelector('[data-copy-status]');

  const fallbackCopy = (text) => {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    area.remove();
    return copied;
  };

  const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return fallbackCopy(text);
      }
    }
    return fallbackCopy(text);
  };

  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const label = button.querySelector('span');
      if (!label) return;

      const copied = await copyText(button.dataset.copy || '');
      button.classList.toggle('is-copied', copied);
      label.textContent = copied ? 'Copied' : 'Copy failed';
      if (copyStatus) {
        copyStatus.textContent = copied
          ? 'Build commands copied to the clipboard.'
          : 'Could not copy. Select the commands and copy them manually.';
      }

      window.setTimeout(() => {
        button.classList.remove('is-copied');
        label.textContent = 'Copy';
      }, 2200);
    });
  });

  /* Hero artwork slider -------------------------------------------------- */
  const heroSlider = document.querySelector('[data-hero-slider]');
  const hero = heroSlider?.closest('.hero');
  const slides = heroSlider ? [...heroSlider.querySelectorAll('[data-slide]')] : [];
  const slideDots = [...document.querySelectorAll('[data-hero-dot]')];
  const slideLabel = document.querySelector('[data-hero-label]');
  const slidePrev = document.querySelector('[data-hero-prev]');
  const slideNext = document.querySelector('[data-hero-next]');
  const slidePause = document.querySelector('[data-hero-pause]');
  const slideControls = document.querySelector('[data-hero-controls]');
  const SLIDE_INTERVAL = 7000;

  if (heroSlider && slides.length) {
    let slideIndex = 0;
    let slideTimer = 0;
    let paused = reduceMotion.matches;
    let hovering = false;
    let pageVisible = !document.hidden;

    const showSlide = (nextIndex) => {
      slideIndex = (nextIndex + slides.length) % slides.length;

      slides.forEach((slide, index) => {
        const active = index === slideIndex;
        slide.classList.toggle('is-active', active);
        slide.setAttribute('aria-hidden', String(!active));
      });

      slideDots.forEach((dot, index) => {
        const active = index === slideIndex;
        dot.classList.toggle('is-active', active);
        dot.setAttribute('aria-pressed', String(active));
      });

      if (slideLabel) {
        slideLabel.textContent = slides[slideIndex].dataset.label || '';
      }
    };

    const stopSlideshow = () => {
      window.clearInterval(slideTimer);
      slideTimer = 0;
    };

    const syncSlideshow = () => {
      stopSlideshow();
      if (paused || reduceMotion.matches || hovering || !pageVisible) return;
      slideTimer = window.setInterval(() => showSlide(slideIndex + 1), SLIDE_INTERVAL);
    };

    const setPaused = (value) => {
      paused = value;
      if (slidePause) {
        slidePause.setAttribute('aria-pressed', String(paused));
        slidePause.setAttribute('aria-label', paused ? 'Play artwork slideshow' : 'Pause artwork slideshow');
      }
      syncSlideshow();
    };

    setPaused(paused);

    slidePause?.addEventListener('click', () => setPaused(!paused));
    slidePrev?.addEventListener('click', () => {
      showSlide(slideIndex - 1);
      syncSlideshow();
    });
    slideNext?.addEventListener('click', () => {
      showSlide(slideIndex + 1);
      syncSlideshow();
    });

    slideDots.forEach((dot) => {
      dot.addEventListener('click', () => {
        showSlide(Number(dot.dataset.heroDot) || 0);
        syncSlideshow();
      });
    });

    slideControls?.addEventListener('pointerenter', () => {
      hovering = true;
      syncSlideshow();
    });
    slideControls?.addEventListener('pointerleave', () => {
      hovering = false;
      syncSlideshow();
    });
    hero?.addEventListener('focusin', () => {
      hovering = true;
      syncSlideshow();
    });
    hero?.addEventListener('focusout', (event) => {
      if (!hero.contains(event.relatedTarget)) {
        hovering = false;
        syncSlideshow();
      }
    });

    document.addEventListener('visibilitychange', () => {
      pageVisible = !document.hidden;
      syncSlideshow();
    });

    reduceMotion.addEventListener('change', (event) => {
      if (event.matches) paused = true;
      setPaused(paused);
    });

    // Decode the remaining artwork once the first paint is done.
    const warmArtwork = () => {
      slides.forEach((slide) => {
        const image = slide.querySelector('img');
        if (image && !image.complete) image.loading = 'eager';
      });
    };
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(warmArtwork, { timeout: 3000 });
    } else {
      window.setTimeout(warmArtwork, 1500);
    }
  }

  /* Housekeeping --------------------------------------------------------- */
  document.querySelectorAll('[data-year]').forEach((node) => {
    node.textContent = String(new Date().getFullYear());
  });

  const preloadDashboard = () => {
    const image = new Image();
    image.src = 'assets/screenshots/dashboard.jpg';
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(preloadDashboard, { timeout: 2500 });
  } else {
    window.setTimeout(preloadDashboard, 1500);
  }
})();
