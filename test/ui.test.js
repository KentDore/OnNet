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

const ENDPOINT = 'https://mon-entreprise.urssaf.fr/api/v1/evaluate';

function getNumber(situation, key) {
  const value = Number.parseFloat(String(situation[key] ?? '0'));
  return Number.isFinite(value) ? value : 0;
}

function makeApiResponse(request, options = {}) {
  const situation = request.situation || {};
  const baseGross = getNumber(situation, 'salarié . contrat . salaire brut');
  const overtimeHours = getNumber(situation, 'salarié . temps de travail . heures supplémentaires');
  const gross = baseGross + (baseGross / 151.67) * overtimeHours * 1.25;

  const healthTotal = getNumber(situation, 'salarié . cotisations . prévoyances . santé . montant');
  const healthEmployerRate = getNumber(situation, 'salarié . cotisations . prévoyances . santé . taux employeur') / 100;
  const employeeHealth = healthTotal * (1 - healthEmployerRate);
  const employerHealth = healthTotal * healthEmployerRate;

  const ticketCount = getNumber(situation, 'salarié . rémunération . frais professionnels . titres-restaurant . nombre');
  const ticketValue = getNumber(situation, 'salarié . rémunération . frais professionnels . titres-restaurant . montant unitaire');
  const ticketEmployerRate = getNumber(situation, 'salarié . rémunération . frais professionnels . titres-restaurant . taux employeur') / 100;
  const mealTicketEmployer = ticketCount * ticketValue * ticketEmployerRate;
  const mealTicketEmployee = ticketCount * ticketValue - mealTicketEmployer;

  const employeeContributions = gross * 0.22 + employeeHealth;
  const netBeforeTax = gross - employeeContributions - mealTicketEmployee;
  const taxableNet = gross * 0.82 + employerHealth;
  const overtimePay = (baseGross / 151.67) * overtimeHours * 1.25;

  const values = {
    'salarié . rémunération . brut': gross,
    'salarié . rémunération . net . à payer avant impôt': netBeforeTax,
    'salarié . rémunération . net . imposable': taxableNet,
    'salarié . cotisations . salarié': employeeContributions,
    'salarié . rémunération . heures supplémentaires': overtimePay,
    'salarié . cotisations . prévoyances . santé . salarié': employeeHealth,
    'salarié . cotisations . prévoyances . santé . employeur': employerHealth,
    'salarié . rémunération . frais professionnels . titres-restaurant . montant': ticketCount * ticketValue,
    'salarié . rémunération . frais professionnels . titres-restaurant . employeur': mealTicketEmployer,
    'salarié . rémunération . frais professionnels . non déductible': 0,
    'salarié . rémunération . net . payé après impôt': netBeforeTax - 100,
    'impôt . montant': 1200,
    "impôt . taux d'imposition": 5,
    'SMIC': options.smicValue ?? 1867.02
  };

  return {
    evaluate: request.expressions.map(expression => ({
      nodeValue: values[expression] ?? 0,
      missingVariables: options.missingVariables || []
    })),
    warnings: options.warnings || []
  };
}

async function waitForCalls(calls, expected, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (calls.count < expected && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(calls.count >= expected, `attendu au moins ${expected} appels API, obtenu ${calls.count}`);
}

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

async function openApp(options = {}) {
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const calls = { count: 0, bodies: [] };
  await context.route('**/api/v1/evaluate', async route => {
    const request = route.request().postDataJSON();
    calls.count += 1;
    calls.bodies.push(request);
    if (options.delayMs) await new Promise(resolve => setTimeout(resolve, options.delayMs));
    if (options.failApi || calls.count <= (options.failFirstCalls || 0)) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Service unavailable' })
      });
      return;
    }
    const body = makeApiResponse(request, options);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body)
    });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  if (!options.emptyStorage) {
    await page.addInitScript(() => {
      if (!localStorage.getItem('onnet.state.v1')) {
        localStorage.setItem('onnet.state.v1', JSON.stringify({
          v: 1,
          scenarios: [{
            id: 0, name: 'Poste actuel', brut: 2300, dureeType: '39',
            mutuelle: 30, mutuellePat: 30, joursResto: 21, valeurResto: 8,
            partResto: 50, nbMois: 12, primes: 0, treiziemeMoisBase: 'base',
            maintienPct: 90, carenceCouverte: false,
            absenceType: 'arret', absenceDuree: 5
          }],
          refId: 0,
          metric: 'netHoraire',
          displayAmt: 'net',
          displayPeriod: 'mois'
        }));
      }
    });
  }
  await page.goto(baseUrl);
  if (pageErrors.length) {
    await context.close();
    throw new Error('Erreur JavaScript au chargement :\n' + pageErrors.join('\n'));
  }

  if (options.consent !== false && !options.emptyStorage) {
    await page.locator('#urssafCalculateBtn').click();
    await page.waitForFunction(() => {
      const status = document.getElementById('urssafStatusText')?.textContent || '';
      const cards = [...document.querySelectorAll('#cardsBody [data-card]')];
      return status.includes('Calculs à jour') &&
        cards.length > 0 && cards.every(card => card.dataset.resultState === 'ready') &&
        document.querySelectorAll('.benchmark-item').length === 2;
    }, null, { timeout: 20000 });
  }

  return { context, page, calls };
}

