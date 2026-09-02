import { expect, test } from '@playwright/test';
import { E2E_DOMAIN, E2E_PREFIX, adminCredentials, loginAsAdmin, seedContribution } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test.describe('Backoffice', () => {
  test('refuse un mot de passe erroné', async ({ page }) => {
    await page.goto('/admin');
    await page.getByLabel('Adresse électronique').fill(adminCredentials().email);
    await page.getByLabel('Mot de passe').fill('mot-de-passe-invalide-0000');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.locator('.login-card .error')).toContainText('incorrect');
    await expect(page.locator('.shell')).toHaveCount(0);
  });

  test('traite une contribution de bout en bout', async ({ page, request }) => {
    const seeded = await seedContribution(request);
    await loginAsAdmin(page);

    // Tableau de bord : les compteurs sont chargés et cliquables.
    await expect(page.locator('[data-test="kpi-total"] b')).not.toHaveText('0');
    await page.getByRole('link', { name: 'Contributions', exact: true }).click();

    // Recherche par référence.
    await page.locator('[data-test="filter-q"]').fill(seeded.reference);
    await page.getByRole('button', { name: 'Filtrer' }).click();
    const rows = page.locator('[data-test="contributions-table"] tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(seeded.reference);

    // Détail : contenu du dépôt, puis traitement complet.
    await rows.first().click();
    await expect(page.locator('#view-title')).toHaveText(seeded.reference);
    await expect(page.locator('.prose')).toContainText('chaîne du froid');

    const tagName = `${E2E_PREFIX} vaccination`;
    await page.locator('#tag-name').fill(tagName);
    await page.getByRole('button', { name: 'Créer' }).click();
    await expect(page.locator('.tag', { hasText: tagName })).toBeVisible();
    await page.locator('.tag', { hasText: tagName }).locator('input').check();

    await page.locator('[data-test="status"]').selectOption('VALIDATED');
    await page.locator('#priority').selectOption('2');
    await page.locator('#assigned').selectOption({ index: 1 });
    await page.locator('#note').fill('Vérifier la couverture vaccinale du territoire.');
    await page.locator('[data-test="save"]').click();
    await expect(page.locator('.toast').last()).toContainText('enregistré');

    // Commentaire interne.
    await page.locator('#comment').fill('Transmis à la commission Santé.');
    await page.locator('[data-test="comment-save"]').click();
    await expect(page.locator('.comment')).toContainText('Transmis à la commission Santé.');

    // Le rechargement conserve la vue et les valeurs enregistrées.
    await page.reload();
    await expect(page.locator('[data-test="status"]')).toHaveValue('VALIDATED');
    await expect(page.locator('#priority')).toHaveValue('2');
    await expect(page.locator('#note')).toHaveValue('Vérifier la couverture vaccinale du territoire.');
    await expect(page.locator('.tag', { hasText: tagName }).locator('input')).toBeChecked();
    await expect(page.locator('.history')).toContainText('Validée');
  });

  test('applique une action groupée puis exporte le tableau', async ({ page, request }) => {
    // Un marqueur unique dans le texte isole les deux dépôts du lot, quelle que soit la base.
    const marker = `lot-${Date.now().toString(36)}`;
    const first = await seedContribution(request, { theme: 'Éducation', title: `${E2E_PREFIX} écoles`, textContent: `Manque de bancs dans les écoles primaires (${marker}).` });
    const second = await seedContribution(request, { theme: 'Éducation', title: `${E2E_PREFIX} manuels`, textContent: `Manuels scolaires indisponibles à la rentrée (${marker}).` });
    await loginAsAdmin(page);
    await page.getByRole('link', { name: 'Contributions', exact: true }).click();

    await page.locator('[data-test="filter-q"]').fill(marker);
    await page.getByRole('button', { name: 'Filtrer' }).click();
    const rows = page.locator('[data-test="contributions-table"] tbody tr');
    await expect(rows).toHaveCount(2);

    await page.locator('#pick-all').check();
    await expect(page.locator('#bulk-count')).toHaveText('2');
    await page.locator('#bulk-status').selectOption('IN_REVIEW');
    await page.locator('#bulk-apply').click();
    await expect(page.locator('.toast').last()).toContainText('2 contribution');
    await expect(rows.first()).toContainText('En examen');
    await expect(rows.nth(1)).toContainText('En examen');

    // L'export reprend les filtres affichés à l'écran.
    const csv = await page.request.get(`/api/admin/exports/contributions.csv?q=${marker}`);
    expect(csv.ok()).toBeTruthy();
    const body = await csv.text();
    expect(body).toContain(first.reference);
    expect(body).toContain(second.reference);
    expect(body).toContain('Référence');
  });

  test('journalise les actions et gère les comptes', async ({ page }) => {
    await loginAsAdmin(page);

    // Analyse : répartition géographique et thématique.
    await page.getByRole('link', { name: 'Analyse et diaspora' }).click();
    await expect(page.getByRole('heading', { name: 'Contributions de la diaspora' })).toBeVisible();
    await expect(page.locator('.bars li').first()).toBeVisible();

    // Journal d'audit.
    await page.getByRole('link', { name: 'Journal d’audit' }).click();
    await expect(page.locator('[data-test="audit-table"] tbody tr').first()).toBeVisible();
    await page.locator('#action').selectOption('CONTRIBUTION_UPDATED');
    await expect(page.locator('[data-test="audit-table"] tbody')).toContainText('Contribution modifiée');

    // Création puis désactivation d'un compte.
    const email = `agent-${Date.now().toString(36)}@${E2E_DOMAIN}`;
    await page.getByRole('link', { name: 'Utilisateurs' }).click();
    await page.locator('[data-test="new-user"] input[name="displayName"]').fill('Agent de test');
    await page.locator('[data-test="new-user"] input[name="email"]').fill(email);
    await page.locator('[data-test="new-user"] select[name="role"]').selectOption('ANALYST');
    await page.locator('[data-test="new-user"] input[name="password"]').fill('mot-de-passe-de-test-2026');
    await page.locator('[data-test="new-user"] button[type="submit"]').click();

    const row = page.locator('[data-test="users-table"] tbody tr', { hasText: email });
    await expect(row).toContainText('Actif');
    await row.getByRole('button', { name: 'Désactiver' }).click();
    await expect(page.locator('[data-test="users-table"] tbody tr', { hasText: email })).toContainText('Désactivé');

    // Un super administrateur ne peut pas se retirer son propre accès.
    const own = page.locator('[data-test="users-table"] tbody tr', { hasText: adminCredentials().email });
    await expect(own.getByRole('button')).toBeDisabled();
  });

  test('rédige une synthèse et ferme la session', async ({ page }) => {
    await loginAsAdmin(page);
    await page.getByRole('link', { name: 'Synthèses' }).click();

    const title = `${E2E_PREFIX} santé — priorités du Sud-Kivu`;
    await page.locator('#summary-title').fill(title);
    await page.locator('#summary-theme').fill('Santé');
    await page.locator('#summary-body').fill('Trois constats convergents sur la chaîne du froid.');
    await page.locator('[data-test="summary-save"]').click();
    await expect(page.locator('.recent')).toContainText(title);

    await page.getByRole('link', { name: title }).click();
    await page.locator('#status').selectOption('REVIEW');
    await page.locator('#body').fill('Trois constats convergents sur la chaîne du froid et deux propositions.');
    await page.locator('[data-test="summary-update"]').click();
    await expect(page.locator('.toast').last()).toContainText('enregistrée');
    await page.reload();
    await expect(page.locator('#status')).toHaveValue('REVIEW');
    await expect(page.locator('#body')).toHaveValue(/deux propositions/);

    // Déconnexion : la session est fermée et le backoffice redemande une authentification.
    await page.getByRole('button', { name: 'Déconnexion' }).click();
    await expect(page.locator('[data-test="login-form"]')).toBeVisible();
    await page.goto('/admin#/contributions');
    await expect(page.locator('[data-test="login-form"]')).toBeVisible();
  });
});
