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
  browser = await chromium.launch({ headless: true, timeout: 30000 });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

async function openApp(options = {}) {
  const context = await browser.newContext();
  context.setDefaultTimeout(10000);
  context.setDefaultNavigationTimeout(15000);
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
          displayPeriod: 'mois',
          onboardingCompleted: true
        }));
      }
    });
  }
  await page.goto(baseUrl);
  if (options.advancedOpen !== false && !options.emptyStorage) {
    await page.locator('#advancedWorkspace').evaluate(el => { el.open = true; });
  }
  if (pageErrors.length) {
    await context.close();
    throw new Error('Erreur JavaScript au chargement :\n' + pageErrors.join('\n'));
  }

  if (options.consent !== false && !options.emptyStorage) {
    await page.locator('#mainSalaryGross').fill('2300');
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
  await page.locator('#maquetteAddSalary').click();
  await page.locator('#modalAddInput').fill(gross);
  await page.locator('#modalAddSubmit').click();
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll('#cardsBody [data-card]')];
    return cards.length === 2 &&
      cards.every(card => card.dataset.resultState === 'ready') &&
      document.querySelectorAll('#stackChart .stack-col').length === 2 &&
      document.querySelectorAll('#stackLegend .legend-item').length === 4;
  }, null, { timeout: 20000 });
}

test('indique la source Urssaf et ne transmet aucune donnée avant la saisie du formulaire', { timeout: 60000 }, async () => {
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
    assert.match(await page.locator('#urssafStatusText').innerText(), /Renseignez votre salaire pour autoriser sa transmission/);
    assert.equal(await page.locator('#urssafRememberConsent').count(), 0,
      'le choix de consentement ne doit plus être mémorisé par une case à cocher');
    assert.equal(await page.locator('.urssaf-data-details').count(), 0, 'le panneau de consentement redondant doit rester supprimé');
    assert.equal(await page.locator('.declaration-api-notice').count(), 0, 'aucun pavé de consentement redondant ne doit être affiché');
    assert.equal(await page.locator('.urssaf-status-main').count(), 0);
    assert.equal(await page.locator('#updateDeclaredSalary').count(), 0);

    await page.locator('#mainSalaryGross').fill('2300');
    await page.waitForFunction(() =>
      (document.getElementById('urssafStatusText')?.textContent || '').includes('Calculs à jour'),
      null, { timeout: 20000 }
    );
    assert.ok(calls.count >= 3);
    assert.match(await page.locator('#cardsBody [data-result-state="ready"]').first().innerText(), /API officielle Mon-entreprise \(Urssaf\)/);
    assert.equal(await page.locator('#updateDeclaredSalary').count(), 0);

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


test('le haut de page garde le partage visible et regroupe les actions secondaires', { timeout: 60000 }, async () => {
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
    const header = await page.locator('.maquette-top').boundingBox();
    const brand = await page.locator('.maquette-top > .brand').boundingBox();
    const actions = await page.locator('.maquette-top > .header-actions').boundingBox();
    assert.ok(header && brand && actions, 'la barre supérieure, la marque et les actions doivent être présentes');
    assert.ok(actions.y < brand.y + brand.height + 2,
      'les actions doivent rester alignées dans la même rangée que le logo sur mobile');
    assert.ok(actions.x + actions.width <= header.x + header.width + 1,
      'les actions doivent rester dans la barre supérieure');
  } finally {
    await context.close();
  }
});

test('la mutuelle affiche la part salarié sans exposer la part employeur', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ emptyStorage: true });
  try {
    assert.equal(await page.locator('.onboarding-mutuelle-note').isVisible(), true);
    assert.ok((await page.locator('.onboarding-mutuelle-note').innerText()).includes('30 € salarié'));
    assert.equal(await page.locator('#modalOnboardingMutuelle').count(), 0);
    assert.equal(await page.locator('#modalOnboardingMutuellePat').count(), 0);
    await page.locator('#modalOnboardingInput').fill('2500');
    await page.locator('#modalOnboardingSubmit').click();
    await page.waitForFunction(() => {
      const state = JSON.parse(localStorage.getItem('onnet.state.v1') || 'null');
      return state?.scenarios?.length === 1 && state.scenarios[0].brut === 2500 &&
        state.scenarios[0].mutuelle === 30 && state.scenarios[0].mutuellePat === 30;
    });
    await page.locator('#advancedWorkspace > summary').click();
    await page.locator('#maquetteAddSalary').click();
    assert.equal(await page.locator('.onboarding-mutuelle-note').isVisible(), true);
    assert.equal(await page.locator('#modalAddMutuelle').count(), 0);
    assert.equal(await page.locator('#modalAddMutuellePat').count(), 0);
  } finally {
    await context.close();
  }
});