async function addSecondScenario(page, gross = '3200') {
  await page.locator('#addScenario').click();
  await page.locator('#modalAddInput').fill(gross);
  await page.locator('#modalAddSubmit').click();
  await page.waitForFunction(() =>
    document.querySelectorAll('#cardsBody [data-card]').length === 2
  );
}

test('indique la source Urssaf et ne transmet aucune donnée avant consentement', async () => {
  const { context, page, calls } = await openApp({ consent: false });
  try {
    await waitForCalls(calls, 1);
    const startupRequests = calls.bodies.slice();
    assert.equal(startupRequests.length, 1, 'un seul appel initial doit suffire pour actualiser le SMIC');
    assert.deepEqual(startupRequests[0].expressions, ['SMIC']);
    assert.equal(Object.hasOwn(startupRequests[0].situation, 'salarié . contrat . salaire brut'), false,
      'la récupération du SMIC ne doit transmettre aucun salaire');
    assert.equal(await page.locator('#absenceModule').count(), 0);
    assert.equal(await page.getByText('Simuler une absence', { exact: true }).count(), 0);
    assert.match(await page.locator('#urssafStatusText').innerText(), /Le calcul nécessite votre autorisation pour transmettre ces paramètres à l’Urssaf/);
    assert.equal(await page.locator('#urssafRememberConsent').count(), 0,
      'le choix de consentement ne doit plus être mémorisé par une case à cocher');
    assert.equal(await page.locator('.urssaf-data-details').isVisible(), true);
    await page.locator('.urssaf-data-details summary').click();
    const notice = await page.locator('.urssaf-data-notice').innerText();
    assert.match(notice, /salaire.*durée du travail.*commune.*mutuelle.*titres-restaurant.*situation fiscale/);
    assert.match(notice, /transmet à l’Urssaf/);
    assert.match(notice, /Aucun calcul local des cotisations ou de l’impôt n’est utilisé/);
    assert.match(await page.locator('.urssaf-status-main').first().innerText(), /Calculs réalisés via l’API officielle Mon-entreprise de l’Urssaf/);
    assert.equal(await page.locator('#urssafCalculateBtn').innerText(), 'Accepter et calculer');
    assert.equal(await page.locator('#urssafCalculateBtn').isVisible(), true);

    await page.locator('#urssafCalculateBtn').click();
    await page.waitForFunction(() =>
      (document.getElementById('urssafStatusText')?.textContent || '').includes('Calculs à jour'),
      null, { timeout: 20000 }
    );
    assert.ok(calls.count >= 3);
    assert.match(await page.locator('#cardsBody [data-result-state="ready"]').first().innerText(), /API officielle Mon-entreprise \(Urssaf\)/);
    assert.equal(await page.locator('#urssafCalculateBtn').isVisible(), false);

    const legacy = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('onnet.state.v1') || 'null');
      return data.scenarios[0];
    });
    for (const key of ['absenceType', 'absenceDuree', 'maintienPct', 'carenceCouverte']) {
      assert.equal(Object.hasOwn(legacy, key), false, `l’ancienne propriété ${key} doit être neutralisée`);
    }
  } finally {
    await context.close();
  }
});


