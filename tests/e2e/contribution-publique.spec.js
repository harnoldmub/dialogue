import { expect, test } from '@playwright/test';
import { E2E_DOMAIN, E2E_PREFIX, contributionByReference } from './helpers.js';

test.describe('Dépôt citoyen', () => {
  test('refuse un envoi incomplet puis enregistre la contribution', async ({ page }) => {
    await page.goto('/participer');

    // 1. Formulaire vide : les champs obligatoires sont signalés, rien n'est envoyé.
    await page.getByRole('button', { name: 'Envoyer ma contribution' }).click();
    await expect(page.locator('#form-error')).toContainText('obligatoires');
    await expect(page.locator('input[name="firstName"]')).toHaveAttribute('aria-invalid', 'true');

    // 2. Identité complète mais aucun format de contribution.
    await page.locator('input[name="firstName"]').fill('Espérance');
    await page.locator('input[name="lastName"]').fill('Mukendi');
    await page.locator('input[name="email"]').fill(`formulaire-${Date.now().toString(36)}@${E2E_DOMAIN}`);
    await page.locator('input[name="city"]').fill('Bukavu');
    await page.locator('select[name="province"]').selectOption('Sud-Kivu');
    await page.locator('select[name="theme"]').selectOption('Santé');
    await page.locator('input[name="title"]').fill(`${E2E_PREFIX} centres de santé de Walungu`);
    await page.locator('input[name="consent"]').check();
    await page.getByRole('button', { name: 'Envoyer ma contribution' }).click();
    await expect(page.locator('#form-error')).toContainText('au moins un format');

    // 3. Avec le texte, le dépôt aboutit et une référence est remise.
    await page.locator('textarea[name="textContent"]').fill('Les centres de santé du territoire de Walungu manquent de chaîne du froid pour conserver les vaccins.');
    await page.getByRole('button', { name: 'Envoyer ma contribution' }).click();
    await expect(page.locator('#confirmation')).toBeVisible();
    const reference = (await page.locator('#reference').textContent()).trim();
    expect(reference).toMatch(/^DIALOGUE-\d{4}-\d{6}$/);

    // 4. La contribution est bien en base, avec le statut initial.
    const stored = await contributionByReference(reference);
    expect(stored).toBeTruthy();
    expect(stored.status).toBe('RECEIVED');
    expect(stored.theme).toBe('Santé');
    expect(stored.text_content).toContain('chaîne du froid');
  });

  test('la page d’accueil explique le parcours dans une modale', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Voir comment ça se passe' }).click();
    const modal = page.locator('#apercu');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Pacte national');
    await modal.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(modal).toBeHidden();
  });
});