test('les chiffres principaux et le repère SMIC sont calculés via l’API', { timeout: 60000 }, async () => {
  const { context, page, calls } = await openApp();
  try {
    assert.equal(await page.locator('#mainSalaryHours').inputValue(), '39',
      'le formulaire de référence doit conserver la durée 39 h');
    assert.ok(calls.bodies.some(body => body.situation['salarié . temps de travail . heures supplémentaires']));
    assert.ok(calls.bodies.filter(body => body.expressions.includes('salarié . rémunération . brut')).every(body => body.situation['établissement . commune'] === "'Pacé'"));
    assert.ok(calls.bodies.some(body => body.expressions.includes('SMIC')));
    const smicBenchmarkRequests = calls.bodies.filter(body =>
      body.expressions.length === 2 &&
      body.expressions.includes('salarié . rémunération . brut') &&
      Number.parseFloat(body.situation['salarié . temps de travail . heures supplémentaires'] || '0') > 17
    );
    const finalSmicRequest = smicBenchmarkRequests.at(-1);
    assert.ok(finalSmicRequest, 'le SMIC 39 h doit être calculé par l’API avec des heures supplémentaires');
    const smicBase39 = Number.parseFloat(finalSmicRequest.situation['salarié . contrat . salaire brut']);
    const smicOvertime39 = Number.parseFloat(finalSmicRequest.situation['salarié . temps de travail . heures supplémentaires']);
    const smicGross39 = smicBase39 * (151.67 + smicOvertime39 * 1.25) / 151.67;
    const expectedSmicGross39 = 1867.02 * (151.67 + smicOvertime39 * 1.25) / 151.67;
    assert.ok(Math.abs(smicBase39 - 1867.02) < 0.02,
      'la base mensuelle doit rester égale au SMIC officiel 35 h');
    assert.ok(Math.abs(smicGross39 - expectedSmicGross39) < 0.03,
      'le brut total 39 h doit ajouter les 4 heures supplémentaires majorées au SMIC 35 h');
    assert.match(await page.locator('.comparison-subhead').innerText(), /Comparer votre salaire/);
    assert.match(await page.locator('.comparison-period').innerText(), /Heure/);
    const medianMethod = await page.locator('#benchmarkBody .benchmark-details').nth(1).textContent();
    assert.match(medianMethod, /2\s?238/);
    assert.match(medianMethod, /Données INSEE 2025, publiées en 2026/);
    assert.doesNotMatch(medianMethod, /2\s?190|INSEE 2024/);
    assert.match(await page.locator('.benchmark-your-salary').innerText(), /VOUS/);
    const cardNetAfterTax = await page.locator('#cardsBody .hero-value').first().innerText();
    const cardNetBeforeTax = await page.locator('#cardsBody .hero-pas').first().innerText();
    const benchmarkHourlyNet = await page.locator('.benchmark-your-salary > strong').innerText();
    const parseEuro = value => Number(value.replace(/[^\d,.-]/g, '').replace(',', '.'));
    assert.match(await page.locator('#cardsBody .hero-label').first().innerText(), /Net après impôt estimé mensuel/);
    assert.match(cardNetBeforeTax, /Avant impôt/);
    assert.ok(Math.abs(parseEuro(benchmarkHourlyNet) - parseEuro(cardNetBeforeTax) / 169) < 0.02,
      'le résumé horaire doit reprendre le net avant impôt Urssaf divisé par les 169 h du contrat 39 h');
    assert.equal(parseEuro(cardNetAfterTax), parseEuro(cardNetBeforeTax) - 100, 'la valeur principale doit afficher le net après impôt renvoyé par le moteur');
    await page.locator('#moreMetrics > summary').click();
    await page.waitForFunction(() => document.getElementById('moreMetrics')?.open === true);
    const afterTaxHourlyButton = page.locator('.metric-toggle button[data-metric="netApresImpotHoraire"]');
    assert.equal(await afterTaxHourlyButton.count(), 1, 'un indicateur de net horaire après impôt doit être disponible');
    await afterTaxHourlyButton.evaluate(button => button.click());
    await page.waitForFunction(() =>
      document.querySelector('.metric-toggle button[data-metric="netApresImpotHoraire"]')?.getAttribute('aria-pressed') === 'true'
    );
    const afterTaxHourlyValue = await page.locator('#comparePanel .bar-row').first().locator('.bar-value span').first().innerText();
    const actualHourly = parseEuro(afterTaxHourlyValue);
    const expectedHourly = parseEuro(cardNetAfterTax) / 169;
    assert.ok(Math.abs(actualHourly - expectedHourly) < 0.02,
      `net horaire après impôt incorrect : affiché=${afterTaxHourlyValue} (${actualHourly}), net mensuel=${cardNetAfterTax} (${parseEuro(cardNetAfterTax)}), attendu=${expectedHourly}, métrique active=${await afterTaxHourlyButton.getAttribute('aria-pressed')}, ligne=${await page.locator('#comparePanel .bar-row').first().innerText()}`);
    assert.equal(await page.locator('#cardsBody [data-result-state="ready"]').count(), 1);
  } finally {
    await context.close();
  }
});