test('le haut de page garde le partage visible et regroupe les actions secondaires', async () => {
  const { context, page } = await openApp();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('#shareBtn').isVisible(), true);
    assert.equal(await page.locator('#headerMenu').count(), 1);
    assert.equal(await page.locator('#resetBtn').isVisible(), false);
    assert.equal(await page.locator('#printBtn').isVisible(), false);
    await page.locator('#headerMenu summary').click();
    assert.equal(await page.locator('#resetBtn').isVisible(), true);
    assert.equal(await page.locator('#printBtn').isVisible(), true);
    await page.locator('#headerMenu summary').press('Escape');
    assert.equal(await page.locator('#headerMenu').evaluate(el => el.open), false);
    const header = await page.locator('.header-top').boundingBox();
    const brand = await page.locator('.brand-block').boundingBox();
    const actions = await page.locator('.header-actions').boundingBox();
    assert.ok(header && brand && actions);
    assert.ok(actions.y < brand.y + brand.height + 2,
      'les actions doivent rester alignées dans la même rangée que le logo sur mobile');
  } finally {
    await context.close();
  }
});

test('la mutuelle est affichée en une ligne et appliquée automatiquement à 30 € / 30 €', async () => {
  const { context, page } = await openApp({ emptyStorage: true });
  try {
    assert.equal(await page.locator('.onboarding-mutuelle-note').isVisible(), true);
    assert.ok((await page.locator('.onboarding-mutuelle-note').innerText()).includes('30 € salarié · 30 € employeur'));
    assert.equal(await page.locator('#modalOnboardingMutuelle').count(), 0);
    assert.equal(await page.locator('#modalOnboardingMutuellePat').count(), 0);
    await page.locator('#modalOnboardingInput').fill('2500');
    await page.locator('#modalOnboardingSubmit').click();
    await page.waitForFunction(() => {
      const state = JSON.parse(localStorage.getItem('onnet.state.v1') || 'null');
      return state?.scenarios?.length === 1 && state.scenarios[0].mutuelle === 30 &&
        state.scenarios[0].mutuellePat === 30;
    });
    await page.locator('#addScenario').click();
    assert.equal(await page.locator('.onboarding-mutuelle-note').isVisible(), true);
    assert.equal(await page.locator('#modalAddMutuelle').count(), 0);
    assert.equal(await page.locator('#modalAddMutuellePat').count(), 0);
  } finally {
    await context.close();
  }
});

test('les chiffres principaux et le repère SMIC sont calculés via l’API', async () => {
  const { context, page, calls } = await openApp();
  try {
    assert.match(await page.locator('#cardsBody').first().innerText(), /Calcul fondé sur le droit commun : 4 h supplémentaires rémunérées par semaine, majorées à 25 %/);
    assert.match(await page.locator('#cardsBody').first().innerText(), /Les RTT ne sont pas pris en compte/);
    assert.ok(calls.bodies.some(body => body.situation['salarié . temps de travail . heures supplémentaires']));
    assert.ok(calls.bodies.filter(body => body.expressions.includes('salarié . rémunération . brut')).every(body => body.situation['établissement . commune'] === "'Pacé'"));
    assert.ok(calls.bodies.some(body => body.expressions.includes('SMIC')));
    assert.ok(calls.bodies.some(body => body.situation['salarié . contrat . salaire brut'] === '1867.020000 €/mois'));
    assert.match(await page.locator('.benchmark-heading').innerText(), /par heure/);
    assert.match(await page.locator('.benchmark-your-salary').innerText(), /Votre net avant impôt/);
    const cardNetAfterTax = await page.locator('#cardsBody .hero-value').first().innerText();
    const cardNetBeforeTax = await page.locator('#cardsBody .hero-pas').first().innerText();
    const benchmarkNetBeforeTax = await page.locator('.benchmark-your-salary strong').innerText();
    const parseEuro = value => Number(value.replace(/[^\d,.-]/g, '').replace(',', '.'));
    assert.match(await page.locator('#cardsBody .hero-label').first().innerText(), /Net après impôt estimé mensuel/);
    assert.match(cardNetBeforeTax, /Avant impôt/);
    assert.equal(parseEuro(cardNetBeforeTax), parseEuro(benchmarkNetBeforeTax), 'la carte et le comparatif doivent réutiliser le même net avant impôt Urssaf');
    assert.equal(parseEuro(cardNetAfterTax), parseEuro(benchmarkNetBeforeTax) - 100, 'la valeur principale doit afficher le net après impôt renvoyé par le moteur');
    assert.equal(await page.locator('#cardsBody [data-result-state="ready"]').count(), 1);
  } finally {
    await context.close();
  }
});


