import './style.css';
import './identity.css';

document.documentElement.classList.add('js');

/* Navigation mobile — la barre reste visible, seul le panneau se déplie. */
const menu = document.querySelector('.menu-toggle');
const nav = document.querySelector('.main-nav');
menu?.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') === 'true';
  menu.setAttribute('aria-expanded', String(!open));
  nav.classList.toggle('open', !open);
});
nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  nav.classList.remove('open');
  menu?.setAttribute('aria-expanded', 'false');
}));

/* Révélations d'entrée — discrètes, une seule fois par élément. */
const reveal = new IntersectionObserver((entries, self) => entries.forEach(entry => {
  if (!entry.isIntersecting) return;
  entry.target.classList.add('shown');
  self.unobserve(entry.target);
}), { threshold: .05, rootMargin: '0px 0px -5% 0px' });
document.querySelectorAll('.reveal').forEach(el => reveal.observe(el));

/* Déclaration — chaque mot passe du gris au noir dans l'ordre de lecture. */
const statement = document.querySelector('[data-statement]');
if (statement) {
  const words = statement.textContent.trim().split(/\s+/);
  statement.textContent = '';
  words.forEach((word, index) => {
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = index === words.length - 1 ? word : `${word} `;
    statement.append(span);
  });
  const wordObserver = new IntersectionObserver((entries, self) => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const spans = [...statement.querySelectorAll('.w')];
    spans.forEach((span, index) => setTimeout(() => span.classList.add('on'), index * 45));
    self.disconnect();
  }), { threshold: .4 });
  wordObserver.observe(statement);
}

/* Repérage de la section courante dans la navigation. */
const links = [...document.querySelectorAll('.main-nav a[href^="#"]')];
const sections = links.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
if (sections.length) {
  const spy = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      links.forEach(link => link.removeAttribute('aria-current'));
      const active = links.find(link => link.getAttribute('href') === `#${entry.target.id}`);
      active?.setAttribute('aria-current', 'true');
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach(section => spy.observe(section));
}