test('le SMIC est récupéré via l’API et aucun réglage manuel n’est proposé', { timeout: 60000 }, async () => {
  const { context, page, calls } = await openApp({ smicValue: 1950.25 });
  try {
    assert.ok(calls.bodies.some(body => body.expressions.includes('SMIC')));
    assert.equal(await page.locator('.benchmark-settings').count(), 0);
    assert.equal(await page.locator('#benchmarkSmicBrut').count(), 0);
    assert.equal(await page.locator('#benchmarkSmicDate').count(), 0);
    assert.equal(await page.locator('#saveBenchmarkSettings').count(), 0);
    assert.equal(await page.locator('#resetBenchmarkSettings').count(), 0);
    const smicRequests = calls.bodies.filter(body =>
      body.expressions.length === 2 &&
      body.expressions.includes('salarié . rémunération . brut') &&
      Number.parseFloat(body.situation['salarié . temps de travail . heures supplémentaires'] || '0') > 17
    );
    assert.ok(smicRequests.length > 0, 'le repère SMIC 39 h doit être envoyé à l’API');
    const customBase39 = Number.parseFloat(smicRequests.at(-1).situation['salarié . contrat . salaire brut']);
    const customOvertime39 = Number.parseFloat(smicRequests.at(-1).situation['salarié . temps de travail . heures supplémentaires']);
    const customGross39 = customBase39 * (151.67 + customOvertime39 * 1.25) / 151.67;
    const expectedCustomGross39 = 1950.25 * (151.67 + customOvertime39 * 1.25) / 151.67;
    assert.ok(Math.abs(customBase39 - 1950.25) < 0.02,
      'la base mensuelle doit reprendre le montant SMIC renvoyé par l’API');
    assert.ok(Math.abs(customGross39 - expectedCustomGross39) < 0.03,      'le brut total 39 h doit intégrer les heures supplémentaires majorées au montant de base renvoyé par l’API');
  } finally {
    await context.close();
  }
});

