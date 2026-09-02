import './admin.css';

const app = document.querySelector('#admin-app');
const STATUS_LABELS = {
  RECEIVED: 'Reçue', IN_REVIEW: 'En examen', NEEDS_FOLLOW_UP: 'À compléter', VALIDATED: 'Validée',
  DUPLICATE: 'Doublon', OUT_OF_SCOPE: 'Hors sujet', REJECTED: 'Rejetée', ARCHIVED: 'Archivée'
};
const PRIORITY_LABELS = { 0: 'Normale', 1: 'Suivie', 2: 'Haute', 3: 'Urgente' };
const ROLE_LABELS = { SUPER_ADMIN: 'Super administrateur', ADMIN: 'Administrateur', ANALYST: 'Analyste', VIEWER: 'Lecture seule' };
const ACTION_LABELS = {
  LOGIN: 'Connexion', LOGIN_FAILED: 'Échec de connexion', LOGOUT: 'Déconnexion',
  CONTRIBUTION_UPDATED: 'Contribution modifiée', CONTRIBUTIONS_BULK_UPDATED: 'Modification groupée',
  COMMENT_ADDED: 'Commentaire ajouté', TAGS_UPDATED: 'Tags modifiés', TAG_CREATED: 'Tag créé',
  AUDIO_STREAMED: 'Écoute audio', FILE_DOWNLOADED: 'Document téléchargé', EXPORT_CSV: 'Export CSV',
  SUMMARY_CREATED: 'Synthèse créée', SUMMARY_UPDATED: 'Synthèse modifiée', USER_CREATED: 'Utilisateur créé', USER_UPDATED: 'Utilisateur modifié'
};
const VIEWS = [
  { route: 'tableau-de-bord', label: 'Tableau de bord', permission: 'analytics:read' },
  { route: 'contributions', label: 'Contributions' },
  { route: 'analyse', label: 'Analyse et diaspora', permission: 'analytics:read' },
  { route: 'syntheses', label: 'Synthèses', permission: 'summaries:write' },
  { route: 'utilisateurs', label: 'Utilisateurs', superAdmin: true },
  { route: 'audit', label: 'Journal d’audit', superAdmin: true }
];

const state = {
  user: null, csrf: null, meta: null,
  filters: { q: '', status: '', theme: '', country: '', format: '', priority: '', unread: '', assignedTo: '' },
  page: 1, sort: 'created_at', dir: 'desc', selection: new Set()
};

const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const fmtDate = value => value ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const fmtDay = value => value ? new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(new Date(value)) : '';
const fmtNumber = value => new Intl.NumberFormat('fr-FR').format(Number(value || 0));
const statusLabel = status => STATUS_LABELS[status] || status;
const canSuperAdmin = () => state.user?.role === 'SUPER_ADMIN';
const canWrite = () => ['SUPER_ADMIN', 'ADMIN', 'ANALYST'].includes(state.user?.role);

async function api(url, options = {}){
  const { resetOnUnauthorized = true, ...request } = options;
  const headers = { ...(request.headers || {}) };
  if (request.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(request.method || 'GET') && state.csrf) headers['x-csrf-token'] = state.csrf;
  let response;
  try {
    response = await fetch(url, { ...request, headers, credentials: 'same-origin' });
  } catch {
    throw new Error('Le serveur est inaccessible. Vérifiez que le projet est bien lancé.');
  }
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    state.user = null;
    if (resetOnUnauthorized) login();
    throw new Error(body.error || 'Votre session a expiré. Veuillez vous reconnecter.');
  }
  if (!response.ok) throw new Error(body.error || (response.status >= 500 ? 'Le serveur est momentanément indisponible.' : 'Une erreur est survenue.'));
  return response.status === 204 ? null : body;
}

function toast(message, tone = 'ok'){
  const node = document.createElement('div');
  node.className = `toast ${tone}`;
  node.setAttribute('role', 'status');
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 3600);
}

/* — Connexion — */
function login(){
  app.innerHTML = `<section class="login"><div class="login-layout"><aside class="login-intro"><div class="institution-mark"><i></i><i></i><i></i></div><p class="eyebrow">République démocratique du Congo</p><h2>Dialogue national</h2><p>Un espace de travail confidentiel pour organiser, analyser et faire vivre les contributions citoyennes.</p><div class="login-intro-rule"></div><p class="login-intro-note">Accès réservé aux équipes habilitées.</p></aside><form class="login-card" novalidate data-test="login-form"><p class="eyebrow">Espace sécurisé</p><h1>Administration</h1><p class="login-lead">Connectez-vous pour accéder au pilotage du Dialogue national.</p><label class="field">Adresse électronique<input name="email" type="email" required autocomplete="username" placeholder="nom@organisation.cd" /></label><label class="field">Mot de passe<span class="password-field"><input name="password" type="password" required autocomplete="current-password" /><button class="toggle-password" type="button" aria-pressed="false">Afficher</button></span></label><button class="btn login-submit" type="submit">Se connecter <span aria-hidden="true">→</span></button><p class="login-help">Vous ne parvenez pas à vous connecter ? Contactez l’administrateur de la plateforme.</p><p class="error" role="alert" aria-live="assertive" hidden></p></form></div></section>`;
  const form = app.querySelector('form');
  const password = form.querySelector('[name="password"]');
  const toggle = form.querySelector('.toggle-password');
  toggle.onclick = () => {
    const visible = password.type === 'text';
    password.type = visible ? 'password' : 'text';
    toggle.textContent = visible ? 'Afficher' : 'Masquer';
    toggle.setAttribute('aria-pressed', String(!visible));
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const error = form.querySelector('.error');
    const button = form.querySelector('.login-submit');
    error.hidden = true;
    if (!form.reportValidity()) return;
    button.disabled = true;
    button.textContent = 'Connexion…';
    try {
      const data = new FormData(form);
      const session = await api('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
        resetOnUnauthorized: false
      });
      state.user = session.user;
      state.csrf = session.csrfToken;
      await start();
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message;
      button.disabled = false;
      button.innerHTML = 'Se connecter <span aria-hidden="true">→</span>';
      password.focus();
    }
  };
}

