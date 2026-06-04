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
    currentIndex = (index + galleryItems.length) % galleryItems.length;
    const item = galleryItems[currentIndex];
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
    galleryMain.addEventListener('click', (e) => {
      e.preventDefault();
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
})();
