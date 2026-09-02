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

/* Assistant guidé — cinq questions inspirées de l’allocution, sans chat libre ni service tiers. */
const chatbot = document.querySelector('#dialogue-assistant');
const chatbotLaunch = document.querySelector('.chatbot-launch');
if (chatbot && chatbotLaunch) {
  const questionNode = chatbot.querySelector('#chatbot-question');
  const subquestionNode = chatbot.querySelector('#chatbot-subquestion');
  const stepNode = chatbot.querySelector('#chatbot-step');
  const optionsNode = chatbot.querySelector('#chatbot-options');
  const backButton = chatbot.querySelector('.chatbot-back');
  const depositLink = chatbot.querySelector('.chatbot-deposit');
  const answers = [];
  let currentStep = 0;
  const steps = [
    {
      question: 'Quel est le premier enjeu de votre contribution ?',
      subquestion: 'Le Dialogue porte sur la paix, la cohésion nationale et la refondation de l’État.',
      options: [
        ['Paix et sécurité', 'Paix et sécurité'],
        ['Cohésion nationale', 'Cohésion nationale'],
        ['Refondation de l’État', 'Gouvernance']
      ]
    },
    {
      question: 'Quel aspect souhaitez-vous préciser ?',
      subquestion: () => ({
        'Paix et sécurité': 'Sous-question : protection des populations, retour des déplacés, autorité de l’État ou justice pour les victimes ?',
        'Cohésion nationale': 'Sous-question : tensions communautaires, réconciliation, inclusion ou lutte contre les discours de haine ?',
        'Gouvernance': 'Sous-question : service public, administration territoriale, responsabilité publique ou réforme institutionnelle ?'
      }[answers[0]?.theme] || 'Sous-question : quel problème concret observez-vous ?'),
      options: () => ({
        'Paix et sécurité': [['Protection des populations', 'Protection des populations'], ['Retour et sécurité des déplacés', 'Retour des déplacés'], ['Justice et réparation des victimes', 'Justice et réparation']],
        'Cohésion nationale': [['Apaisement des tensions', 'Apaisement'], ['Réconciliation et mémoire', 'Réconciliation'], ['Participation des jeunes et des femmes', 'Inclusion']],
        'Gouvernance': [['Présence de l’État dans le territoire', 'Présence de l’État'], ['Qualité du service public', 'Service public'], ['Transparence et redevabilité', 'Transparence']]
      }[answers[0]?.theme] || [])
    },
    {
      question: 'Dans quel cadre votre constat se situe-t-il ?',
      subquestion: 'Sous-question : indiquez l’échelle la plus proche de votre expérience.',
      options: [['Dans ma province ou mon territoire', 'Territoire'], ['Dans une ville ou un quartier', 'Ville'], ['Pour la diaspora congolaise', 'Diaspora'], ['À l’échelle nationale', 'National']]
    },
    {
      question: 'Quelle forme prend votre proposition ?',
      subquestion: 'Sous-question : le document appelle à des priorités claires, des responsabilités et des actions réalisables.',
      options: [['Une mesure immédiate', 'Mesure immédiate'], ['Une réforme à engager', 'Réforme'], ['Un mécanisme de suivi', 'Suivi'], ['Une initiative de dialogue local', 'Dialogue local']]
    },
    {
      question: 'Quel résultat attendez-vous en priorité ?',
      subquestion: 'Sous-question : choisissez le changement concret que votre contribution doit aider à obtenir.',
      options: [['Une population mieux protégée', 'Protection'], ['Une décision ou un service public amélioré', 'Service public'], ['Un engagement mesurable et suivi', 'Engagement suivi'], ['Une paix et une cohésion renforcées', 'Cohésion']]
    }
  ];
  const renderStep = () => {
    const step = steps[currentStep];
    const options = typeof step.options === 'function' ? step.options() : step.options;
    const subquestion = typeof step.subquestion === 'function' ? step.subquestion() : step.subquestion;
    stepNode.textContent = `Question ${currentStep + 1} sur ${steps.length}`;
    questionNode.textContent = step.question;
    subquestionNode.textContent = subquestion;
    optionsNode.replaceChildren();
    options.forEach(([label, value]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => {
        answers[currentStep] = { label, value, theme: currentStep === 0 ? value : answers[0]?.theme };
        if (currentStep < steps.length - 1) { currentStep += 1; renderStep(); }
        else renderSummary();
      });
      optionsNode.append(button);
    });
    backButton.hidden = currentStep === 0;
    depositLink.hidden = true;
  };
  const renderSummary = () => {
    stepNode.textContent = 'Parcours terminé';
    questionNode.textContent = 'Votre contribution est prête à être formulée.';
    subquestionNode.textContent = answers.map((answer, index) => `${index + 1}. ${answer.label}`).join(' · ');
    optionsNode.replaceChildren();
    backButton.hidden = false;
    depositLink.hidden = false;
    depositLink.href = `/participer?theme=${encodeURIComponent(answers[0]?.theme || '')}`;
  };
  const openChat = () => { chatbot.hidden = false; chatbotLaunch.setAttribute('aria-expanded', 'true'); currentStep = 0; answers.length = 0; renderStep(); chatbot.querySelector('.chatbot-close').focus(); };
  const closeChat = () => { chatbot.hidden = true; chatbotLaunch.setAttribute('aria-expanded', 'false'); chatbotLaunch.focus(); };
  chatbotLaunch.addEventListener('click', () => chatbot.hidden ? openChat() : closeChat());
  chatbot.querySelector('.chatbot-close').addEventListener('click', closeChat);
  backButton.addEventListener('click', () => { currentStep = Math.max(0, currentStep - 1); renderStep(); });
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