test('le SMIC est récupéré via l’API et aucun réglage manuel n’est proposé', async () => {
  const { context, page, calls } = await openApp({ smicValue: 1950.25 });
  try {
    assert.ok(calls.bodies.some(body => body.expressions.includes('SMIC')));
    assert.equal(await page.locator('.benchmark-settings').count(), 0);
    assert.equal(await page.locator('#benchmarkSmicBrut').count(), 0);
    assert.equal(await page.locator('#benchmarkSmicDate').count(), 0);
    assert.equal(await page.locator('#saveBenchmarkSettings').count(), 0);
    assert.equal(await page.locator('#resetBenchmarkSettings').count(), 0);
    assert.ok(calls.bodies.some(body => body.situation['salarié . contrat . salaire brut'] === '1950.250000 €/mois'));
  } finally {
    await context.close();
  }
});

test('en cas d’échec de récupération du SMIC, ne présente pas le montant de secours comme actuel', async () => {
  const { context, page } = await openApp({ consent:false, failApi:true });
  try {
    await page.locator('#urssafCalculateBtn').click();
    await page.waitForFunction(() =>
      (document.getElementById('benchmarkBody')?.textContent || '').includes('indisponible via l’API officielle'),
      null, { timeout: 15000 }
    );
    assert.match(await page.locator('#benchmarkBody').innerText(), /indisponible via l’API officielle/);
    assert.doesNotMatch(await page.locator('#benchmarkBody').innerText(), /1\s?867,02/);
  } finally {
    await context.close();
  }
});

test('transmet la commune propre à chaque salaire et la conserve dans le lien partagé', async () => {
  const { context, page, calls } = await openApp();
  try {
    await context.route('https://geo.api.gouv.fr/communes**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        nom: 'Rennes',
        code: '35238',
        codesPostaux: ['35000'],
        codeDepartement: '35',
        departement: { nom: 'Ille-et-Vilaine', code: '35' }
      }])
    }));
    const card = page.locator('#cardsBody [data-card]').first();
    await card.locator('details.more summary').click();
    await card.locator('[data-key="commune"]').fill('Rennes');
    await page.waitForSelector('.commune-option', { timeout: 5000 });
    await page.locator('.commune-option').first().click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#cardsBody [data-card]')].every(card => card.dataset.resultState === 'ready') &&
      (document.getElementById('urssafStatusText')?.textContent || '').includes('Calculs à jour'),
      null, { timeout: 15000 }
    );
    assert.ok(calls.bodies.some(body =>
      body.situation['établissement . commune'] === "'Rennes'" &&
      body.situation['établissement . commune . département'] === "'Ille-et-Vilaine'"
    ));

    await page.locator('#shareBtn').click();
    await page.locator('#shareCreateBtn').click();
    const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
    const payload = await page.evaluate(url => {
      const encoded = new URL(url).hash.slice('#share='.length).replace(/-/g, '+').replace(/_/g, '/');
      const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), c => c.charCodeAt(0))));
    }, shareUrl);
    assert.equal(payload.scenarios[0].commune, 'Rennes');
    assert.equal(payload.scenarios[0].codePostal, '35000');
    assert.equal(payload.scenarios[0].departement, 'Ille-et-Vilaine');
  } finally {
    await context.close();
  }
});

test('affiche les avertissements et les variables par défaut renvoyés par Urssaf', async () => {
  const { context, page } = await openApp({
    warnings: [{ message: 'Une règle expérimentale a été utilisée.' }],
    missingVariables: { 'salarié . contrat . catégorie professionnelle': 1 }
  });
  try {
    assert.equal(await page.locator('#urssafWarnings').isVisible(), true);
    await page.locator('#urssafWarnings summary').click();
    const diagnostics = await page.locator('#urssafWarningsList').innerText();
    assert.match(diagnostics, /règle expérimentale/);
    assert.match(diagnostics, /catégorie professionnelle/);
    assert.equal(await page.locator('#cardsBody .result-source details').count(), 1);
  } finally {
    await context.close();
  }
});

test('gère une indisponibilité Urssaf sans afficher de résultat local', async () => {
  const { context, page, calls } = await openApp({ consent: false, failApi: true });
  try {
    await page.locator('#urssafCalculateBtn').click();
    await page.waitForFunction(() =>
      document.querySelector('#cardsBody [data-result-state="error"]') !== null,
      null, { timeout: 12000 }
    );
    assert.ok(calls.count >= 1);
    assert.equal(await page.locator('#cardsBody .hero-value').first().innerText(), '—');
    assert.match(await page.locator('#cardsBody .result-source').first().innerText(), /indisponible|joindre l’API Urssaf/);
    assert.equal(await page.locator('#urssafCalculateBtn').isVisible(), true);
  } finally {
    await context.close();
  }
});

