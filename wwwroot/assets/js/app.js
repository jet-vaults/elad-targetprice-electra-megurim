(() => {
  'use strict';

  /* ========== Sticky header state ========== */
  const header = document.querySelector('.site-header');
  const onScroll = () => {
    if (window.scrollY > 24) header.classList.add('is-scrolled');
    else header.classList.remove('is-scrolled');
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

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

  /* ========== Gallery filtering ========== */
  const galleryTabs = document.querySelectorAll('.gallery-tab');
  const galleryItemsAll = document.querySelectorAll('.gallery__item');
  const applyFilter = (filter) => {
    galleryItemsAll.forEach((item) => {
      const cat = item.getAttribute('data-cat');
      const show = filter === 'all' || cat === filter;
      item.classList.toggle('is-hidden', !show);
    });
  };
  galleryTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const filter = tab.getAttribute('data-filter');
      galleryTabs.forEach((t) => t.classList.toggle('is-active', t === tab));
      applyFilter(filter);
    });
  });
  // Apply initial filter from active tab
  const initialTab = document.querySelector('.gallery-tab.is-active');
  if (initialTab) applyFilter(initialTab.getAttribute('data-filter'));

  /* ========== Lightbox gallery ========== */
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = lightbox.querySelector('img');
  const lightboxClose = lightbox.querySelector('.lightbox__close');
  const lightboxPrev = lightbox.querySelector('.lightbox__nav--prev');
  const lightboxNext = lightbox.querySelector('.lightbox__nav--next');
  const galleryItems = Array.from(document.querySelectorAll('.gallery__item'));
  let currentIndex = 0;

  const visibleItems = () => galleryItems.filter((it) => !it.classList.contains('is-hidden'));

  const openLightbox = (index) => {
    const items = visibleItems();
    currentIndex = index;
    lightboxImg.src = items[index].getAttribute('href');
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
    currentIndex = (currentIndex + delta + items.length) % items.length;
    lightboxImg.src = items[currentIndex].getAttribute('href');
  };

  galleryItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const items = visibleItems();
      const idx = items.indexOf(item);
      if (idx >= 0) openLightbox(idx);
    });
  });
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
})();