test('en cas d’échec de récupération du SMIC, ne présente pas le montant de secours comme actuel', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ consent:false, failApi:true });
  try {
    await page.locator('#mainSalaryGross').fill('2300');
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

test('transmet la commune propre à chaque salaire et la conserve dans le lien partagé', { timeout: 60000 }, async () => {
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

test('affiche les avertissements et les variables par défaut renvoyés par Urssaf', { timeout: 60000 }, async () => {
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

test('gère une indisponibilité Urssaf sans afficher de résultat local', { timeout: 60000 }, async () => {
  const { context, page, calls } = await openApp({ consent: false, failApi: true });
  try {
    assert.equal(calls.bodies.some(body => Object.hasOwn(body.situation, 'salarié . contrat . salaire brut')), false);
    await page.locator('#mainSalaryGross').fill('2500');
    await page.waitForFunction(() =>
      document.querySelector('#cardsBody [data-result-state="error"]') !== null,
      null, { timeout: 12000 }
    );
    assert.ok(calls.count >= 1);
    assert.equal(await page.locator('#cardsBody .hero-value').first().innerText(), '—');
    assert.match(await page.locator('#cardsBody .result-source').first().innerText(), /indisponible|joindre l’API Urssaf/);
    assert.equal(await page.locator('#updateDeclaredSalary').count(), 0);
  } finally {
    await context.close();
  }
});

test('ajoute un salaire et recalcule uniquement le nouveau scénario avec Urssaf', { timeout: 60000 }, async () => {
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
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')));
    assert.equal(stored.scenarios[1].brut, 3200, 'le second salaire doit être conservé dans le scénario');
  } finally {
    await context.close();
  }
});

test('limite la valeur unitaire des titres-restaurant à 500 € dans la carte', { timeout: 60000 }, async () => {
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
test('transmet les deux parts de mutuelle par défaut lors de l’ajout', { timeout: 60000 }, async () => {
  const { context, page, calls } = await openApp();
  try {
    const before = calls.count;
    await page.locator('#addScenario').click();
    await page.locator('#modalAddInput').fill('3400');
    assert.equal(await page.locator('.onboarding-mutuelle-note').innerText(), 'Mutuelle\n30 € salarié');
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

test('conserve la saisie du brut après rechargement sans consentement implicite', { timeout: 60000 }, async () => {
  const { context, page, calls } = await openApp();
  try {
    const before = calls.count;
    const gross = page.locator('#mainSalaryGross');
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
    assert.equal(await page.locator('#mainSalaryGross').inputValue(), '3100');
    assert.equal(await page.locator('#updateDeclaredSalary').count(), 0);
  } finally {
    await context.close();
  }
});

test('un retour de session ne retransmet pas le salaire enregistré avant une nouvelle modification', { timeout: 60000 }, async () => {
  const { context, page, calls } = await openApp({ consent: false });
  try {
    await waitForCalls(calls, 1);
    const hasSalary = () => calls.bodies.some(body =>
      Object.hasOwn(body.situation, 'salarié . contrat . salaire brut')
    );
    assert.equal(hasSalary(), false, 'aucun salaire ne doit être transmis au chargement');

    await page.reload();
    assert.equal(hasSalary(), false, 'le rechargement ne doit pas réactiver le consentement');

    await page.locator('#mainSalaryGross').fill('3200');
    await page.waitForFunction(() =>
      (document.getElementById('urssafStatusText')?.textContent || '').includes('Calculs à jour')
    , null, { timeout: 20000 });
    assert.equal(hasSalary(), true, 'une modification explicite doit déclencher le calcul');
  } finally {
    await context.close();
  }
});

test('recrée les scénarios à partir du lien de partage', { timeout: 60000 }, async () => {
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
    const sharedState = await sharedPage.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')));
    assert.equal(sharedState.scenarios[1].brut, 3450);
    assert.equal(await sharedPage.locator('#updateDeclaredSalary').count(), 0);
  } finally {
    await context.close();
  }
});

test('le foyer fiscal modifie les paramètres transmis au moteur Urssaf', { timeout: 60000 }, async () => {
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

test('le concubinage réutilise le calcul individuel sans transmettre les revenus du partenaire', { timeout: 60000 }, async () => {
  const { context, page, calls } = await openApp();
  try {
    await page.locator('#foyerModuleToggle').click();
    await page.locator('#foyerSituation [data-foyer="commun"]').click();
    await page.locator('#foyerConjoint').fill('24000');
    await page.waitForFunction(() => {
      const status = document.getElementById('urssafStatusText')?.textContent || '';
      const cards = [...document.querySelectorAll('#cardsBody [data-card]')];
      return status.includes('Calculs à jour') &&
        cards.length > 0 && cards.every(card => card.dataset.resultState === 'ready');
    }, null, { timeout: 20000 });

    assert.ok(calls.bodies.some(body =>
      body.situation['impôt . foyer fiscal . situation de famille'] === "'couple'" &&
      body.situation['impôt . foyer fiscal . revenu imposable . autres revenus imposables'] === '24000.00 €/an'
    ), 'les revenus du conjoint doivent être transmis pour un foyer marié/PACSé');

    const callsBeforeConcubinage = calls.count;
    await page.locator('#foyerSituation [data-foyer="concubinage"]').click();
    await page.waitForFunction(() =>
      document.getElementById('foyerConcubinageInfo')?.style.display !== 'none' &&
      document.getElementById('foyerConjointRow')?.style.display === 'none'
    );
    await page.waitForTimeout(500);

    assert.equal(calls.count, callsBeforeConcubinage,
      'le concubinage doit réutiliser le résultat individuel déjà calculé, sans nouvelle requête avec les revenus du partenaire');
    assert.ok(calls.bodies.some(body =>
      body.situation['impôt . foyer fiscal . situation de famille'] === "'célibataire'" &&
      !Object.hasOwn(body.situation, 'impôt . foyer fiscal . revenu imposable . autres revenus imposables')
    ), 'le calcul individuel ne doit pas inclure les revenus du partenaire');
    assert.equal(await page.locator('#foyerConcubinageInfo').isVisible(), true);
    assert.equal(await page.locator('#foyerConjointRow').isVisible(), false);
  } finally {
    await context.close();
  }
});

test('un scénario avec 13 mensualités est signalé au lieu d’un calcul local', { timeout: 60000 }, async () => {
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

test('ne propose pas de réessayer pour les paramètres hors périmètre', { timeout: 60000 }, async () => {
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
    assert.equal(await page.locator('#updateDeclaredSalary').count(), 0);
    assert.equal(calls.count, before, 'aucun nouvel appel API pour un scénario non pris en charge');
  } finally {
    await context.close();
  }
});

test('bloque les paramètres de titres-restaurant hors plage avant transmission à Urssaf', { timeout: 60000 }, async () => {
  const { context, page, calls } = await openApp({ emptyStorage: true });
  try {
    const modal = page.locator('#modalOverlay');
    await modal.waitFor({ state: 'visible' });
test('la part salariale des titres-restaurant alterne entre 50 % par défaut et 40 % au clic', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ emptyStorage: true });
  try {
    const modal = page.locator('#modalOverlay');
    await modal.waitFor({ state: 'visible' });
    await modal.locator('#modalOnboardingTrToggle [data-tr="oui"]').click();
    const share = modal.locator('#modalOnboardingPart');
    assert.equal(await share.locator('[data-share="50"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await share.locator('[data-share="40"]').getAttribute('aria-pressed'), 'false');
    await share.locator('[data-share="40"]').click();
    assert.equal(await share.locator('[data-share="40"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await share.locator('[data-share="50"]').getAttribute('aria-pressed'), 'false');
  } finally { await context.close(); }
});

    await modal.locator('#modalOnboardingTrToggle [data-tr="oui"]').click();
    await modal.locator('#modalOnboardingInput').fill('2500');
    await modal.locator('#modalOnboardingJours').fill('20.5');
    await modal.locator('#modalOnboardingValeur').fill('8');
    assert.equal(await modal.locator('#modalOnboardingPart [data-share="50"]').getAttribute('aria-pressed'), 'true',
      '50 % doit être sélectionné par défaut');
    const submit = modal.locator('#modalOnboardingSubmit');
    await submit.click();
    assert.equal(await modal.isVisible(), true, 'une saisie invalide ne doit pas fermer la modale');
    assert.match(await modal.locator('#modalMsg').innerText(), /Vérifiez les titres-restaurant/);
    await modal.locator('#modalOnboardingJours').fill('21');
    await modal.locator('#modalOnboardingPart [data-share="40"]').click();
    await submit.click();

    await page.waitForFunction(() => {
      const state = JSON.parse(localStorage.getItem('onnet.state.v1') || 'null');
      return state?.scenarios?.[0]?.joursResto === 21 && state.scenarios[0].partResto === 40;
    });
    await waitForCalls(calls, 2);
    const request = calls.bodies.find(body =>
      body.situation['salarié . rémunération . frais professionnels . titres-restaurant'] === 'oui'
    );
    assert.ok(request, 'une requête avec titres-restaurant doit parvenir au moteur');
    assert.equal(request.situation['salarié . rémunération . frais professionnels . titres-restaurant . nombre'], '21 titres-restaurant/mois');
    assert.equal(request.situation['salarié . rémunération . frais professionnels . titres-restaurant . taux employeur'], '60.000000%');
  } finally {
    await context.close();
  }
});

test('la part salariale des titres-restaurant est bornée à 40–50 %', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    const card = page.locator('#cardsBody [data-card]').first();
    await card.locator('details.more summary').click();
    const part = card.locator('[data-key="partResto"]');
    assert.equal(await part.getAttribute('data-min'), '40');
    assert.equal(await part.getAttribute('data-max'), '50');
    const breakdown = await page.locator('.wf-note').innerText();
    assert.match(breakdown, /21 jours × 8 €/);
    assert.match(breakdown, /part salarié/);
    assert.match(breakdown, /part employeur/);
    await addSecondScenario(page);
    const stackTicketDetails = await page.locator('#stackChart .stack-col .stack-net-notr').allTextContents();
    assert.ok(stackTicketDetails.some(text => text.includes('TR salarié : 84 € · employeur : 84 €')),
      'le graphique comparatif doit afficher les deux contributions aux titres-restaurant');
  } finally {
    await context.close();
  }
});
test('la recherche de commune confirme le département transmis à Urssaf', { timeout: 60000 }, async () => {
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

test('une commune saisie sans sélection bloque le calcul API', { timeout: 60000 }, async () => {
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

test('les outils secondaires sont repliés par défaut et restent accessibles', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ advancedOpen:false, consent:false });
  try {
    const advanced = page.locator('#advancedWorkspace');
    assert.equal(await advanced.evaluate(el => el.open), false);
    assert.equal(await page.locator('#maquetteCompareTitle').isVisible(), true);
    assert.equal(await page.locator('#benchmarkMount').isVisible(), true);
    assert.equal(await page.locator('#cardsScroll').isVisible(), false);
    await advanced.getByText('Paramètres avancés et outils', { exact: true }).click();
    assert.equal(await page.locator('#cardsScroll').isVisible(), true);
    assert.equal(await page.locator('#foyerModuleToggle').isVisible(), true);
    assert.equal(await page.locator('#raiseModuleToggle').isVisible(), true);
  } finally {
    await context.close();
  }
});

test('le comparatif reste dans la largeur sur petits écrans', { timeout: 60000 }, async () => {
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


test('la page ne déborde pas horizontalement sur les largeurs mobiles', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth
      }));
      assert.ok(dimensions.document <= dimensions.viewport + 1,
        `débordement horizontal global à ${width}px : ${JSON.stringify(dimensions)}`);
      assert.ok(dimensions.body <= dimensions.viewport + 1,
        `débordement du body à ${width}px : ${JSON.stringify(dimensions)}`);
    }
  } finally {
    await context.close();
  }
});

test('les contrôles V33 restent actifs pour un utilisateur sans onboarding', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    const month = page.locator('[data-maquette-period="month"]');
    const year = page.locator('[data-maquette-period="year"]');
    await month.click();
    assert.equal(await month.getAttribute('aria-pressed'), 'true');
    assert.equal(await year.getAttribute('aria-pressed'), 'false');
    await year.click();
    assert.equal(await year.getAttribute('aria-pressed'), 'true');
    assert.equal(await month.getAttribute('aria-pressed'), 'false');

    await page.locator('#maquetteAddSalary').click();
    assert.equal(await page.locator('#modalAddInput').isVisible(), true,
      'le bouton Ajouter doit ouvrir la modale de création de scénario');
  } finally {
    await context.close();
  }
});

test('l’onboarding garde les paramètres secondaires repliés et n’affiche que la part salarié', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ emptyStorage: true });
  try {
    const modal = page.locator('#modalOverlay');
    await modal.waitFor({ state: 'visible' });
    assert.equal(await modal.locator('.onboarding-tr-fields').isVisible(), false);
    assert.equal(await modal.locator('#modalOnboardingTrToggle').isVisible(), true);
    assert.equal(await modal.locator('.onboarding-tr-optional').count(), 0,
      'aucune mention facultatif ne doit apparaître à côté des titres-restaurant');
    assert.equal(await modal.locator('.onboarding-mutuelle-label').evaluate(el => getComputedStyle(el).fontWeight), '650',
      'le libellé Mutuelle doit avoir le même niveau de graisse que Titres-restaurant');
    assert.equal(await modal.locator('#modalOnboardingMutuelle').count(), 0);
    assert.equal(await modal.locator('#modalOnboardingMutuellePat').count(), 0);
    assert.ok((await modal.locator('.onboarding-mutuelle-note').innerText()).includes('30 € salarié'));
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

test('une récupération du SMIC lente est mutualisée avec le calcul déclenché par la saisie du formulaire', { timeout: 60000 }, async () => {
  const { context, page, calls } = await openApp({ consent: false, delayMs: 250 });
  try {
    assert.equal(calls.bodies.some(body => Object.hasOwn(body.situation, 'salarié . contrat . salaire brut')), false);
    await page.locator('#mainSalaryGross').fill('2500');
    await page.waitForFunction(() =>
      (document.getElementById('urssafStatusText')?.textContent || '').includes('Calculs à jour'),
      null, { timeout: 20000 }
    );
    const smicRequests = calls.bodies.filter(body => body.expressions.includes('SMIC'));
    assert.equal(smicRequests.length, 1, 'les appels concurrents doivent partager la même promesse SMIC');
    assert.deepEqual(smicRequests[0].expressions, ['SMIC']);
    assert.ok(calls.bodies.some(body =>
      Object.hasOwn(body.situation, 'salarié . contrat . salaire brut')
    ), 'les calculs salariaux doivent démarrer après la validation du formulaire');
  } finally {
    await context.close();
  }
});

test('un échec initial du SMIC peut être retenté et ne bloque pas les calculs après saisie', { timeout: 60000 }, async () => {
  const { context, page, calls } = await openApp({ consent: false, failFirstCalls: 1 });
  try {
    await waitForCalls(calls, 1);
    assert.match(await page.locator('#benchmarkBody').innerText(), /indisponible via l’API officielle/);
    assert.deepEqual(calls.bodies[0].expressions, ['SMIC']);
    assert.equal(Object.hasOwn(calls.bodies[0].situation, 'salarié . contrat . salaire brut'), false);

    await page.locator('#mainSalaryGross').fill('2500');
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


test('affiche et préremplit correctement l’hypothèse 39 h dans l’ajout de salaire', { timeout: 60000 }, async () => {
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


test('le graphique explique explicitement qu’il montre le net avant impôt', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    await page.waitForSelector('#comparePanel .chart-scope-hint');
    assert.equal((await page.locator('#comparePanel > h2').innerText()).trim().replace(/\s+/g, ' '), 'Où part votre salaire ?');
    assert.equal((await page.locator('#comparePanel > .sub').innerText()).trim(), 'Du brut au net avant impôt.');
    const scope = await page.locator('#comparePanel .chart-scope-hint').innerText();
    assert.match(scope, /montants issus de la simulation officielle/i);
    assert.match(scope, /Mon-entreprise \/ Urssaf/i);
  } finally {
    await context.close();
  }
});


test('les bascules brut/net et mensuel/annuel actualisent les valeurs et leur état visuel', { timeout: 60000 }, async () => {
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

test('les fiches de salaire précèdent le comparatif et les graphiques vides sont masqués', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ consent:false });
  try {
    const order = await page.evaluate(() => {
      const form = document.querySelector('.unified-salary-panel');
      const comparison = document.querySelector('#comparePanel');
      return form.compareDocumentPosition(comparison) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    assert.ok(order, 'le formulaire de saisie doit précéder le graphique de répartition');
    assert.equal(await page.locator('#comparePanel').isVisible(), false, 'ne pas afficher un panneau de résultats vide');
  } finally {
    await context.close();
  }
});

test('les valeurs principales se modifient dans le formulaire unique en haut de page', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    const card = page.locator('#cardsBody [data-card]').first();
    assert.equal(await card.locator('[data-key="brut"]').count(), 0, 'pas de second champ de salaire dans la fiche détaillée');
    assert.equal(await card.locator('[data-duree]').count(), 0, 'pas de second réglage horaire dans la fiche détaillée');
    assert.match(await card.locator('.scenario-edit-hint').innerText(), /Votre situation/);
    assert.equal(await page.locator('#mainSalaryHours').count(), 1, 'un seul réglage horaire principal');
  } finally {
    await context.close();
  }
});


test('le bouton principal informe explicitement de la transmission des données à l’Urssaf', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ consent:false });
  try {
    assert.equal(await page.locator('#updateDeclaredSalary').count(), 0);
    assert.equal(await page.locator('#updateDeclaredSalary').count(), 0, 'aucun bouton de calcul ne doit être affiché');
    assert.equal(await page.locator('#urssafCalculateBtn').count(), 0);
    assert.match(await page.locator('#urssafStatusText').innerText(), /Renseignez votre salaire pour autoriser sa transmission/);
  } finally {
    await context.close();
  }
});



test('les fiches de salaire et leurs contrôles restent visibles sans action préalable', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    assert.equal(await page.locator('.cards-bar').isVisible(), true);
    assert.equal(await page.locator('#cardsScroll').isVisible(), true);
    assert.equal(await page.locator('#amtToggle').isVisible(), true);
    assert.equal(await page.locator('#periodToggle').isVisible(), true);
    const card = page.locator('#cardsBody [data-card]').first();
    assert.equal(await card.isVisible(), true);
    await card.locator('details.more > summary').click();
    assert.equal(await card.locator('details.more').evaluate(el => el.open), true);
    assert.equal(await card.locator('[data-key="brut"]').count(), 0, 'le salaire se modifie uniquement dans le formulaire principal');
    assert.match(await card.locator('.scenario-edit-hint').innerText(), /Votre situation/);
  } finally {
    await context.close();
  }
});


test('l’en-tête respecte la hiérarchie V33 et ses actions restent alignées sur mobile', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    for (const width of [320, 375, 390, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => {
        const top = document.querySelector('.maquette-top');
        const hero = document.querySelector('header.hero');
        const brand = top?.querySelector('.brand');
        const actions = top?.querySelector('.header-actions');        const rect = el => {
          const r = el.getBoundingClientRect();
          return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height };
        };
        return {
          top: rect(top), hero: rect(hero), brand: rect(brand), actions: rect(actions),
          viewport: document.documentElement.clientWidth,
          shield: !!hero.querySelector('.trust-icon svg')
        };
      });
      assert.ok(layout.top.bottom <= layout.hero.top, `la marque doit précéder le hero à ${width}px`);
      assert.ok(layout.brand.right <= layout.actions.left + 1, `la marque et les actions se chevauchent à ${width}px : ${JSON.stringify(layout)}`);
      assert.ok(layout.actions.right <= layout.viewport + 1, `les actions sortent de l’écran à ${width}px`);
      assert.ok(layout.shield, 'le pictogramme de confiance V33 doit être conservé');
    }
  } finally {
    await context.close();
  }
});

