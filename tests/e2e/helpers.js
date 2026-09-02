import { readFileSync } from 'node:fs';
import pg from 'pg';

/* Playwright ne charge pas .env : on lit le fichier local pour retrouver la base et le compte d'amorçage. */
export function loadEnv(){
  if (process.env.DATABASE_URL && process.env.ADMIN_BOOTSTRAP_EMAIL) return;
  try {
    for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch { /* pas de .env : les variables viennent alors de l'environnement */ }
}

export const E2E_DOMAIN = 'e2e.test';
export const E2E_PREFIX = 'E2E';
export const adminCredentials = () => {
  loadEnv();
  return { email: process.env.ADMIN_BOOTSTRAP_EMAIL, password: process.env.ADMIN_BOOTSTRAP_PASSWORD };
};

export async function withDatabase(run){
  loadEnv();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try { return await run(client); } finally { await client.end(); }
}

export const contributionByReference = reference =>
  withDatabase(async client => (await client.query('SELECT * FROM contributions WHERE reference=$1', [reference])).rows[0]);

/* Dépôt créé par l'API publique : plus rapide que le formulaire quand le test porte sur le backoffice. */
export async function seedContribution(request, overrides = {}){
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const payload = {
    firstName: 'Espérance', lastName: 'Mukendi', email: `seed-${stamp}@${E2E_DOMAIN}`,
    country: 'République démocratique du Congo', city: 'Bukavu', province: 'Sud-Kivu',
    profile: 'Citoyen', theme: 'Santé', title: `${E2E_PREFIX} chaîne du froid`,
    textContent: 'Les centres de santé du territoire de Walungu manquent de chaîne du froid pour les vaccins.',
    consent: 'on', ...overrides
  };
  const response = await request.post('/api/contributions', { multipart: payload });
  if (!response.ok()) throw new Error(`Dépôt de test refusé : ${response.status()} ${await response.text()}`);
  return { ...payload, ...(await response.json()) };
}

export async function loginAsAdmin(page){
  const { email, password } = adminCredentials();
  await page.goto('/admin');
  await page.getByLabel('Adresse électronique').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForSelector('.shell');
}