/* — Cadre applicatif — */
function shell(){
  const items = VIEWS.filter(view => !view.superAdmin || canSuperAdmin());
  app.innerHTML = `<div class="shell">
    <aside class="sidebar">
      <div class="brand">République démocratique du Congo<strong>Dialogue national</strong></div>
      <nav class="nav" aria-label="Sections de l’administration">${items.map(view => `<a href="#/${view.route}" data-route="${view.route}">${view.label}</a>`).join('')}</nav>
      <p class="sidebar-foot">Espace sécurisé · <a href="/" target="_blank" rel="noopener">Voir le site</a></p>
    </aside>
    <div class="main">
      <header class="topbar">
        <div><h1 id="view-title">Administration</h1><p class="view-subtitle" id="view-subtitle"></p></div>
        <div class="user"><span><strong>${esc(state.user.displayName)}</strong><br>${esc(ROLE_LABELS[state.user.role] || state.user.role)}</span><button class="btn subtle" id="logout">Déconnexion</button></div>
      </header>
      <section class="content" id="view" tabindex="-1"></section>
    </div>
  </div>`;
  app.querySelector('#logout').onclick = async () => {
    await api('/api/admin/auth/logout', { method: 'POST' }).catch(() => {});
    state.user = null;
    state.csrf = null;
    location.hash = '';
    login();
  };
}

function view(title, subtitle = ''){
  const route = location.hash.replace(/^#\//, '').split('/')[0] || 'tableau-de-bord';
  app.querySelector('#view-title').textContent = title;
  app.querySelector('#view-subtitle').textContent = subtitle;
  app.querySelectorAll('[data-route]').forEach(link => link.classList.toggle('active', link.dataset.route === route));
  document.title = `${title} — Administration Congo Dialogue`;
  return app.querySelector('#view');
}

const skeleton = (rows = 4) => `<div class="skeleton">${Array.from({ length: rows }, () => '<span></span>').join('')}</div>`;

function guard(node, error){
  node.innerHTML = `<div class="panel error-panel"><h2>Impossible d’afficher cette vue</h2><p>${esc(error.message)}</p><button class="btn subtle" onclick="location.reload()">Recharger</button></div>`;
}

/* — Tableau de bord — */
async function dashboard(){
  const node = view('Tableau de bord', 'Vue d’ensemble des contributions reçues');
  node.innerHTML = skeleton(3);
  try {
    const data = await api('/api/admin/dashboard');
    const kpis = [
      { key: 'total', label: 'Contributions', hint: 'Total reçu' },
      { key: 'unread', label: 'Non consultées', hint: 'Jamais ouvertes', filter: 'unread=true' },
      { key: 'new', label: 'À traiter', hint: 'Statut « Reçue »', filter: 'status=RECEIVED' },
      { key: 'processing', label: 'En traitement', hint: 'En examen ou à compléter', filter: 'status=IN_REVIEW' },
      { key: 'validated', label: 'Validées', hint: 'Retenues pour la synthèse', filter: 'status=VALIDATED' },
      { key: 'unassigned', label: 'Non assignées', hint: 'Sans agent responsable' },
      { key: 'audio', label: 'Notes vocales', hint: 'Contiennent un enregistrement', filter: 'format=audio' },
      { key: 'diaspora', label: 'Diaspora', hint: 'Déposées hors du pays', filter: 'diaspora=true' }
    ];
    // Le graphique couvre les trente jours, y compris ceux sans dépôt : sinon une seule journée occupe toute la largeur.
    const counts = new Map(data.timeline.map(day => [day.day, day.count]));
    const days = Array.from({ length: 30 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (29 - index));
      const key = date.toISOString().slice(0, 10);
      return { day: key, count: counts.get(key) || 0 };
    });
    const maxDay = Math.max(1, ...days.map(day => day.count));
    const maxTheme = Math.max(1, ...data.themes.map(theme => theme.count));
    node.innerHTML = `
      <div class="kpis">${kpis.map(kpi => `
        <${kpi.filter ? 'a' : 'div'} class="kpi"${kpi.filter ? ` href="#/contributions?${kpi.filter}"` : ''} data-test="kpi-${kpi.key}">
          <b>${fmtNumber(data.kpi[kpi.key])}</b><span>${kpi.label}</span><small>${kpi.hint}</small>
        </${kpi.filter ? 'a' : 'div'}>`).join('')}</div>
      <div class="grid-2">
        <div class="panel">
          <h2>Dépôts des trente derniers jours</h2>
          ${days.some(day => day.count) ? `<div class="timeline">${days.map(day => `<span style="--h:${Math.round(day.count / maxDay * 100)}%" title="${fmtDay(day.day)} : ${day.count}"><i></i><em>${fmtDay(day.day)}</em></span>`).join('')}</div>` : '<p class="empty">Aucun dépôt sur la période.</p>'}
        </div>
        <div class="panel">
          <h2>Répartition par thématique</h2>
          ${data.themes.length ? `<ul class="bars">${data.themes.map(theme => `<li><span>${esc(theme.theme)}</span><i style="--w:${Math.round(theme.count / maxTheme * 100)}%"></i><b>${fmtNumber(theme.count)}</b></li>`).join('')}</ul>` : '<p class="empty">Aucune contribution.</p>'}
        </div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <h2>Derniers dépôts</h2>
          ${data.recent.length ? `<ul class="recent">${data.recent.map(item => `<li><a href="#/contributions/${item.id}"><b>${esc(item.reference)}${item.read_at ? '' : '<em class="dot" title="Non consultée"></em>'}</b><span>${esc(item.first_name)} ${esc(item.last_name)} · ${esc(item.theme)}</span><small>${fmtDate(item.created_at)}</small></a></li>`).join('')}</ul>` : '<p class="empty">Aucune contribution.</p>'}
        </div>
        <div class="panel">
          <h2>Provinces les plus actives</h2>
          ${data.provinces.length ? `<ul class="bars">${data.provinces.map(row => `<li><span>${esc(row.province)}</span><i style="--w:${Math.round(row.count / Math.max(1, data.provinces[0].count) * 100)}%"></i><b>${fmtNumber(row.count)}</b></li>`).join('')}</ul>` : '<p class="empty">Aucune contribution en RDC.</p>'}
        </div>
      </div>`;
  } catch (error) { guard(node, error); }
}