test('ajoute un salaire et recalcule uniquement le nouveau scénario avec Urssaf', async () => {
  const { context, page, calls } = await openApp();
  try {
    const before = calls.count;
    await addSecondScenario(page, '3200');
    await page.waitForFunction(() =>
      document.querySelectorAll('#cardsBody [data-result-state="ready"]').length === 2,
      null, { timeout: 15000 }
    );
    assert.ok(calls.count > before);
    assert.equal(await page.locator('#cardsBody [data-card]').count(), 2);
    assert.equal(await page.locator('#cardsBody [data-key="brut"]').nth(1).inputValue(), '3200');
  } finally {
    await context.close();
  }
});

test('limite la valeur unitaire des titres-restaurant à 500 € dans la carte', async () => {
  const { context, page } = await openApp();
  try {
    await page.locator('#cardsBody details.more').first().locator('summary').click();
    const field = page.locator('#cardsBody [data-key="valeurResto"]').first();
    await field.fill('800');
    await field.blur();
    assert.equal(await field.inputValue(), '500');
    await page.waitForFunction(() => {
      const state = JSON.parse(localStorage.getItem('onnet.state.v1') || 'null');
      return state?.scenarios?.[0]?.valeurResto === 500;
    });
  } finally {
    await context.close();
  }
});
test('transmet les deux parts de mutuelle par défaut lors de l’ajout', async () => {
  const { context, page, calls } = await openApp();
  try {
    const before = calls.count;
    await page.locator('#addScenario').click();
    await page.locator('#modalAddInput').fill('3400');
    assert.equal(await page.locator('.onboarding-mutuelle-note').innerText(), 'Mutuelle\n30 € salarié · 30 € employeur');
    assert.equal(await page.locator('#modalAddMutuelle').count(), 0);
    assert.equal(await page.locator('#modalAddMutuellePat').count(), 0);
    await page.locator('#modalAddSubmit').click();
    await page.waitForFunction(() =>
      document.querySelectorAll('#cardsBody [data-result-state="ready"]').length === 2,
      null, { timeout: 15000 }
    );
    const storedState = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')));
    const stored = storedState.scenarios.find(scenario =>
      Number(scenario.brut) === 3400
    );
    assert.ok(stored, 'le nouveau scénario doit être persisté');
    assert.equal(stored.mutuelle, 30);
    assert.equal(stored.mutuellePat, 30);
    const request = calls.bodies.slice(before).find(body =>
      body.situation['salarié . cotisations . prévoyances . santé . montant'] === '60.000000 €/mois'
    );
    assert.ok(request, 'la requête Urssaf du nouveau scénario doit exister');
    assert.equal(request.situation['salarié . cotisations . prévoyances . santé . montant'], '60.000000 €/mois');
    assert.equal(request.situation['salarié . cotisations . prévoyances . santé . taux employeur'], '50.000000%');
  } finally {
    await context.close();
  }
});

test('conserve la saisie du brut après rechargement sans consentement implicite', async () => {
  const { context, page, calls } = await openApp();
  try {
    const before = calls.count;
    const gross = page.locator('#cardsBody [data-key="brut"]').first();
    await gross.fill('3100');
    await page.waitForFunction(() => {
      const state = JSON.parse(localStorage.getItem('onnet.state.v1') || 'null');
      return state && state.scenarios[0].brut === 3100;
    });
    await page.waitForFunction(() =>
      document.querySelector('#cardsBody [data-result-state="ready"]') !== null &&
      document.querySelector('#cardsBody .hero-value')?.textContent !== '—',
      null, { timeout: 12000 }
    );
    assert.ok(calls.count > before);
    await page.reload();
    assert.equal(await page.locator('#cardsBody [data-key="brut"]').first().inputValue(), '3100');
    assert.equal(await page.locator('#urssafCalculateBtn').isVisible(), true);
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
    assert.equal(await sharedPage.locator('#urssafCalculateBtn').isVisible(), true);
  } finally {
    await context.close();
  }
});

test('le foyer fiscal modifie les paramètres transmis au moteur Urssaf', async () => {
  const { context, page, calls } = await openApp();
  try {
    const before = calls.count;
    await page.locator('#foyerModuleToggle').click();
    await page.locator('#foyerSituation [data-foyer="commun"]').click();
    await page.locator('#foyerConjoint').fill('24000');
    await waitForCalls(calls, before + 2, 15000);
    assert.ok(calls.bodies.some(body =>
      body.situation['impôt . foyer fiscal . situation de famille'] === "'couple'" &&
      body.situation['impôt . foyer fiscal . revenu imposable . autres revenus imposables'] === '24000.00 €/an'
    ));
  } finally {
    await context.close();
  }
});

