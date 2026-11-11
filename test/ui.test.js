'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');

let browser;
let server;
let baseUrl;
let tempDir;

test.before(async () => {
  const root = path.resolve(__dirname, '..');
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onnet-ui-'));
  const htmlPath = path.join(tempDir, 'Onnet-test.html');
  const build = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'build.js'), '9.9.9', htmlPath
  ], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);

  server = http.createServer((req, res) => {
    if (req.url !== '/' && req.url !== '/Onnet-test.html') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    fs.createReadStream(htmlPath).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

async function openApp() {
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('onnet.state.v1')) {
      localStorage.setItem('onnet.state.v1', JSON.stringify({
        v: 1,
        scenarios: [{
          id: 0, name: 'Poste actuel', brut: 2300, dureeType: '39',
          mutuelle: 30, mutuellePat: 30, joursResto: 21, valeurResto: 8,
          partResto: 50, nbMois: 12, primes: 0, treiziemeMoisBase: 'base',
          maintienPct: 90, carenceCouverte: false,
          absenceType: 'none', absenceDuree: 0
        }],
        refId: 0,
        metric: 'netHoraire',
        displayAmt: 'net',
        displayPeriod: 'mensuel'
      }));
    }
  });
  await page.goto(baseUrl);
  if(pageErrors.length){
    await context.close();
    throw new Error('Erreur JavaScript au chargement :\\n' + pageErrors.join('\\n'));
  }
  return { context, page };
}

async function addSecondScenario(page, gross = '3200') {
  await page.locator('#addScenario').click();
  await page.locator('#modalAddInput').fill(gross);
  await page.locator('#modalAddSubmit').click();
  await page.waitForFunction(() =>
    document.querySelectorAll('#cardsBody [data-card]').length === 2
  );
}

test('présente les deux repères avec le net mensuel en premier et le taux net horaire', async () => {
  const { context, page } = await openApp();
  try {
    const cards = page.locator('.benchmark-item');
    assert.equal(await cards.count(), 2);
    const smicCard = cards.nth(0);
    const medianCard = cards.nth(1);
    assert.match(await smicCard.locator('.benchmark-label').innerText(), /SMIC/);
    assert.match(await smicCard.locator('.benchmark-meta').first().innerText(), /Net horaire\s*:.*Brut mensuel\s*:/);
    assert.match(await medianCard.locator('.benchmark-label').innerText(), /Salaire médian/);
    assert.match(await medianCard.locator('.benchmark-meta').first().innerText(), /Net horaire\s*:.*Référence mensuelle nette/);
    const medianDetails = medianCard.locator('details');
    await medianDetails.locator('summary').click();
    assert.match(await medianDetails.innerText(), /brut mensuel correspondant n'est pas affiché/i);
  } finally {
    await context.close();
  }
});

test('compare le salaire réel au SMIC sans le recalculer à 35 h', async () => {
  const { context, page } = await openApp();
  try {
    const benchmark = page.locator('.benchmark-your-salary');
    await benchmark.waitFor({ state: 'visible' });
    const text = await benchmark.innerText();
    assert.match(text, /Votre net avant impôt/);
    assert.match(text, /contrat de 39 h/);
    assert.match(text, /net avant impôt/);
    assert.equal(await page.getByText('Votre net estimé reçu à 35 h', { exact: true }).count(), 0);
    assert.match(await page.locator('.benchmark-heading').innerText(), /par heure/);
  } finally {
    await context.close();
  }
});

test('affiche le comparatif et permet d’ajouter un salaire', async () => {
  const { context, page } = await openApp();
  try {
    assert.equal(await page.locator('#cardsBody [data-card]').count(), 1);
    await addSecondScenario(page);
    assert.equal(await page.locator('#cardsBody [data-card]').count(), 2);
    assert.equal(await page.locator('#cardsBody [data-key="brut"]').nth(1).inputValue(), '3200');
  } finally {
    await context.close();
  }
});

test('conserve une modification du brut après rechargement', async () => {
  const { context, page } = await openApp();
  try {
    const gross = page.locator('#cardsBody [data-key="brut"]').first();
    await gross.fill('3100');
    await page.waitForFunction(() => {
      const state = JSON.parse(localStorage.getItem('onnet.state.v1') || 'null');
      return state && state.scenarios[0].brut === 3100;
    });
    await page.reload();
    assert.equal(await page.locator('#cardsBody [data-key="brut"]').first().inputValue(), '3100');
  } finally {
    await context.close();
  }
});

test('recrée les scénarios à partir du lien de partage', async () => {
  const { context, page } = await openApp();
  try {
    await addSecondScenario(page, '3450');
    await page.locator('#shareBtn').click();
    assert.equal(await page.locator('#shareIncludeDetails').isChecked(), false);
    assert.equal(await page.locator('#shareIncludeFoyer').isChecked(), false);
    await page.locator('#shareCreateBtn').click();
    const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(shareUrl, /#share=/);
    const payload = await page.evaluate(url => {
      const encoded = new URL(url).hash.slice('#share='.length).replace(/-/g, '+').replace(/_/g, '/');
      const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), c => c.charCodeAt(0))));
    }, shareUrl);
    assert.equal(payload.scenarios.length, 2);
    assert.equal(payload.scenarios[0].mutuelle, 0);
    assert.equal(payload.scenarios[0].mutuellePat, 0);
    assert.equal(payload.foyer.situation, 'seul');

    const sharedPage = await context.newPage();
    await sharedPage.goto(shareUrl);
    assert.equal(await sharedPage.locator('#cardsBody [data-card]').count(), 2);
    assert.equal(await sharedPage.locator('#cardsBody [data-key="brut"]').nth(1).inputValue(), '3450');
  } finally {
    await context.close();
  }
});

