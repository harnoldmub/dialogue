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

/* Thématiques — accordéon compact sur téléphone, toutes les fiches restent visibles sur grand écran. */
const themes = document.querySelector('.themes');
const themeDetails = themes ? [...themes.querySelectorAll('details')] : [];
const compactThemes = window.matchMedia('(max-width: 760px)');
const syncThemeAccordion = () => {
  if (compactThemes.matches) themeDetails.forEach((item, index) => { item.open = index === 0; });
  else themeDetails.forEach(item => { item.open = true; });
};
if (themeDetails.length) {
  syncThemeAccordion();
  compactThemes.addEventListener('change', syncThemeAccordion);
  themeDetails.forEach(item => item.addEventListener('toggle', () => {
    if (!compactThemes.matches || !item.open) return;
    themeDetails.forEach(other => { if (other !== item) other.open = false; });
  }));
}

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

/* Aperçu du parcours en modale — la page d'accueil n'est pas quittée. */
const apercu = document.querySelector('#apercu');
// Les liens gardent une destination réelle : sans script, ils mènent au formulaire.
document.querySelectorAll('#open-apercu, [data-open-apercu]').forEach(trigger => trigger.addEventListener('click', event => {
  event.preventDefault();
  apercu.showModal();
}));
document.querySelectorAll('#close-apercu, [data-close-apercu]').forEach(button => button.addEventListener('click', () => apercu.close()));
apercu?.addEventListener('click', event => { if (event.target === apercu) apercu.close(); });

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