test('un scénario avec 13 mensualités est signalé au lieu d’un calcul local', async () => {
  const { context, page, calls } = await openApp();
  try {
    const before = calls.count;
    const card = page.locator('#cardsBody [data-card]').first();
    await card.locator('details.more summary').click();
    await card.locator('[data-key="nbMois"]').fill('13');
    await card.locator('[data-key="nbMois"]').blur();
    await page.waitForFunction(() => {
      const card = document.querySelector('#cardsBody [data-card]');
      return card?.dataset.resultState === 'error' &&
        (card.querySelector('.result-source')?.textContent || '').includes('13ᵉ/14ᵉ mois');
    }, null, { timeout: 5000 });
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(calls.count, before, 'le scénario non pris en charge ne doit pas appeler un moteur local ou une seconde API');
    assert.equal(await card.locator('.hero-value').innerText(), '—');
  } finally {
    await context.close();
  }
});

test('ne propose pas de réessayer pour les paramètres hors périmètre', async () => {
  const { context, page, calls } = await openApp();
  try {
    const before = calls.count;
    const card = page.locator('#cardsBody [data-card]').first();
    await card.locator('details.more summary').click();
    await card.locator('[data-key="nbMois"]').fill('13');
    await card.locator('[data-key="nbMois"]').blur();
    await page.waitForFunction(() =>
      document.querySelector('#cardsBody [data-card] .result-source')?.textContent.includes('nombre de mensualités différent de 12')
    );
    assert.equal(await page.locator('#urssafCalculateBtn').isVisible(), false);
    assert.equal(calls.count, before, 'aucun nouvel appel API pour un scénario non pris en charge');
  } finally {
    await context.close();
  }
});

test('la part salariale des titres-restaurant est bornée à 40–50 %', async () => {
  const { context, page } = await openApp();
  try {
    const card = page.locator('#cardsBody [data-card]').first();
    await card.locator('details.more summary').click();
    const part = card.locator('[data-key="partResto"]');
    assert.equal(await part.getAttribute('data-min'), '40');
    assert.equal(await part.getAttribute('data-max'), '50');
  } finally {
    await context.close();
  }
});

test('la recherche de commune confirme le département transmis à Urssaf', async () => {
  const { context, page, calls } = await openApp();
  try {
    await context.route('https://geo.api.gouv.fr/communes**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        nom: 'Rennes',
        code: '35238',
        codesPostaux: ['35000', '35200'],
        codeDepartement: '35',
        departement: { nom: 'Ille-et-Vilaine', code: '35' }
      }])
    }));
    const before = calls.count;
    const card = page.locator('#cardsBody [data-card]').first();
    await card.locator('details.more summary').click();
    const commune = card.locator('[data-key="commune"]');
    await commune.fill('Rennes');
    await page.waitForSelector('.commune-option', { timeout: 5000 });
    await page.locator('.commune-option').first().click();
    await waitForCalls(calls, before + 1, 15000);
    const request = calls.bodies.slice(before).find(body =>
      body.situation['établissement . commune'] === "'Rennes'" &&
      body.situation['établissement . commune . département'] === "'Ille-et-Vilaine'"
    );
    assert.ok(request, 'la commune et le département confirmés doivent être transmis ensemble');
    assert.match(await page.locator('#cardsBody [data-key="commune"]').first().inputValue(), /Rennes.*35000.*Ille-et-Vilaine/);
  } finally {
    await context.close();
  }
});