test('capture visuelle desktop et mobile du parcours V33', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ advancedOpen:false });
  try {
    const output = path.join(__dirname, '..', 'artifacts', 'visual');
    fs.mkdirSync(output, { recursive:true });
    await page.emulateMedia({ reducedMotion:'reduce' });
    assert.equal(await page.locator('#advancedWorkspace').evaluate(el => el.open), false,
      'les outils secondaires doivent rester repliés dans le parcours initial');
    const initialVisualState = await page.evaluate(() => {
      const panel = document.getElementById('comparePanel');
      const chart = document.getElementById('stackChart');
      const scroll = chart?.parentElement;
      return {
        status: document.getElementById('urssafStatusText')?.textContent?.trim(),
        panelHidden: panel?.hidden,
        chartChildren: chart?.children.length,
        chartHtmlLength: chart?.innerHTML.length,
        chartParentHidden: scroll?.hidden,
        chartParentDisplay: scroll ? getComputedStyle(scroll).display : null,
        smicCard: document.querySelector('#benchmarkMount .benchmark-item')?.innerText,
        salaryCardStates: [...document.querySelectorAll('#cardsBody [data-card]')].map(el => el.dataset.resultState)
      };
    });
    console.log('ONNET_VISUAL_STATE=' + JSON.stringify(initialVisualState));

    // Aligner la capture sur les données d'exemple de la maquette V33.
    await page.locator('#mainSalaryGross').fill('2500');
    
    await page.waitForFunction(() =>
      (document.getElementById('urssafStatusText')?.textContent || '').includes('Calculs à jour') &&
      document.getElementById('mainSalaryGross')?.value === '2500',
      null, { timeout:20000 });
    await page.locator('#mainSalaryGross').blur();
    await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));

    await page.setViewportSize({ width:1440, height:1000 });
    const formLayout = await page.evaluate(() => {
      const rect = selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { left:r.left, top:r.top, width:r.width, right:r.right };
      };
      return {
        period:rect('#mainSalaryPeriod'),
        gross:rect('#mainSalaryGross'),
        hours:rect('#mainSalaryHours'),
        mutuelle:rect('.declaration-mutuelle'),
        fields:rect('.declaration-fields')
      };
    });
    assert.ok(formLayout.gross.top > formLayout.period.top,
      'les champs de saisie restent empilés comme dans la V33');
    assert.ok(formLayout.hours.top > formLayout.gross.top,
      'la base horaire suit le salaire brut');
    assert.ok(formLayout.mutuelle.top > formLayout.hours.top,
      'la note Mutuelle suit les champs de saisie');
    assert.ok(Math.abs(formLayout.period.width - formLayout.fields.width) < 2,
      'les champs occupent toute la largeur du formulaire');
    assert.ok(Math.abs(formLayout.mutuelle.width - formLayout.fields.width) < 2,
      'la note Mutuelle occupe toute la largeur du formulaire');
    await page.screenshot({ path:path.join(output, 'onnet-desktop.png'), fullPage:true });
    await page.setViewportSize({ width:390, height:844 });
    await page.screenshot({ path:path.join(output, 'onnet-mobile.png'), fullPage:true });
    const finalVisualState = await page.evaluate(() => {
      const chart = document.getElementById('stackChart');
      return {
        status: document.getElementById('urssafStatusText')?.textContent?.trim(),
        chartChildren: chart?.children.length,
        chartParentHidden: chart?.parentElement?.hidden,
        chartText: chart?.innerText?.slice(0,300)
      };
    });
    console.log('ONNET_FINAL_VISUAL_STATE=' + JSON.stringify(finalVisualState));
    assert.ok(finalVisualState.chartChildren > 0 && finalVisualState.chartParentHidden === false,
      'le graphique de répartition doit être rendu après consentement : ' + JSON.stringify(finalVisualState));
    assert.equal(await page.locator('#stackChart .wf-stack').count(), 1,
      'un seul scénario doit afficher la barre horizontale compacte de la maquette V33');
    assert.equal(await page.locator('#stackChart .wf-breakdown-item').count(), 2);
    assert.match(await page.locator('#stackChart').innerText(), /Net avant impôt[\s\S]*Retenues sur le brut/);
    assert.match(await page.locator('#stackHint').innerText(), /Salaire brut de .* par mois/);

  } finally {
    await context.close();
  }
});