/* — Contributions — */
function filtersToQuery(){
  const params = new URLSearchParams();
  Object.entries(state.filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  return params;
}

async function contributions(){
  const node = view('Contributions', 'Rechercher, filtrer et traiter les dépôts citoyens');
  node.innerHTML = skeleton(5);
  try {
    if (!state.meta) state.meta = await api('/api/admin/filters');
    const params = filtersToQuery();
    params.set('page', state.page);
    params.set('sort', state.sort);
    params.set('dir', state.dir);
    const data = await api(`/api/admin/contributions?${params}`);
    const pages = Math.max(1, Math.ceil(data.total / data.limit));
    const columns = [['reference', 'Référence'], ['created_at', 'Reçue le'], [null, 'Contributeur'], [null, 'Origine'], [null, 'Thématique'], [null, 'Formats'], ['status', 'Statut'], ['priority', 'Priorité'], [null, 'Assignée à']];
    node.innerHTML = `
      <form class="filters" data-test="filters">
        <label class="filter grow">Recherche<input name="q" value="${esc(state.filters.q)}" placeholder="Référence, nom, courriel, contenu…" data-test="filter-q" /></label>
        <label class="filter">Statut<select name="status">${['', ...state.meta.statuses].map(status => `<option value="${status}" ${state.filters.status === status ? 'selected' : ''}>${status ? statusLabel(status) : 'Tous'}</option>`).join('')}</select></label>
        <label class="filter">Thématique<select name="theme">${['', ...state.meta.themes].map(theme => `<option ${state.filters.theme === theme ? 'selected' : ''}>${theme || 'Toutes'}</option>`).join('')}</select></label>
        <label class="filter">Pays<select name="country">${['', ...state.meta.countries].map(country => `<option ${state.filters.country === country ? 'selected' : ''}>${country || 'Tous'}</option>`).join('')}</select></label>
        <label class="filter">Format<select name="format">${[['', 'Tous'], ['text', 'Texte'], ['audio', 'Note vocale'], ['document', 'Document']].map(([value, label]) => `<option value="${value}" ${state.filters.format === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label class="filter">Priorité<select name="priority">${[['', 'Toutes'], ['0', 'Normale'], ['1', 'Suivie'], ['2', 'Haute'], ['3', 'Urgente']].map(([value, label]) => `<option value="${value}" ${state.filters.priority === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label class="filter">Assignée à<select name="assignedTo"><option value="">Tous</option>${state.meta.users.map(user => `<option value="${user.id}" ${state.filters.assignedTo === user.id ? 'selected' : ''}>${esc(user.displayName)}</option>`).join('')}</select></label>
        <label class="filter check"><input type="checkbox" name="unread" value="true" ${state.filters.unread ? 'checked' : ''} /> Non consultées</label>
        <div class="filter-actions">
          <button class="btn" type="submit">Filtrer</button>
          <button class="btn subtle" type="button" id="reset">Réinitialiser</button>
          <a class="btn subtle" href="/api/admin/exports/contributions.csv?${filtersToQuery()}" data-test="export">Exporter en CSV</a>
        </div>
      </form>
      ${canWrite() ? `<div class="bulk" id="bulk" hidden>
        <span><b id="bulk-count">0</b> sélectionnée(s)</span>
        <label>Statut<select id="bulk-status"><option value="">—</option>${state.meta.statuses.map(status => `<option value="${status}">${statusLabel(status)}</option>`).join('')}</select></label>
        <label>Assigner<select id="bulk-assign"><option value="">—</option><option value="none">Retirer l’assignation</option>${state.meta.users.map(user => `<option value="${user.id}">${esc(user.displayName)}</option>`).join('')}</select></label>
        <button class="btn" id="bulk-apply">Appliquer</button>
        <button class="btn subtle" id="bulk-clear">Annuler</button>
      </div>` : ''}
      <div class="panel">
        <div class="table-wrap">
          <table data-test="contributions-table">
            <thead><tr>${canWrite() ? '<th class="pick"><input type="checkbox" id="pick-all" aria-label="Tout sélectionner" /></th>' : ''}${columns.map(([key, label]) => key
              ? `<th><button class="sort ${state.sort === key ? 'on' : ''}" data-sort="${key}">${label}${state.sort === key ? (state.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>`
              : `<th>${label}</th>`).join('')}</tr></thead>
            <tbody>${data.items.map(item => `<tr data-id="${item.id}" class="${item.read_at ? '' : 'unread'}">
              ${canWrite() ? `<td class="pick"><input type="checkbox" data-pick="${item.id}" aria-label="Sélectionner ${esc(item.reference)}" ${state.selection.has(item.id) ? 'checked' : ''} /></td>` : ''}
              <td class="reference"><a href="#/contributions/${item.id}">${esc(item.reference)}</a></td>
              <td>${fmtDate(item.created_at)}</td>
              <td>${esc(item.first_name)} ${esc(item.last_name)}<br><span class="muted">${esc(item.profile || 'Profil non précisé')}</span></td>
              <td>${esc(item.country)}<br><span class="muted">${esc(item.province || '—')}</span></td>
              <td>${esc(item.theme)}</td>
              <td>${formats(item)}</td>
              <td><span class="status ${item.status}">${statusLabel(item.status)}</span></td>
              <td><span class="priority p${item.priority}">${PRIORITY_LABELS[item.priority]}</span></td>
              <td>${esc(item.assigned_name || 'Non assignée')}</td>
            </tr>`).join('') || `<tr><td colspan="${columns.length + (canWrite() ? 1 : 0)}" class="empty">Aucune contribution ne correspond à ces filtres.</td></tr>`}</tbody>
          </table>
        </div>
        <div class="pagination">
          <span class="muted">${fmtNumber(data.total)} résultat(s) · page ${data.page} sur ${pages}</span>
          <span class="pager">
            <button class="btn subtle" id="prev" ${data.page <= 1 ? 'disabled' : ''}>← Précédente</button>
            <button class="btn subtle" id="next" ${data.page >= pages ? 'disabled' : ''}>Suivante →</button>
          </span>
        </div>
      </div>`;

    const form = node.querySelector('.filters');
    form.onsubmit = event => {
      event.preventDefault();
      const data = new FormData(form);
      Object.keys(state.filters).forEach(key => { state.filters[key] = key === 'unread' ? (data.get('unread') ? 'true' : '') : (data.get(key) || ''); });
      Object.keys(state.filters).forEach(key => { if (state.filters[key] === 'Tous' || state.filters[key] === 'Toutes') state.filters[key] = ''; });
      state.page = 1;
      state.selection.clear();
      contributions();
    };
    node.querySelector('#reset').onclick = () => {
      Object.keys(state.filters).forEach(key => { state.filters[key] = ''; });
      state.page = 1;
      state.selection.clear();
      contributions();
    };
    node.querySelectorAll('[data-sort]').forEach(button => button.onclick = () => {
      state.dir = state.sort === button.dataset.sort && state.dir === 'desc' ? 'asc' : 'desc';
      state.sort = button.dataset.sort;
      contributions();
    });
    node.querySelector('#prev').onclick = () => { state.page = Math.max(1, state.page - 1); contributions(); };
    node.querySelector('#next').onclick = () => { state.page = state.page + 1; contributions(); };
    node.querySelectorAll('tbody tr[data-id]').forEach(row => row.addEventListener('click', event => {
      if (event.target.closest('input,a')) return;
      location.hash = `#/contributions/${row.dataset.id}`;
    }));
    if (canWrite()) bindBulk(node, data.items);
  } catch (error) { guard(node, error); }
}

function formats(item){
  const parts = [];
  if (item.has_audio) parts.push('<span class="pill">Vocale</span>');
  if (item.has_files) parts.push('<span class="pill">Document</span>');
  if (!parts.length) parts.push('<span class="pill">Texte</span>');
  return parts.join(' ');
}

function bindBulk(node, items){
  const bar = node.querySelector('#bulk');
  const count = node.querySelector('#bulk-count');
  const refresh = () => {
    count.textContent = state.selection.size;
    bar.hidden = state.selection.size === 0;
    const all = node.querySelector('#pick-all');
    all.checked = items.length > 0 && items.every(item => state.selection.has(item.id));
  };
  node.querySelectorAll('[data-pick]').forEach(box => box.onchange = () => {
    box.checked ? state.selection.add(box.dataset.pick) : state.selection.delete(box.dataset.pick);
    refresh();
  });
  node.querySelector('#pick-all').onchange = event => {
    items.forEach(item => event.target.checked ? state.selection.add(item.id) : state.selection.delete(item.id));
    node.querySelectorAll('[data-pick]').forEach(box => { box.checked = event.target.checked; });
    refresh();
  };
  node.querySelector('#bulk-clear').onclick = () => {
    state.selection.clear();
    node.querySelectorAll('[data-pick]').forEach(box => { box.checked = false; });
    refresh();
  };
  node.querySelector('#bulk-apply').onclick = async () => {
    const status = node.querySelector('#bulk-status').value;
    const assign = node.querySelector('#bulk-assign').value;
    if (!status && !assign) return toast('Choisissez un statut ou une assignation.', 'warn');
    const payload = { ids: [...state.selection] };
    if (status) payload.status = status;
    if (assign) payload.assignedTo = assign === 'none' ? null : assign;
    try {
      const result = await api('/api/admin/contributions/bulk', { method: 'POST', body: JSON.stringify(payload) });
      toast(`${result.updated} contribution(s) mise(s) à jour.`);
      state.selection.clear();
      contributions();
    } catch (error) { toast(error.message, 'warn'); }
  };
  refresh();
}

/* — Détail d’une contribution — */
async function detail(id){
  const node = view('Contribution', 'Traitement et suivi du dépôt');
  node.innerHTML = skeleton(4);
  try {
    if (!state.meta) state.meta = await api('/api/admin/filters');
    const item = await api(`/api/admin/contributions/${id}`);
    const editable = canWrite();
    view(item.reference, `Reçue le ${fmtDate(item.created_at)}`);
    node.innerHTML = `
      <p class="crumbs"><a href="#/contributions">← Toutes les contributions</a></p>
      <div class="detail">
        <div>
          <section class="panel">
            <h2>Contributeur</h2>
            <div class="meta">
              <div><b>Identité</b>${esc(item.first_name)} ${esc(item.last_name)}</div>
              <div><b>Courriel</b><a href="mailto:${esc(item.email)}">${esc(item.email)}</a></div>
              <div><b>Téléphone</b>${esc(item.phone || '—')}</div>
              <div><b>Profil</b>${esc(item.profile || '—')}</div>
              <div><b>Origine</b>${esc(item.country)} · ${esc(item.city)}</div>
              <div><b>Province</b>${esc(item.province || '—')}</div>
              <div><b>Thématique</b>${esc(item.theme)}</div>
              <div><b>Titre</b>${esc(item.title || '—')}</div>
            </div>
          </section>
          ${item.text_content ? `<section class="panel"><h2>Contribution écrite</h2><p class="prose">${esc(item.text_content)}</p></section>` : ''}
          ${item.audio_key ? `<section class="panel">
            <h2>Note vocale</h2>
            <audio controls preload="metadata" src="/api/admin/contributions/${item.id}/audio"></audio>
            <p class="muted">${item.audio_duration ? `${item.audio_duration} secondes` : 'Durée inconnue'} · ${esc(item.audio_mime || 'audio')}</p>
            <label class="field">Transcription<textarea id="transcription" rows="6" ${editable ? '' : 'readonly'}>${esc(item.transcription || '')}</textarea></label>
            <label class="field">Langue détectée<input id="language" value="${esc(item.detected_language || '')}" placeholder="Français, lingala, swahili…" ${editable ? '' : 'readonly'} /></label>
          </section>` : ''}
          ${item.files.length ? `<section class="panel"><h2>Documents joints</h2><ul class="files">${item.files.map(file => `<li><a href="/api/admin/contributions/${item.id}/files/${file.id}">${esc(file.original_name)}</a><span class="muted">${Math.max(1, Math.round(file.size / 1024))} Ko · ${esc(file.mime_type)}</span></li>`).join('')}</ul></section>` : ''}
          <section class="panel">
            <h2>Commentaires internes</h2>
            <div class="comments">${item.comments.map(comment => `<article class="comment"><b>${esc(comment.display_name || 'Utilisateur')}</b><time>${fmtDate(comment.created_at)}</time><p>${esc(comment.body)}</p></article>`).join('') || '<p class="empty">Aucun commentaire pour l’instant.</p>'}</div>
            ${editable ? `<label class="field">Nouveau commentaire<textarea id="comment" rows="3" placeholder="Précision, point de vigilance, suite à donner…"></textarea></label><button class="btn" id="comment-save" data-test="comment-save">Enregistrer le commentaire</button>` : ''}
          </section>
        </div>
        <aside>
          <section class="panel">
            <h2>Traitement</h2>
            <label class="field">Statut<select id="status" ${editable ? '' : 'disabled'} data-test="status">${state.meta.statuses.map(status => `<option value="${status}" ${item.status === status ? 'selected' : ''}>${statusLabel(status)}</option>`).join('')}</select></label>
            <label class="field">Priorité<select id="priority" ${editable ? '' : 'disabled'}>${Object.entries(PRIORITY_LABELS).map(([value, label]) => `<option value="${value}" ${String(item.priority) === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
            <label class="field">Assignée à<select id="assigned" ${editable ? '' : 'disabled'}><option value="">Non assignée</option>${state.meta.users.map(user => `<option value="${user.id}" ${item.assigned_to === user.id ? 'selected' : ''}>${esc(user.displayName)}</option>`).join('')}</select></label>
            <label class="field">Note interne<textarea id="note" rows="3" ${editable ? '' : 'readonly'}>${esc(item.internal_note || '')}</textarea></label>
            ${editable ? '<button class="btn" id="save" data-test="save">Enregistrer</button>' : '<p class="muted">Votre rôle donne un accès en lecture seule.</p>'}
          </section>
          <section class="panel">
            <h2>Tags</h2>
            <div class="tags" id="tags">${state.meta.tags.length ? state.meta.tags.map(tag => `<label class="tag"><input type="checkbox" value="${tag.id}" ${item.tags.some(current => current.id === tag.id) ? 'checked' : ''} ${editable ? '' : 'disabled'} />${esc(tag.name)}</label>`).join('') : '<p class="muted">Aucun tag créé.</p>'}</div>
            ${editable ? `<div class="tag-create"><input id="tag-name" placeholder="Nouveau tag" maxlength="80" /><button class="btn subtle" id="tag-add">Créer</button></div>` : ''}
          </section>
          <section class="panel">
            <h2>Historique</h2>
            <ul class="history">${item.history.map(entry => `<li><time>${fmtDate(entry.created_at)}</time>${esc(statusLabel(entry.from_status) || 'Dépôt')} → <b>${esc(statusLabel(entry.to_status))}</b><span class="muted">${esc(entry.display_name || 'Système')}</span></li>`).join('') || '<li class="muted">Aucun changement enregistré.</li>'}</ul>
          </section>
        </aside>
      </div>`;

    if (!editable) return;
    node.querySelector('#save').onclick = async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await api(`/api/admin/contributions/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: node.querySelector('#status').value,
            priority: Number(node.querySelector('#priority').value),
            assignedTo: node.querySelector('#assigned').value || null,
            internalNote: node.querySelector('#note').value,
            transcription: node.querySelector('#transcription')?.value,
            detectedLanguage: node.querySelector('#language')?.value || null
          })
        });
        const tagIds = [...node.querySelectorAll('#tags input:checked')].map(box => box.value);
        await api(`/api/admin/contributions/${id}/tags`, { method: 'PUT', body: JSON.stringify({ tagIds }) });
        toast('Traitement enregistré.');
        detail(id);
      } catch (error) {
        toast(error.message, 'warn');
        button.disabled = false;
      }
    };
    node.querySelector('#comment-save').onclick = async () => {
      const body = node.querySelector('#comment').value.trim();
      if (!body) return toast('Le commentaire est vide.', 'warn');
      try {
        await api(`/api/admin/contributions/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
        toast('Commentaire enregistré.');
        detail(id);
      } catch (error) { toast(error.message, 'warn'); }
    };
    node.querySelector('#tag-add').onclick = async () => {
      const name = node.querySelector('#tag-name').value.trim();
      if (!name) return;
      try {
        await api('/api/admin/tags', { method: 'POST', body: JSON.stringify({ name }) });
        state.meta = await api('/api/admin/filters');
        toast('Tag créé.');
        detail(id);
      } catch (error) { toast(error.message, 'warn'); }
    };
  } catch (error) { guard(node, error); }
}

/* — Analyse — */
async function analysis(){
  const node = view('Analyse et diaspora', 'Répartition géographique et thématique');
  node.innerHTML = skeleton(2);
  try {
    const data = await api('/api/admin/analysis');
    const maxTheme = Math.max(1, ...data.themes.map(theme => theme.contributions));
    node.innerHTML = `
      <div class="grid-2">
        <div class="panel">
          <h2>Contributions de la diaspora</h2>
          ${data.diaspora.length ? `<div class="table-wrap"><table><thead><tr><th>Pays</th><th>Contributions</th><th>Contributeurs</th></tr></thead><tbody>${data.diaspora.map(row => `<tr><td>${esc(row.country)}</td><td>${fmtNumber(row.contributions)}</td><td>${fmtNumber(row.contributors)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Aucune contribution hors du pays.</p>'}
        </div>
        <div class="panel">
          <h2>Poids des thématiques</h2>
          ${data.themes.length ? `<ul class="bars">${data.themes.map(theme => `<li><span>${esc(theme.theme)}</span><i style="--w:${Math.round(theme.contributions / maxTheme * 100)}%"></i><b>${fmtNumber(theme.contributions)}</b></li>`).join('')}</ul>` : '<p class="empty">Aucune contribution.</p>'}
        </div>
      </div>`;
  } catch (error) { guard(node, error); }
}

/* — Synthèses — */
async function summaries(){
  const node = view('Synthèses', 'Notes de synthèse préparées à partir des contributions');
  node.innerHTML = skeleton(3);
  try {
    const items = await api('/api/admin/summaries');
    node.innerHTML = `
      <div class="grid-2">
        <div class="panel">
          <h2>Nouvelle synthèse</h2>
          <label class="field">Titre<input id="summary-title" maxlength="240" placeholder="Ex. Santé — priorités du Sud-Kivu" /></label>
          <label class="field">Thématique <span class="muted">facultatif</span><input id="summary-theme" maxlength="100" /></label>
          <label class="field">Contenu<textarea id="summary-body" rows="8" placeholder="Constats convergents, propositions retenues, points de vigilance…"></textarea></label>
          <button class="btn" id="summary-save" data-test="summary-save">Créer la synthèse</button>
        </div>
        <div class="panel">
          <h2>Synthèses enregistrées</h2>
          ${items.length ? `<ul class="recent">${items.map(item => `<li><a href="#/syntheses/${item.id}"><b>${esc(item.title)}</b><span>${esc(item.theme || 'Toutes thématiques')} · ${esc(item.status)}</span><small>Mise à jour ${fmtDate(item.updated_at)} · ${esc(item.display_name || 'Système')}</small></a></li>`).join('')}</ul>` : '<p class="empty">Aucune synthèse enregistrée.</p>'}
        </div>
      </div>`;
    node.querySelector('#summary-save').onclick = async () => {
      const title = node.querySelector('#summary-title').value.trim();
      if (title.length < 3) return toast('Le titre doit contenir au moins trois caractères.', 'warn');
      try {
        await api('/api/admin/summaries', {
          method: 'POST',
          body: JSON.stringify({ title, theme: node.querySelector('#summary-theme').value.trim() || undefined, body: node.querySelector('#summary-body').value })
        });
        toast('Synthèse créée.');
        summaries();
      } catch (error) { toast(error.message, 'warn'); }
    };
  } catch (error) { guard(node, error); }
}

async function summaryDetail(id){
  const node = view('Synthèse', 'Rédaction et contributions rattachées');
  node.innerHTML = skeleton(3);
  try {
    const summary = await api(`/api/admin/summaries/${id}`);
    view(summary.title, `Mise à jour ${fmtDate(summary.updated_at)}`);
    node.innerHTML = `
      <p class="crumbs"><a href="#/syntheses">← Toutes les synthèses</a></p>
      <div class="detail">
        <div class="panel">
          <h2>Contenu</h2>
          <label class="field">Titre<input id="title" value="${esc(summary.title)}" maxlength="240" /></label>
          <label class="field">Thématique<input id="theme" value="${esc(summary.theme || '')}" maxlength="100" /></label>
          <label class="field">Statut<select id="status">${['DRAFT', 'REVIEW', 'PUBLISHED'].map(status => `<option value="${status}" ${summary.status === status ? 'selected' : ''}>${{ DRAFT: 'Brouillon', REVIEW: 'En relecture', PUBLISHED: 'Publiée' }[status]}</option>`).join('')}</select></label>
          <label class="field">Texte<textarea id="body" rows="14">${esc(summary.body || '')}</textarea></label>
          <button class="btn" id="save" data-test="summary-update">Enregistrer</button>
        </div>
        <aside class="panel">
          <h2>Contributions rattachées</h2>
          ${summary.contributions.length ? `<ul class="recent">${summary.contributions.map(item => `<li><a href="#/contributions/${item.id}"><b>${esc(item.reference)}</b><span>${esc(item.theme)} · ${esc(item.country)}</span><small>${statusLabel(item.status)}</small></a></li>`).join('')}</ul>` : '<p class="empty">Aucune contribution rattachée. Sélectionnez des contributions puis utilisez « Rattacher » depuis la liste.</p>'}
        </aside>
      </div>`;
    node.querySelector('#save').onclick = async () => {
      try {
        await api(`/api/admin/summaries/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            title: node.querySelector('#title').value.trim(),
            theme: node.querySelector('#theme').value.trim() || null,
            status: node.querySelector('#status').value,
            body: node.querySelector('#body').value
          })
        });
        toast('Synthèse enregistrée.');
        summaryDetail(id);
      } catch (error) { toast(error.message, 'warn'); }
    };
  } catch (error) { guard(node, error); }
}