test('une commune saisie sans sélection bloque le calcul API', async () => {
  const { context, page, calls } = await openApp();
  try {
    const before = calls.count;
    const card = page.locator('#cardsBody [data-card]').first();
    await card.locator('details.more summary').click();
    const commune = card.locator('[data-key="commune"]');
    await commune.fill('Ville inventée');
    await commune.blur();
    await page.waitForFunction(() =>
      document.querySelector('#cardsBody [data-card]')?.dataset.resultState === 'error'
    );
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(calls.count, before, 'une commune non confirmée ne doit pas déclencher de calcul');
    assert.match(await page.locator('#cardsBody [data-card] .result-source').first().innerText(), /Sélectionnez une commune/);
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


test('l’onboarding garde les paramètres secondaires repliés et applique 30 € par part de mutuelle', async () => {
  const { context, page } = await openApp({ emptyStorage: true });
  try {
    const modal = page.locator('#modalOverlay');
    await modal.waitFor({ state: 'visible' });
    assert.equal(await modal.locator('.onboarding-optional').getAttribute('open'), null);
    assert.equal(await modal.locator('#modalOnboardingMutuelle').count(), 0);
    assert.equal(await modal.locator('#modalOnboardingMutuellePat').count(), 0);
    assert.ok((await modal.locator('.onboarding-mutuelle-note').innerText()).includes('30 € salarié · 30 € employeur'));
    const overtimeHint = modal.locator('#modalOnboarding39Hint');
    assert.equal(await overtimeHint.isVisible(), false);
    await modal.locator('#modalOnboardingDuree [data-duree="39"]').click();
    assert.equal(await overtimeHint.isVisible(), true);
    assert.match(await overtimeHint.innerText(), /droit commun.*majorées à 25 %.*taux particuliers des conventions collectives ne sont pas pris en compte.*RTT/);
    await modal.locator('#modalOnboardingDuree [data-duree="35"]').click();
    assert.equal(await overtimeHint.isVisible(), false);
    await modal.locator('#modalOnboardingInput').fill('2500');
    await modal.locator('#modalOnboardingSubmit').click();
    await page.waitForFunction(() => {
      const state = JSON.parse(localStorage.getItem('onnet.state.v1') || 'null');
      return state?.scenarios?.[0]?.brut === 2500;
    });
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')));
    assert.equal(state.scenarios[0].mutuelle, 30);
    assert.equal(state.scenarios[0].mutuellePat, 30);
  } finally {
    await context.close();
  }
});

test('une récupération du SMIC lente est mutualisée avec le calcul déclenché par le consentement', async () => {
  const { context, page, calls } = await openApp({ consent: false, delayMs: 250 });
  try {
    await page.locator('#urssafCalculateBtn').click();
    await page.waitForFunction(() =>
      (document.getElementById('urssafStatusText')?.textContent || '').includes('Calculs à jour'),
      null, { timeout: 20000 }
    );
    const smicRequests = calls.bodies.filter(body => body.expressions.includes('SMIC'));
    assert.equal(smicRequests.length, 1, 'les appels concurrents doivent partager la même promesse SMIC');
    assert.deepEqual(smicRequests[0].expressions, ['SMIC']);
    assert.ok(calls.bodies.some(body =>
      Object.hasOwn(body.situation, 'salarié . contrat . salaire brut')
    ), 'les calculs salariaux doivent démarrer après le consentement');
  } finally {
    await context.close();
  }
});

test('un échec initial du SMIC peut être retenté et ne bloque pas les calculs après consentement', async () => {
  const { context, page, calls } = await openApp({ consent: false, failFirstCalls: 1 });
  try {
    await waitForCalls(calls, 1);
    assert.match(await page.locator('#benchmarkBody').innerText(), /indisponible via l’API officielle/);
    assert.deepEqual(calls.bodies[0].expressions, ['SMIC']);
    assert.equal(Object.hasOwn(calls.bodies[0].situation, 'salarié . contrat . salaire brut'), false);

    await page.locator('#urssafCalculateBtn').click();
    await page.waitForFunction(() =>
      (document.getElementById('urssafStatusText')?.textContent || '').includes('Calculs à jour') &&
      document.querySelectorAll('#cardsBody [data-result-state="ready"]').length === 1 &&
      document.querySelectorAll('.benchmark-item').length === 2,
      null, { timeout: 20000 }
    );

    assert.ok(calls.count >= 4, 'un nouvel appel SMIC puis les calculs salariaux sont attendus');
    assert.equal(calls.bodies.filter(body => body.expressions.includes('SMIC')).length, 2,
      'le SMIC doit être retenté une seule fois après l’échec initial');
    assert.ok(calls.bodies.some(body =>
      Object.hasOwn(body.situation, 'salarié . contrat . salaire brut')
    ));
  } finally {
    await context.close();
  }
});


test('affiche et préremplit correctement l’hypothèse 39 h dans l’ajout de salaire', async () => {
  const { context, page } = await openApp();
  try {
    await page.locator('#addScenario').click();
    const hint = page.locator('#modalAdd39Hint');
    assert.equal(await hint.isVisible(), true);
    assert.equal(await page.locator('#modalAddDuree [data-duree="39"]').getAttribute('aria-pressed'), 'true');
    await page.locator('#modalAddDuree [data-duree="35"]').click();
    assert.equal(await hint.isVisible(), false);
    await page.locator('#modalAddDuree [data-duree="39"]').click();
    assert.equal(await hint.isVisible(), true);
    assert.match(await hint.innerText(), /droit commun.*majorées à 25 %.*taux particuliers des conventions collectives ne sont pas pris en compte.*RTT/);
    await page.locator('#modalAddDuree [data-duree="35"]').click();
    assert.equal(await hint.isVisible(), false);
    await page.locator('#modalAddDuree [data-duree="39"]').click();
    await page.locator('#modalAddInput').fill('3300');
    await page.locator('#modalAddSubmit').click();
    await page.waitForFunction(() =>
      document.querySelectorAll('#cardsBody [data-result-state="ready"]').length === 2,
      null, { timeout: 15000 }
    );
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')));
    assert.equal(state.scenarios[1].dureeType, '39');
    await page.locator('#addScenario').click();
    assert.equal(await page.locator('#modalAddDuree [data-duree="39"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await hint.isVisible(), true);
    await page.locator('#modalAddCancel').click();
  } finally {
    await context.close();
  }
});


test('le graphique explique explicitement qu’il montre le net avant impôt', async () => {
  const { context, page } = await openApp();
  try {
    await page.waitForSelector('#comparePanel .chart-scope-hint');
    assert.equal((await page.locator('#comparePanel > h2').innerText()).trim(), 'Du brut au net avant impôt');
    const scope = await page.locator('#comparePanel .chart-scope-hint').innerText();
    assert.match(scope, /net à payer avant impôt/i);
    assert.match(scope, /ne modifient pas ce graphique/i);
  } finally {
    await context.close();
  }
});


test('les bascules brut/net et mensuel/annuel actualisent les valeurs et leur état visuel', async () => {
  const { context, page } = await openApp();
  try {
    const card = page.locator('#cardsBody [data-card]').first();
    await page.locator('#amtToggle [data-amt="brut"]').click();
    assert.equal(await card.locator('.hero-label').innerText(), 'Brut mensuel');
    assert.equal(await page.locator('#amtToggle [data-amt="brut"]').getAttribute('aria-pressed'), 'true');
    await page.locator('#periodToggle [data-period="an"]').click();
    assert.equal(await card.locator('.hero-label').innerText(), 'Brut annuel');
    assert.equal(await page.locator('#periodToggle [data-period="an"]').getAttribute('aria-pressed'), 'true');
    await page.locator('#amtToggle [data-amt="net"]').click();
    assert.equal(await card.locator('.hero-label').innerText(), 'Net après impôt estimé annuel');
    await page.locator('#periodToggle [data-period="mois"]').click();
    assert.equal(await card.locator('.hero-label').innerText(), 'Net après impôt estimé mensuel');
    assert.equal(await page.locator('#amtToggle [data-amt="net"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#periodToggle [data-period="mois"]').getAttribute('aria-pressed'), 'true');
  } finally {
    await context.close();
  }
});

test('les fiches de salaire précèdent le comparatif et les graphiques vides sont masqués', async () => {
  const { context, page } = await openApp({ consent:false });
  try {
    const order = await page.evaluate(() => {
      const cards = document.querySelector('.cards-bar');
      const comparison = document.querySelector('#comparePanel');
      return cards.compareDocumentPosition(comparison) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    assert.ok(order, 'les fiches de salaire doivent précéder le comparatif');
    assert.equal(await page.locator('#comparePanel').isVisible(), false, 'ne pas afficher un panneau de résultats vide');
  } finally {
    await context.close();
  }
});

test('le texte des heures supplémentaires apparaît uniquement en 39 h', async () => {
  const { context, page } = await openApp();
  try {
    const card = page.locator('#cardsBody [data-card]').first();
    const hint = card.locator('.field-row').filter({ hasText:'Base horaire' }).locator('.sub-hint');
    await card.locator('[data-duree="35"]').click();
    assert.equal(await hint.count(), 0, 'aucune explication d’heures supplémentaires en 35 h');
    await card.locator('[data-duree="39"]').click();
    assert.match(await card.locator('.field-row').filter({ hasText:'Base horaire' }).innerText(), /4 h supplémentaires/);
  } finally {
    await context.close();
  }
});


test('le consentement indique explicitement les données envoyées à l’Urssaf', async () => {
  const { context, page } = await openApp({ consent:false });
  try {
    assert.equal(await page.locator('#urssafCalculateBtn').innerText(), 'Autoriser l’envoi et calculer');
    assert.equal(await page.locator('#urssafStatusText').innerText(),
      'Le calcul nécessite votre autorisation pour transmettre ces paramètres à l’Urssaf.');
  } finally {
    await context.close();
  }
});
