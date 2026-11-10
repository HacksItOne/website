'use strict';

const header = document.querySelector('.top');
const menu = document.querySelector('.menu-toggle');

if (header && menu) {
  menu.addEventListener('click', () => {
    const open = header.classList.toggle('nav-open');
    menu.setAttribute('aria-expanded', String(open));
  });

  document.querySelectorAll('#site-nav a, .acct a').forEach((link) => {
    link.addEventListener('click', () => {
      header.classList.remove('nav-open');
      menu.setAttribute('aria-expanded', 'false');
    });
  });
}

document.documentElement.classList.add('js-ready');
const revealItems = document.querySelectorAll('.intro, .services-section, .closing, .service-card, .news-card');
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries, instance) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      instance.unobserve(entry.target);
    });
  }, { threshold: 0.12 });
  revealItems.forEach((item, index) => {
    item.style.transitionDelay = `${Math.min(index * 70, 280)}ms`;
    observer.observe(item);
  });
} else {
  revealItems.forEach((item) => item.classList.add('is-visible'));
}

const slide = document.querySelector('.hero-slide-label');
if (slide) {
  let current = 1;
  window.setInterval(() => {
    current = current === 4 ? 1 : current + 1;
    slide.textContent = `0${current} / 04`;
  }, 4200);
}

document.querySelectorAll('input[type="password"]').forEach((input) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pw-toggle';
  btn.textContent = 'Show';
  btn.setAttribute('aria-label', 'Show password');
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  input.insertAdjacentElement('afterend', btn);
});

document.querySelectorAll('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (e) => { if (!window.confirm(form.dataset.confirm)) e.preventDefault(); });
});