/* — Utilisateurs — */
async function users(){
  const node = view('Utilisateurs', 'Comptes habilités à accéder au backoffice');
  node.innerHTML = skeleton(3);
  try {
    const items = await api('/api/admin/users');
    node.innerHTML = `
      <div class="panel">
        <h2>Comptes</h2>
        <div class="table-wrap">
          <table data-test="users-table">
            <thead><tr><th>Nom</th><th>Adresse électronique</th><th>Rôle</th><th>Dernière connexion</th><th>État</th><th></th></tr></thead>
            <tbody>${items.map(user => `<tr data-id="${user.id}">
              <td>${esc(user.displayName)}</td>
              <td>${esc(user.email)}</td>
              <td><select data-role="${user.id}" ${user.id === state.user.id ? 'disabled' : ''}>${Object.entries(ROLE_LABELS).map(([role, label]) => `<option value="${role}" ${user.role === role ? 'selected' : ''}>${label}</option>`).join('')}</select></td>
              <td>${fmtDate(user.lastLoginAt)}</td>
              <td><span class="status ${user.active ? 'VALIDATED' : 'REJECTED'}">${user.active ? 'Actif' : 'Désactivé'}</span></td>
              <td class="row-actions"><button class="btn subtle" data-toggle="${user.id}" data-active="${user.active}" ${user.id === state.user.id ? 'disabled' : ''}>${user.active ? 'Désactiver' : 'Réactiver'}</button></td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <h2>Créer un compte</h2>
        <form class="new-user" data-test="new-user">
          <label class="field">Nom affiché<input name="displayName" required minlength="2" maxlength="120" /></label>
          <label class="field">Adresse électronique<input name="email" type="email" required /></label>
          <label class="field">Rôle<select name="role">${Object.entries(ROLE_LABELS).map(([role, label]) => `<option value="${role}" ${role === 'ANALYST' ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
          <label class="field">Mot de passe provisoire <span class="muted">16 caractères minimum</span><input name="password" type="text" required minlength="16" /></label>
          <button class="btn" type="submit">Créer le compte</button>
        </form>
      </div>`;
    node.querySelectorAll('[data-role]').forEach(select => select.onchange = async () => {
      try {
        await api(`/api/admin/users/${select.dataset.role}`, { method: 'PATCH', body: JSON.stringify({ role: select.value }) });
        toast('Rôle mis à jour.');
      } catch (error) { toast(error.message, 'warn'); users(); }
    });
    node.querySelectorAll('[data-toggle]').forEach(button => button.onclick = async () => {
      try {
        await api(`/api/admin/users/${button.dataset.toggle}`, { method: 'PATCH', body: JSON.stringify({ active: button.dataset.active !== 'true' }) });
        toast('Compte mis à jour.');
        users();
      } catch (error) { toast(error.message, 'warn'); }
    });
    node.querySelector('.new-user').onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form));
      try {
        await api('/api/admin/users', { method: 'POST', body: JSON.stringify(data) });
        toast('Compte créé.');
        users();
      } catch (error) { toast(error.message, 'warn'); }
    };
  } catch (error) { guard(node, error); }
}

