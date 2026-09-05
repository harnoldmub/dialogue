import { test, expect } from '@playwright/test';

const PAGES = [
  { chemin: '/', titre: /Congo Dialogue/ },
  { chemin: '/participer', titre: /contribution/i },
  { chemin: '/mentions', titre: /Mentions légales/i },
  { chemin: '/page-inexistante', titre: /introuvable/i }
];
const LARGEURS = [320, 390, 768, 1440];

test.describe('Pages publiques @public', () => {
  for (const page of PAGES) {
    test(`${page.chemin} : structure, libellés et absence d’erreur console`, async ({ page: navigateur }) => {
      const erreurs = [];
      navigateur.on('pageerror', erreur => erreurs.push(erreur.message));
      // le 404 du document lui-même est attendu sur la page d'erreur
      navigateur.on('console', message => message.type() === 'error' && !message.text().includes('status of 404') && erreurs.push(message.text()));
      await navigateur.goto(page.chemin);

      await expect(navigateur).toHaveTitle(page.titre);
      expect(await navigateur.locator('html').getAttribute('lang')).toBe('fr');
      expect(await navigateur.locator('meta[name="description"]').count(), 'une description est attendue').toBeGreaterThan(0);
      expect(await navigateur.locator('h1:visible').count(), 'un seul titre de niveau 1 visible').toBe(1);
      await expect(navigateur.locator('.skip')).toHaveCount(1);

      const imagesSansAlt = await navigateur.locator('img:not([alt])').count();
      expect(imagesSansAlt, 'chaque image doit porter un texte de remplacement').toBe(0);

      const champsSansLibelle = await navigateur.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]),select,textarea')]
        .filter(champ => !champ.closest('label') && !champ.getAttribute('aria-label') && !document.querySelector(`label[for="${champ.id}"]`))
        .map(champ => champ.name || champ.id || champ.type));
      expect(champsSansLibelle, 'chaque champ doit être relié à un libellé').toEqual([]);

      const ancresMortes = await navigateur.evaluate(() => [...document.querySelectorAll('a[href^="#"]')]
        .map(lien => lien.getAttribute('href'))
        .filter(href => href.length > 1 && !document.querySelector(href)));
      expect(ancresMortes, 'aucun lien interne ne doit pointer dans le vide').toEqual([]);

      expect(erreurs).toEqual([]);
    });

    test(`${page.chemin} : aucune largeur ne déborde @public`, async ({ page: navigateur }) => {
      for (const largeur of LARGEURS) {
        await navigateur.setViewportSize({ width: largeur, height: 900 });
        await navigateur.goto(page.chemin);
        await navigateur.waitForTimeout(150);
        const mesure = await navigateur.evaluate(() => {
          // on retire le masque pour révéler un dépassement réel plutôt que de le cacher
          document.documentElement.style.overflowX = 'visible';
          document.body.style.overflowX = 'visible';
          const vue = document.documentElement.clientWidth;
          const fautifs = [...document.querySelectorAll('body *')]
            .filter(element => {
              const rect = element.getBoundingClientRect();
              if (!rect.width && !rect.height) return false;
              const parent = element.parentElement?.getBoundingClientRect();
              return rect.right > vue + 1 && !(parent && parent.right > vue + 1);
            })
            .map(element => `${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0]}`);
          return { document: document.documentElement.scrollWidth, vue, fautifs: [...new Set(fautifs)] };
        });
        expect(mesure.fautifs, `${page.chemin} à ${largeur}px`).toEqual([]);
        expect(mesure.document, `${page.chemin} à ${largeur}px`).toBeLessThanOrEqual(mesure.vue + 1);
      }
    });
  }

  test('le sélecteur de pays garde le drapeau hors du texte @public', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/participer');
    const mesure = await page.evaluate(() => {
      const champ = document.querySelector('.country-picker input');
      const drapeau = document.querySelector('.country-flag');
      const rc = champ.getBoundingClientRect();
      const rd = drapeau.getBoundingClientRect();
      return {
        debutTexte: rc.left + parseFloat(getComputedStyle(champ).paddingLeft),
        finDrapeau: rd.right,
        ecartVertical: Math.abs((rd.top + rd.height / 2) - (rc.top + rc.height / 2))
      };
    });
    expect(mesure.debutTexte, 'le texte doit commencer après le drapeau').toBeGreaterThan(mesure.finDrapeau);
    expect(mesure.ecartVertical, 'le drapeau doit rester centré sur le champ').toBeLessThan(3);
  });

  test('la navigation mobile s’ouvre et se referme @public', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const bouton = page.locator('.menu-toggle');
    await expect(bouton).toBeVisible();
    await bouton.click();
    await expect(page.locator('.main-nav')).toHaveClass(/open/);
    await page.locator('.main-nav a').first().click();
    await expect(page.locator('.main-nav')).not.toHaveClass(/open/);
  });

  test('le document officiel reste téléchargeable @public', async ({ request }) => {
    const response = await request.get('/assets/allocution-ouverture-dialogue-national.pdf');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('pdf');
  });
});
