import './style.css';
import './identity.css';

// The existing CTAs retain their visual treatment while opening the dedicated flow.
document.querySelectorAll('a[href="#participer"]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault(); window.location.href = '/participer';
}));

const menu = document.querySelector('.menu-toggle');
const nav = document.querySelector('nav');
menu?.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') === 'true';
  menu.setAttribute('aria-expanded', String(!open));
  nav.classList.toggle('open', !open);
});
document.querySelectorAll('nav a').forEach(a => a.addEventListener('click', () => { nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); }));

const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('shown'); }), { threshold: .12 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

const tooltip = document.querySelector('.map-tooltip');
document.querySelectorAll('.province-shapes path').forEach(path => {
  const show = () => { tooltip.innerHTML = `<b>${path.dataset.name}</b><span>${path.dataset.count} contributions <small>— démonstration</small></span>`; };
  path.addEventListener('mouseenter', show); path.addEventListener('focus', show); path.addEventListener('click', show);
  path.setAttribute('tabindex', '0'); path.setAttribute('role', 'button'); path.setAttribute('aria-label', `${path.dataset.name}, ${path.dataset.count} contributions de démonstration`);
});
document.querySelector('.contribution-form')?.addEventListener('submit', event => { event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.textContent = 'Votre voix compte — merci !'; button.disabled = true; });