test('le graphique comparatif et sa légende apparaissent après les calculs API', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ advancedOpen:false });
  try {
    await addSecondScenario(page, '3200');
    await page.waitForFunction(() => {
      const chart = document.getElementById('stackChart');
      const legend = document.getElementById('stackLegend');
      const cards = [...document.querySelectorAll('#cardsBody [data-card]')];
      return (document.getElementById('urssafStatusText')?.textContent || '').includes('Calculs à jour') &&
        cards.length === 2 && cards.every(card => card.dataset.resultState === 'ready') &&
        chart?.children.length === 2 && chart.parentElement?.hidden === false &&
        legend?.hidden === false && legend.children.length === 4;
    }, null, { timeout:20000 });
    assert.equal(await page.locator('#stackHint').innerText(), 'Cliquez sur une carte pour la définir comme référence.');
  } finally {
    await context.close();
  }
});

test('la maquette V33 conserve deux repères côte à côte sur mobile et relie le formulaire au scénario', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForSelector('#benchmarkMount .benchmark-grid');
    const columns = await page.locator('#benchmarkMount .benchmark-grid').evaluate(el =>
      getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length
    );
    assert.equal(columns, 2, 'les cartes SMIC et médiane restent côte à côte sur mobile');
    assert.match(await page.locator('#benchmarkMount').innerText(), /Zone\s+France/);
    await page.locator('#mainSalaryGross').fill('3000');
    await page.locator('#mainSalaryHours').selectOption('35');
    await page.waitForFunction(() =>
      JSON.parse(localStorage.getItem('onnet.state.v1') || 'null')?.scenarios?.[0]?.brut === 3000
    );
    const savedGross = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')).scenarios[0].brut);
    assert.equal(savedGross, 3000, 'la saisie doit enregistrer le brut dans le scénario');
    assert.equal(await page.locator('#mainSalaryGross').inputValue(), '3000');
    assert.equal(await page.locator('#mainSalaryHours').inputValue(), '35');
    const card = page.locator('#cardsBody [data-card]').first();
    assert.equal(await card.locator('[data-key="brut"]').count(), 0);
    assert.equal(await card.locator('[data-duree]').count(), 0);
  } finally {
    await context.close();
  }
});