test('le partage permet de sélectionner les salaires et les données sensibles', async () => {
  const { context, page } = await openApp();
  try {
    await addSecondScenario(page, '3450');
    const secondCard = page.locator('#cardsBody [data-card]').nth(1);
    await secondCard.locator('details.more summary').click();
    await secondCard.locator('[data-key="mutuelle"]').fill('35');
    await secondCard.locator('[data-key="mutuellePat"]').fill('65');
    await page.locator('#foyerModuleToggle').click();
    await page.locator('#foyerSituation [data-foyer="commun"]').click();
    await page.locator('#foyerConjoint').fill('45000');

    await page.locator('#shareBtn').click();
    await page.locator('#shareScenario-0').uncheck();
    await page.locator('#shareIncludeDetails').check();
    await page.locator('#shareIncludeFoyer').check();
    await page.locator('#shareCreateBtn').click();
    const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
    const payload = await page.evaluate(url => {
      const encoded = new URL(url).hash.slice('#share='.length).replace(/-/g, '+').replace(/_/g, '/');
      const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), c => c.charCodeAt(0))));
    }, shareUrl);
    assert.equal(payload.scenarios.length, 1);
    assert.equal(payload.scenarios[0].brut, 3450);
    assert.equal(payload.scenarios[0].mutuelle, 35);
    assert.equal(payload.scenarios[0].mutuellePat, 65);
    assert.equal(payload.v, 2);
    assert.equal(payload.foyer.situation, 'commun');
    assert.equal(payload.foyer.autresRevenus, 45000);
  } finally {
    await context.close();
  }
});

test('le calcul du 13e mois affiche le choix selon la durée et les mensualités', async () => {
  const { context, page } = await openApp();
  try {
    const card = page.locator('#cardsBody [data-card]').first();
    await card.locator('details.more summary').click();
    const nbMois = card.locator('[data-key="nbMois"]');
    await nbMois.fill('13');
    const basisRow = card.locator('[id^="c-13m-basis-row-"]');
    await page.waitForFunction(() => {
      const row = document.querySelector('[id^="c-13m-basis-row-"]');
      return row && row.style.display !== 'none';
    });
    await card.locator('[data-duree="35"]').click();
    assert.equal(await basisRow.evaluate(el => el.style.display), 'none');
    await card.locator('[data-duree="39"]').click();
    assert.notEqual(await basisRow.evaluate(el => el.style.display), 'none');
  } finally {
    await context.close();
  }
});

test('le statut fiscal distingue seul, concubinage et foyer commun', async () => {
  const { context, page } = await openApp();
  try {
    await page.locator('#foyerModuleToggle').click();
    await page.locator('#foyerCharges').selectOption('1');
    await page.locator('#foyerParentIsoleRow').waitFor({ state: 'visible' });
    await page.locator('#foyerParentIsole').check();
    let state = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')));
    assert.equal(state.foyer.parentIsole, true);
    await page.locator('#foyerSituation [data-foyer="concubinage"]').click();
    assert.equal(await page.locator('#foyerConcubinageInfo').isVisible(), true);
    assert.equal(await page.locator('#foyerParentIsoleRow').isVisible(), false);
    state = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')));
    assert.equal(state.foyer.situation, 'concubinage');
    assert.equal(state.foyer.couple, false);
    assert.equal(state.foyer.parentIsole, false);
    await page.locator('#foyerSituation [data-foyer="commun"]').click();
    state = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')));
    assert.equal(state.foyer.couple, true);
  } finally {
    await context.close();
  }
});

