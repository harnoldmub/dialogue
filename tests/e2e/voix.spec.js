import { test, expect } from '@playwright/test';

function wav(seconds) {
  const rate = 8000;
  const buffer = Buffer.alloc(44 + seconds * rate * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40);
  for (let i = 0; i < seconds * rate; i++) buffer.writeInt16LE(Math.round(4000 * Math.sin(i * 2 * Math.PI * 440 / rate)), 44 + i * 2);
  return { name: `note-${seconds}.wav`, mimeType: 'audio/wav', buffer };
}

test('importe, écoute et conserve une note après un import refusé ou un envoi échoué @public', async ({ page }) => {
  await page.goto('/participer');
  await page.locator('#audio-file').setInputFiles(wav(2));
  await expect(page.locator('#audio-status')).toContainText('00:02');
  const previousUrl = await page.locator('#audio-preview').getAttribute('src');
  await page.locator('#audio-preview').evaluate(audio => audio.play());
  await expect.poll(() => page.locator('#audio-preview').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
  await page.locator('#audio-file').setInputFiles(wav(241));
  await expect(page.locator('#audio-status')).toContainText('4 minutes');
  await expect(page.locator('#audio-preview')).toHaveAttribute('src', previousUrl);
  for (const [name, value] of Object.entries({ firstName: 'Test', lastName: 'Voix', email: 'voix@e2e.test', city: 'Kinshasa' })) {
    await page.locator(`[name="${name}"]`).fill(value);
  }
  await page.locator('[name="theme"]').selectOption('Santé');
  await page.locator('[name="consent"]').check();
  await page.route('**/api/contributions', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Service temporairement indisponible.' }) }));
  await page.getByRole('button', { name: 'Envoyer ma contribution' }).click();
  await expect(page.locator('#form-error')).toContainText('temporairement');
  await expect(page.locator('#audio-preview')).toHaveAttribute('src', previousUrl);
  await page.locator('#remove-audio').click();
  await expect(page.locator('#audio-preview')).toBeHidden();
  await expect(page.locator('#audio-file-name')).toBeEmpty();
});

test('arrête à quatre minutes hors pauses et attend le dernier fragment', async ({ page, browserName }) => {
  // WebKit interdit de remplacer navigator.mediaDevices.getUserMedia : le faux microphone ne s'applique pas
  // et le vrai appel part, refusé par un navigateur sans interface. Le scénario reste couvert sur Chromium.
  test.skip(browserName === 'webkit', 'Microphone non simulable sur WebKit');
  await page.clock.install();
  await page.addInitScript(base64 => {
    navigator.mediaDevices.getUserMedia = async () => {
      window.microphoneRequests = (window.microphoneRequests || 0) + 1;
      const context = new AudioContext();
      return context.createMediaStreamDestination().stream;
    };
    // Simule la livraison tardive du dernier fragment, comme lors d'une finalisation mobile.
    window.MediaRecorder = class {
      static isTypeSupported() { return true; }
      constructor(stream) { this.stream = stream; this.state = 'inactive'; this.mimeType = 'audio/wav'; }
      start() { this.state = 'recording'; }
      pause() { this.state = 'paused'; }
      resume() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        setTimeout(() => {
          this.ondataavailable({ data: new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'audio/wav' }) });
          this.onstop();
        }, 500);
      }
    };
  }, wav(1).buffer.toString('base64'));
  await page.goto('/participer');
  expect(await page.evaluate(() => window.microphoneRequests || 0)).toBe(0);
  await page.locator('#record-button').click();
  await expect(page.locator('#pause-button')).toBeVisible();
  await page.clock.fastForward(10_000);
  await page.locator('#pause-button').click();
  const pausedTime = await page.locator('#recording-time').textContent();
  await page.clock.fastForward(60_000);
  await expect(page.locator('#recording-time')).toHaveText(pausedTime);
  await page.locator('#pause-button').click();
  await page.clock.fastForward(230_000);
  await expect(page.locator('#recording-time')).toHaveText('04:00');
  await expect(page.locator('#audio-status')).toContainText('Finalisation');
  await expect(page.getByRole('button', { name: 'Envoyer ma contribution' })).toBeDisabled();
  await page.clock.runFor(1000);
  await expect(page.locator('#audio-preview')).toBeVisible();
  await expect(page.locator('#audio-status')).toContainText('04:00');
  await expect(page.getByRole('button', { name: 'Envoyer ma contribution' })).toBeEnabled();
  expect(await page.evaluate(() => window.microphoneRequests)).toBe(1);
});

test('affiche les noms de fichiers comme du texte @public', async ({ page }) => {
  await page.goto('/participer');
  await page.locator('#files').setInputFiles({ name: '<b>proposition</b>.txt', mimeType: 'text/plain', buffer: Buffer.from('Proposition') });
  await expect(page.locator('#file-list')).toContainText('<b>proposition</b>.txt');
  await expect(page.locator('#file-list b')).toHaveCount(0);
});