test('le repère SMIC suit la durée de l’offre de référence et applique la majoration à 39 h', { timeout: 60000 }, async () => {
  const { context, page, calls } = await openApp();
  try {
    const overtimeKey = 'salarié . temps de travail . heures supplémentaires';
    const baseGrossKey = 'salarié . contrat . salaire brut';
    const benchmarkRequests = () => calls.bodies.filter(request =>
      Array.isArray(request.expressions) &&
      request.expressions.length === 2 &&
      request.expressions.includes('salarié . rémunération . brut') &&
      request.expressions.includes('salarié . rémunération . net . à payer avant impôt')
    );
    const waitForBenchmarkRequest = async predicate => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const found = benchmarkRequests().filter(predicate).at(-1);
        const status = await page.locator('#urssafStatusText').textContent() || '';
        const smicValue = await page.locator('#benchmarkBody .benchmark-value').first().textContent() || '';
        if (found && status.includes('Calculs à jour') && smicValue !== 'À calculer') return found;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail('Le calcul du repère SMIC attendu n’a pas été envoyé ou terminé via l’API.');
    };

    const smic39 = await waitForBenchmarkRequest(request =>
      Number.parseFloat(request.situation[overtimeKey]) > 17
    );
    const smicBase39 = Number.parseFloat(smic39.situation[baseGrossKey]);
    const smicOvertime39 = Number.parseFloat(smic39.situation[overtimeKey]);
    const smicGross39 = smicBase39 * (151.67 + smicOvertime39 * 1.25) / 151.67;
    const expectedSmicGross39 = 1867.02 * (151.67 + smicOvertime39 * 1.25) / 151.67;
    assert.ok(Math.abs(smicBase39 - 1867.02) < 0.02,
      'la base 35 h doit rester égale au SMIC officiel');
    assert.ok(Math.abs(smicGross39 - expectedSmicGross39) < 0.03,
      'le brut total 39 h doit intégrer les 4 heures supplémentaires majorées ; données : ' + JSON.stringify(smic39.situation));

    await page.locator('#benchmarkBody .benchmark-details summary').first().click();
    assert.match(await page.locator('#benchmarkBody .benchmark-details').first().innerText(),
      /35 h au SMIC \+ 4 h supplémentaires hebdomadaires majorées à 25 %/);

    await addSecondScenario(page, '3200');
    await page.locator('#maquetteOfferTabs button').nth(1).click();
    await page.locator('#mainSalaryHours').selectOption('35');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#cardsBody [data-card]')].length === 2 &&
      [...document.querySelectorAll('#cardsBody [data-card]')].every(card => card.dataset.resultState === 'ready') &&
      document.querySelector('#benchmarkBody .benchmark-meta')?.textContent.includes('repère 35 h'),
      null, { timeout: 20000 }
    );

    const smic35 = await waitForBenchmarkRequest(request =>
      Math.abs(Number.parseFloat(request.situation[overtimeKey] || '0')) < 0.001
    );
    assert.ok(Math.abs(Number.parseFloat(smic35.situation[baseGrossKey]) - 1867.02) < 0.02,
      'le repère 35 h doit rester égal au SMIC brut officiel sans heures supplémentaires');
    await page.waitForFunction(() =>
      document.querySelector('#benchmarkBody .benchmark-meta')?.textContent.includes('repère 35 h')
    );
    assert.match(await page.locator('#benchmarkBody').innerText(), /repère 35 h/);
  } finally {
    await context.close();
  }
});