/* — Journal d’audit — */
const auditState = { page: 1, action: '' };
async function audit(){
  const node = view('Journal d’audit', 'Toutes les actions effectuées dans le backoffice');
  node.innerHTML = skeleton(4);
  try {
    const data = await api(`/api/admin/audit?page=${auditState.page}&action=${encodeURIComponent(auditState.action)}`);
    const pages = Math.max(1, Math.ceil(data.total / data.limit));
    node.innerHTML = `
      <div class="panel">
        <div class="filters">
          <label class="filter">Action<select id="action"><option value="">Toutes</option>${data.actions.map(action => `<option value="${action}" ${auditState.action === action ? 'selected' : ''}>${ACTION_LABELS[action] || action}</option>`).join('')}</select></label>
        </div>
        <div class="table-wrap">
          <table data-test="audit-table">
            <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Ressource</th></tr></thead>
            <tbody>${data.items.map(row => `<tr><td>${fmtDate(row.created_at)}</td><td>${esc(row.display_name || 'Système')}<br><span class="muted">${esc(row.email || '')}</span></td><td>${esc(ACTION_LABELS[row.action] || row.action)}</td><td class="muted">${esc(row.resource_type)} ${esc(row.resource_id || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Aucune action enregistrée.</td></tr>'}</tbody>
          </table>
        </div>
        <div class="pagination">
          <span class="muted">${fmtNumber(data.total)} entrée(s) · page ${data.page} sur ${pages}</span>
          <span class="pager">
            <button class="btn subtle" id="prev" ${data.page <= 1 ? 'disabled' : ''}>← Précédente</button>
            <button class="btn subtle" id="next" ${data.page >= pages ? 'disabled' : ''}>Suivante →</button>
          </span>
        </div>
      </div>`;
    node.querySelector('#action').onchange = event => { auditState.action = event.target.value; auditState.page = 1; audit(); };
    node.querySelector('#prev').onclick = () => { auditState.page = Math.max(1, auditState.page - 1); audit(); };
    node.querySelector('#next').onclick = () => { auditState.page += 1; audit(); };
  } catch (error) { guard(node, error); }
}

/* — Routage par l’adresse : un rechargement garde la vue en cours. — */
function router(){
  if (!state.user) return;
  const [route, id] = location.hash.replace(/^#\//, '').split('?')[0].split('/');
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  if (query.size) {
    Object.keys(state.filters).forEach(key => { state.filters[key] = query.get(key) || ''; });
    if (query.get('diaspora')) state.filters.country = '';
    state.page = 1;
    history.replaceState(null, '', `#/${route}${id ? `/${id}` : ''}`);
  }
  if (route === 'contributions' && id) return detail(id);
  if (route === 'syntheses' && id) return summaryDetail(id);
  const views = { 'tableau-de-bord': dashboard, contributions, analyse: analysis, syntheses: summaries, utilisateurs: users, audit };
  const allowed = VIEWS.find(entry => entry.route === route && (!entry.superAdmin || canSuperAdmin()));
  if (!allowed) { location.hash = '#/contributions'; return; }
  views[route]();
}

async function start(){
  shell();
  if (!location.hash.startsWith('#/')) location.hash = canWrite() ? '#/tableau-de-bord' : '#/contributions';
  else router();
}

window.addEventListener('hashchange', router);
api('/api/admin/me', { resetOnUnauthorized: false })
  .then(async data => { state.user = data.user; state.csrf = data.csrfToken; await start(); })
  .catch(login);
