import { test, expect } from '@playwright/test';
import { E2E_DOMAIN, adminCredentials, seedContribution } from './helpers.js';

const champsValides = {
  firstName: 'Jeanne', lastName: 'Ilunga', email: `api-${Date.now().toString(36)}@${E2E_DOMAIN}`,
  country: 'République démocratique du Congo', city: 'Kolwezi', theme: 'Éducation',
  textContent: 'Les écoles du quartier manquent de bancs et les classes dépassent soixante élèves.', consent: 'on'
};

test.describe('Dépôt public : contrôle des envois', () => {
  test('refuse un envoi sans consentement', async ({ request }) => {
    const { consent, ...sansConsentement } = champsValides;
    const response = await request.post('/api/contributions', { multipart: sansConsentement });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('accepter le traitement');
  });

  test('refuse une adresse électronique invalide', async ({ request }) => {
    const response = await request.post('/api/contributions', { multipart: { ...champsValides, email: 'pas-une-adresse' } });
    expect(response.status()).toBe(400);
  });

  test('refuse un envoi sans aucun format', async ({ request }) => {
    const { textContent, ...sansContenu } = champsValides;
    const response = await request.post('/api/contributions', { multipart: sansContenu });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('au moins un format');
  });

  test('refuse un fichier au format non autorisé', async ({ request }) => {
    const response = await request.post('/api/contributions', {
      multipart: { ...champsValides, files: { name: 'script.js', mimeType: 'application/javascript', buffer: Buffer.from('alert(1)') } }
    });
    expect(response.status()).toBe(415);
    expect((await response.json()).error).toContain('script.js');
  });

  test('refuse un fichier de plus de dix mégaoctets', async ({ request }) => {
    const response = await request.post('/api/contributions', {
      multipart: { ...champsValides, files: { name: 'gros.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(11 * 1024 * 1024, 1) } }
    });
    expect(response.status()).toBe(413);
  });

  test('accepte un dépôt complet et délivre une référence', async ({ request }) => {
    const response = await request.post('/api/contributions', {
      multipart: {
        ...champsValides, email: `api-ok-${Date.now().toString(36)}@${E2E_DOMAIN}`,
        files: { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('Constat de terrain.') }
      }
    });
    expect(response.status()).toBe(201);
    expect((await response.json()).reference).toMatch(/^DIALOGUE-\d{4}-\d{6}$/);
  });
});

test.describe('Backoffice : verrous d’accès', () => {
  const routesProtegees = ['/api/admin/dashboard', '/api/admin/contributions', '/api/admin/filters', '/api/admin/users', '/api/admin/audit', '/api/admin/exports/contributions.csv'];

  test('refuse toute route d’administration sans session', async ({ request }) => {
    for (const route of routesProtegees) {
      const response = await request.get(route);
      expect(response.status(), `${route} doit exiger une session`).toBe(401);
    }
  });

  test('refuse une écriture sans jeton anti-CSRF', async ({ request }) => {
    const { email, password } = adminCredentials();
    const connexion = await request.post('/api/admin/auth/login', { data: { email, password } });
    expect(connexion.status()).toBe(200);
    const contribution = await seedContribution(request);
    const sansJeton = await request.patch(`/api/admin/contributions/${contribution.id}`, { data: { status: 'VALIDATED' } });
    expect(sansJeton.status()).toBe(403);
    const avecJeton = await request.patch(`/api/admin/contributions/${contribution.id}`, {
      data: { status: 'VALIDATED' }, headers: { 'x-csrf-token': (await connexion.json()).csrfToken }
    });
    expect(avecJeton.status()).toBe(200);
  });

  test('cantonne un compte en lecture seule', async ({ request }) => {
    const { email, password } = adminCredentials();
    const session = await (await request.post('/api/admin/auth/login', { data: { email, password } })).json();
    const lecteurEmail = `lecteur-${Date.now().toString(36)}@${E2E_DOMAIN}`;
    const motDePasse = 'MotDePasseLecture2026!';
    const creation = await request.post('/api/admin/users', {
      data: { email: lecteurEmail, displayName: 'Lecteur E2E', password: motDePasse, role: 'VIEWER' },
      headers: { 'x-csrf-token': session.csrfToken }
    });
    expect(creation.status()).toBe(201);

    const lecteur = await request.post('/api/admin/auth/login', { data: { email: lecteurEmail, password: motDePasse } });
    expect(lecteur.status()).toBe(200);
    const jeton = (await lecteur.json()).csrfToken;
    const contribution = await seedContribution(request);
    const ecriture = await request.patch(`/api/admin/contributions/${contribution.id}`, {
      data: { status: 'REJECTED' }, headers: { 'x-csrf-token': jeton }
    });
    expect(ecriture.status(), 'un lecteur ne doit pas pouvoir écrire').toBe(403);
    expect((await request.get('/api/admin/users')).status(), 'un lecteur ne doit pas voir les comptes').toBe(403);
    expect((await request.get('/api/admin/contributions')).status(), 'un lecteur doit pouvoir lire').toBe(200);
  });

  test('refuse un identifiant inconnu et journalise la tentative', async ({ request }) => {
    const response = await request.post('/api/admin/auth/login', { data: { email: `inconnu@${E2E_DOMAIN}`, password: 'MotDePasseInvalide2026' } });
    expect(response.status()).toBe(401);
  });
});

test.describe('Service : routes et en-têtes', () => {
  test('sert les pages publiques et une page 404 dédiée', async ({ request }) => {
    for (const [route, attendu] of [['/', 200], ['/participer', 200], ['/mentions', 200], ['/admin', 200], ['/health', 200], ['/page-inexistante', 404]]) {
      const response = await request.get(route);
      expect(response.status(), route).toBe(attendu);
    }
    expect(await (await request.get('/page-inexistante')).text()).toContain('introuvable');
  });

  test('protège l’encadrement et réserve le microphone', async ({ request }) => {
    const entetes = (await request.get('/')).headers();
    expect(entetes['x-frame-options']).toBe('DENY');
    expect(entetes['permissions-policy']).toContain('microphone=(self)');
  });

  test('ne met jamais les pages HTML en cache et garde les assets une heure', async ({ request, baseURL }) => {
    expect((await request.get('/participer')).headers()['cache-control']).toContain('max-age=0');
    const html = await (await request.get('/')).text();
    const asset = html.match(/\/assets\/[\w.-]+\.js/)[0];
    expect((await request.get(new URL(asset, baseURL).href)).headers()['cache-control']).toContain('max-age=3600');
  });
});
