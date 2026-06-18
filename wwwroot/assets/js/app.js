(() => {
  'use strict';

  /* ========== Sticky header state ========== */
  const header = document.querySelector('.site-header');
  header.classList.add('is-scrolled');

  /* ========== Mobile navigation ========== */
  const mobileNavToggle = document.querySelector('.mobile-nav-toggle');
  const mobileNav = document.getElementById('mobile-nav');
  const setMobileNav = (open) => {
    if (!mobileNavToggle || !mobileNav) return;
    header.classList.toggle('is-menu-open', open);
    mobileNavToggle.setAttribute('aria-expanded', String(open));
    mobileNavToggle.setAttribute('aria-label', open ? 'סגירת תפריט' : 'פתיחת תפריט');
    mobileNav.setAttribute('aria-hidden', String(!open));
  };
  if (mobileNavToggle && mobileNav) {
    mobileNavToggle.addEventListener('click', () => {
      setMobileNav(!header.classList.contains('is-menu-open'));
    });
    mobileNav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => setMobileNav(false));
    });
    document.addEventListener('click', (e) => {
      if (!header.classList.contains('is-menu-open')) return;
      if (!header.contains(e.target)) setMobileNav(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setMobileNav(false);
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 720) setMobileNav(false);
    });
  }

  /* ========== Scroll progress bar ========== */
  const progressBar = document.querySelector('.scroll-progress span');
  const updateProgress = () => {
    const h = document.documentElement;
    const total = h.scrollHeight - h.clientHeight;
    const pct = total > 0 ? (window.scrollY / total) * 100 : 0;
    if (progressBar) progressBar.style.width = pct + '%';
  };
  window.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();

  /* ========== Hero slideshow ========== */
  const slides = Array.from(document.querySelectorAll('.hero__slide'));
  if (slides.length > 1) {
    let i = 0;
    setInterval(() => {
      slides[i].classList.remove('is-active');
      i = (i + 1) % slides.length;
      slides[i].classList.add('is-active');
    }, 5500);
  }

  /* ========== Reveal-on-scroll ========== */
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  }

  /* ========== Count-up numeric stats ========== */
  const countEls = document.querySelectorAll('[data-count]');
  // Reset to 0 so the animation starts cleanly when each element enters view
  countEls.forEach((el) => { el.textContent = '0'; });
  const animateCount = (el) => {
    const target = parseInt(el.getAttribute('data-count'), 10);
    if (Number.isNaN(target)) return;
    const duration = 1400;
    const start = performance.now();
    const startVal = 0;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(startVal + (target - startVal) * eased).toLocaleString('he-IL');
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if ('IntersectionObserver' in window) {
    const co = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          co.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    countEls.forEach((el) => co.observe(el));
  } else {
    countEls.forEach((el) => { el.textContent = el.getAttribute('data-count'); });
  }

  /* ========== Gallery carousel + lightbox ========== */
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = lightbox ? lightbox.querySelector('img') : null;
  const lightboxClose = lightbox ? lightbox.querySelector('.lightbox__close') : null;
  const lightboxPrev = lightbox ? lightbox.querySelector('.lightbox__nav--prev') : null;
  const lightboxNext = lightbox ? lightbox.querySelector('.lightbox__nav--next') : null;
  const galleryMain = document.querySelector('.gallery-slider__main');
  const galleryMainImg = galleryMain ? galleryMain.querySelector('img') : null;
  const galleryPrev = document.querySelector('.gallery-slider__arrow--prev');
  const galleryNext = document.querySelector('.gallery-slider__arrow--next');
  const galleryThumbs = Array.from(document.querySelectorAll('.gallery-thumb'));
  const galleryItems = galleryThumbs.map((thumb) => ({
    href: thumb.getAttribute('data-full'),
    alt: thumb.getAttribute('data-alt') || ''
  }));
  let currentIndex = 0;

  const visibleItems = () => galleryItems;

  const setGalleryIndex = (index) => {
    if (!galleryItems.length || !galleryMain || !galleryMainImg) return;
    const prevSrc = galleryMainImg.currentSrc || galleryMainImg.src;
    currentIndex = (index + galleryItems.length) % galleryItems.length;
    const item = galleryItems[currentIndex];

    if (prevSrc && prevSrc !== new URL(item.href, location.href).href) {
      // Classic crossfade: keep the outgoing image on top and fade it out
      const fade = document.createElement('img');
      fade.className = 'gallery-slider__fade';
      fade.src = prevSrc;
      fade.alt = '';
      fade.setAttribute('aria-hidden', 'true');
      galleryMain.appendChild(fade);
      requestAnimationFrame(() => requestAnimationFrame(() => { fade.style.opacity = '0'; }));
      fade.addEventListener('transitionend', () => fade.remove());
      window.setTimeout(() => fade.remove(), 800);
    }

    galleryMain.href = item.href;
    galleryMain.classList.toggle('is-plan', galleryThumbs[currentIndex].classList.contains('gallery-thumb--plan'));
    galleryMainImg.src = item.href;
    galleryMainImg.alt = item.alt;
    galleryThumbs.forEach((thumb, i) => {
      thumb.classList.toggle('is-active', i === currentIndex);
      if (i === currentIndex) thumb.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
  };

  galleryThumbs.forEach((thumb, index) => {
    thumb.addEventListener('click', () => setGalleryIndex(index));
  });
  if (galleryPrev) galleryPrev.addEventListener('click', () => setGalleryIndex(currentIndex - 1));
  if (galleryNext) galleryNext.addEventListener('click', () => setGalleryIndex(currentIndex + 1));
  if (galleryMain) {
    const stage = galleryMain.closest('.gallery-slider__stage') || galleryMain;
    let touchStartX = 0;
    let touchStartY = 0;
    let didSwipe = false;
    stage.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      didSwipe = false;
    }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (!e.changedTouches.length) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
        didSwipe = true;
        // Swipe left -> next image, swipe right -> previous image
        setGalleryIndex(currentIndex + (dx < 0 ? 1 : -1));
      }
    });
    galleryMain.addEventListener('click', (e) => {
      e.preventDefault();
      if (didSwipe) { didSwipe = false; return; }
      openLightbox(currentIndex);
    });
  }

  const openLightbox = (index) => {
    const items = visibleItems();
    if (!items.length) return;
    currentIndex = index;
    lightboxImg.src = items[index].href;
    lightboxImg.alt = items[index].alt;
    lightbox.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  };
  const closeLightbox = () => {
    lightbox.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(() => { lightboxImg.src = ''; }, 300);
  };
  const navLightbox = (delta) => {
    const items = visibleItems();
    if (!items.length) return;
    currentIndex = (currentIndex + delta + items.length) % items.length;
    lightboxImg.src = items[currentIndex].href;
    lightboxImg.alt = items[currentIndex].alt;
    setGalleryIndex(currentIndex);
  };
  if (lightbox) {
    lightboxClose.addEventListener('click', closeLightbox);
    lightboxPrev.addEventListener('click', () => navLightbox(-1));
    lightboxNext.addEventListener('click', () => navLightbox(1));
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
      if (!lightbox.classList.contains('is-open')) return;
      if (e.key === 'Escape') closeLightbox();
      // RTL: ArrowRight -> previous, ArrowLeft -> next
      if (e.key === 'ArrowRight') navLightbox(-1);
      if (e.key === 'ArrowLeft') navLightbox(1);
    });
  }

  /* ========== Map magnifier lens ========== */
  const mapWrap = document.querySelector('.location-map');
  if (mapWrap) {
    const mapImg = mapWrap.querySelector('img');
    const lens = document.createElement('div');
    lens.className = 'map-lens';
    mapWrap.appendChild(lens);
    const ZOOM = 2.8;
    const LENS = 160;

    const move = (e) => {
      const r = mapImg.getBoundingClientRect();
      const wr = mapWrap.getBoundingClientRect();
      let x = e.clientX - r.left;
      let y = e.clientY - r.top;
      x = Math.max(LENS / 2, Math.min(x, r.width  - LENS / 2));
      y = Math.max(LENS / 2, Math.min(y, r.height - LENS / 2));
      lens.style.left = (x - LENS / 2 + r.left - wr.left) + 'px';
      lens.style.top  = (y - LENS / 2 + r.top  - wr.top)  + 'px';
      lens.style.backgroundImage    = `url(${mapImg.src})`;
      lens.style.backgroundSize     = `${r.width * ZOOM}px ${r.height * ZOOM}px`;
      lens.style.backgroundPosition = `${-(x * ZOOM - LENS / 2)}px ${-(y * ZOOM - LENS / 2)}px`;
    };

    mapWrap.addEventListener('mouseenter', () => { lens.style.display = 'block'; });
    mapWrap.addEventListener('mouseleave', () => { lens.style.display = 'none'; });
    mapWrap.addEventListener('mousemove', move);
  }
})();