test('compare un contrat de 39 h sans convertir le salaire à 35 h', async () => {
  const { context, page } = await openApp();
  try {
    const expected = await page.evaluate(() => compute(scenarios[0], foyer).netApresImpot);
    const displayed = await page.locator('.benchmark-your-salary strong').innerText();
    const amount = Number(displayed.replace(/[^0-9,.-]/g, '').replace(',', '.'));
    assert.ok(Number.isFinite(amount), displayed);
    assert.ok(Math.abs(amount - expected) < 1, `net avant impôt affiché ${amount}, attendu ${expected}`);
    const details = page.locator('.benchmark-item').nth(1).locator('.benchmark-details');
    await details.locator('summary').click();
    assert.match(await details.innerText(), /39 h/);
  } finally {
    await context.close();
  }
});

test('affiche le net avant impôt comme valeur principale', async () => {
  const { context, page } = await openApp();
  try {
    assert.equal(await page.locator('.benchmark-item').count(), 2);
    assert.equal(await page.locator('#benchmarkSmicBrut').inputValue(), '1867.02');
    assert.match(await page.locator('.benchmark-heading').innerText(), /net avant impôt/);
    assert.match(await page.locator('.benchmark-your-salary').innerText(), /Votre net avant impôt/);
    assert.match(await page.locator('.benchmark-your-salary').innerText(), /Net horaire/);
    assert.equal(await page.locator('.benchmark-details summary').nth(0).innerText(), 'Méthode de calcul');
    assert.equal(await page.locator('.benchmark-details summary').nth(1).innerText(), 'Méthode de calcul');
    assert.equal(await page.locator('.benchmark-details').first().evaluate(el => el.open), false);
    assert.equal(await page.locator('.benchmark-details').nth(1).evaluate(el => el.open), false);
    assert.equal(await page.locator('.benchmark-disclaimer').count(), 0);
    const gridColumns = await page.locator('.benchmark-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns);
    assert.equal(gridColumns.trim().split(/\s+/).length, 2);

    const expected = await page.evaluate(() => {
      const item = scenarios[0];
      const actual = compute(item, foyer);
      const neutral = { ...item, brut: 1867.02, dureeType: '35', mutuelle: 0, mutuellePat: 0,
        joursResto: 0, valeurResto: 0, partResto: 0, nbMois: 12, primes: 0,
        absenceType: 'none', absenceDuree: 0 };
      return { userBeforeTax: actual.netApres, smicBeforeTax: compute(neutral, foyer).netApres };
    });
    const salaryText = await page.locator('.benchmark-your-salary strong').innerText();
    const salaryAmount = Number(salaryText.replace(/[^0-9,.-]/g, '').replace(',', '.'));
    assert.ok(Math.abs(salaryAmount - expected.userBeforeTax) < 1, 'Le net avant impôt doit être la valeur principale');
    const baseText = await page.locator('.benchmark-your-salary').innerText();
    assert.match(baseText, new RegExp(Math.round(expected.userBeforeTax).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '[\\s\\u202f]?')));
    const smicDisplayed = await page.locator('.benchmark-item').nth(0).locator('.benchmark-value').innerText();
    const smicAmount = Number(smicDisplayed.replace(/[^0-9,.-]/g, '').replace(',', '.'));
    assert.ok(Math.abs(smicAmount - expected.smicBeforeTax) < 1, 'SMIC comparé en net avant impôt');
    assert.match(await page.locator('.benchmark-item').nth(0).innerText(), /12,31.*brut\/heure|Brut mensuel/);

    await page.locator('#benchmarkBody .benchmark-settings summary').click();
    await page.locator('#benchmarkSmicBrut').fill('1900');
    await page.locator('#benchmarkSmicDate').fill('2027-01-01');
    await page.locator('#saveBenchmarkSettings').click();
    await page.waitForFunction(() => {
      const state = JSON.parse(localStorage.getItem('onnet.benchmarks.v1') || 'null');
      return state && state.smicBrut === 1900 && state.smicDate === '2027-01-01';
    });
    assert.match(await page.locator('#benchmarkBody').innerText(), /1\s?900/);
    await page.reload();
    assert.equal(await page.locator('#benchmarkSmicBrut').inputValue(), '1900.00');
  } finally {
    await context.close();
  }
});

test('le comparatif reste dans la largeur sur petits écrans', async () => {
  const { context, page } = await openApp();
  try {
    for (const width of [320, 375, 430]) {
      await page.setViewportSize({ width, height: 844 });
      const sizes = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scroll: document.querySelector('.benchmark-panel').scrollWidth,
        panel: document.querySelector('.benchmark-panel').clientWidth,
        cards: [...document.querySelectorAll('.benchmark-item')].map(el => el.getBoundingClientRect().width)
      }));
      assert.ok(sizes.scroll <= sizes.panel + 1, `débordement du comparatif à ${width}px : ${JSON.stringify(sizes)}`);
      assert.equal(sizes.cards.length, 2);
      assert.ok(sizes.cards.every(card => card > 0 && card < sizes.panel));
    }
  } finally {
    await context.close();
  }
});

