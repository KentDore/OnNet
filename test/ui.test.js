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
  const overtimePay = (baseGross / 151.67) * overtimeHours * 1.25;

  const values = {
    'salarié . rémunération . brut': gross,
    'salarié . rémunération . net . à payer avant impôt': netBeforeTax,
    'salarié . cotisations . salarié': employeeContributions,
    'salarié . rémunération . heures supplémentaires': overtimePay,
    'salarié . cotisations . prévoyances . santé . salarié': employeeHealth,
    'salarié . cotisations . prévoyances . santé . employeur': employerHealth,
    'salarié . rémunération . frais professionnels . titres-restaurant . montant': ticketCount * ticketValue,
    'salarié . rémunération . frais professionnels . titres-restaurant . employeur': mealTicketEmployer,
    'salarié . rémunération . frais professionnels . non déductible': 0,
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
  const salaryDetailsHidden = await page.locator('#legacySalaryCards').evaluate(el => el.hidden);
  if (!salaryDetailsHidden) {
    await context.close();
    throw new Error('Les fiches détaillées doivent rester masquées dans le parcours normal.');
  }
  // Les tests fonctionnels ouvrent les anciennes fiches uniquement lorsqu'ils
  // vérifient leur compatibilité ; aucun réglage fiscal n'existe désormais.
  await page.locator('#legacySalaryCards').evaluate(el => { el.hidden = false; });
  if (options.advancedOpen !== false && !options.emptyStorage) {
    await page.locator('#advancedWorkspace').evaluate(el => { el.open = true; });
    if (options.legacyCardsOpen !== false) {
      await page.locator('#legacySalaryCards').evaluate(el => { el.open = true; });
    }
  }
  if (pageErrors.length) {
    await context.close();
    throw new Error('Erreur JavaScript au chargement :\n' + pageErrors.join('\n'));
  }

  if (options.consent !== false && !options.emptyStorage) {
    // Le salaire principal se modifie désormais dans l'éditeur dédié.
    await page.locator('#maquetteYourSalary [data-edit-offer]').first().click();
    await page.locator('#mainSalaryGross').fill('2300');
    await page.waitForFunction(() => {
      const status = document.getElementById('urssafStatusText')?.textContent || '';
      const cards = [...document.querySelectorAll('#cardsBody [data-card]')];
      return status.includes('Calculs à jour') &&
        cards.length > 0 && cards.every(card => card.dataset.resultState === 'ready') &&
        document.querySelectorAll('.benchmark-item').length === 2;
    }, null, { timeout: 20000 });
    await page.locator('#salaryEditorBack').click();
  }

  return { context, page, calls };
}

async function openSalaryEditor(page, index = 0) {
  const field = page.locator('#mainSalaryGross');
  if (!(await field.isVisible())) {
    await page.locator('#maquetteYourSalary [data-edit-offer]').nth(index).click();
  }
  await field.waitFor({ state: 'visible' });
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

    await openSalaryEditor(page);
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
    const styleSignature = selector => page.locator(selector).evaluate(el => {
      const style = getComputedStyle(el);
      return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderRadius: style.borderRadius,
        height: Math.round(el.getBoundingClientRect().height)
      };
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    const desktopShareStyle = await styleSignature('#shareBtn');
    const desktopMenuStyle = await styleSignature('#headerMenu summary');
    assert.deepEqual(desktopShareStyle, desktopMenuStyle,
      'sur desktop, les actions d’en-tête partagent couleur, fond, bordure, rayon et hauteur');
    assert.equal(desktopShareStyle.borderRadius, '12px');

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('#shareBtn').isVisible(), true);
    assert.equal(await page.locator('#headerMenu').count(), 1);
    const mobileShareStyle = await styleSignature('#shareBtn');
    const mobileMenuStyle = await styleSignature('#headerMenu summary');
    assert.deepEqual(mobileShareStyle, mobileMenuStyle,
      'sur mobile, les actions d’en-tête partagent couleur, fond, bordure, rayon et hauteur');
    assert.equal(mobileShareStyle.borderRadius, '11px');
    const viewportContent = await page.locator('meta[name="viewport"]').getAttribute('content');
    assert.doesNotMatch(viewportContent || '', /maximum-scale\s*=\s*1|user-scalable\s*=\s*no/i,
      'le zoom tactile reste disponible pour les utilisateurs');
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
    assert.match(await page.locator('.comparison-subhead').innerText(), /Comparer vos offres/);
    assert.match(await page.locator('.comparison-period').innerText(), /Heure/);
    const sectionOrder = await page.locator('.unified-salary-panel').evaluate(panel => {
      const position = selector => [...panel.children].findIndex(node => node.matches(selector));
      return {
        comparison: position('.comparison-subhead'),
        salarySituation: position('.declaration-inline')
      };
    });
    assert.ok(sectionOrder.comparison >= 0 && sectionOrder.comparison < sectionOrder.salarySituation,
      'le comparatif complet doit précéder le formulaire Votre situation');
    const medianMethod = await page.locator('#benchmarkBody .benchmark-details').nth(1).textContent();
    assert.match(medianMethod, /2\s?238/);
    assert.match(medianMethod, /Données INSEE 2025, publiées en 2026/);
    assert.doesNotMatch(medianMethod, /2\s?190|INSEE 2024/);
    assert.equal(await page.locator('.declaration-inline').isVisible(), false, 'le formulaire ne doit pas doubler le comparatif sur la page principale');
    const cardNet = await page.locator('#cardsBody .hero-value').first().innerText();
    const benchmarkHourlyNet = await page.locator('#maquetteYourSalary .offer-comparison-net').first().innerText();
    const parseEuro = value => Number(value.replace(/[^\d,.-]/g, '').replace(',', '.'));
    assert.equal(await page.locator('#cardsBody .hero-label').first().innerText(), 'Net mensuel');
    assert.equal(await page.locator('#cardsBody .hero-pas').count(), 0,
      'les fiches ne doivent pas afficher de ligne fiscale');
    assert.ok(parseEuro(cardNet) > 0, 'la valeur principale doit afficher le net calculé par l’API');
    assert.ok(Math.abs(parseEuro(benchmarkHourlyNet) - parseEuro(cardNet) / 169) < 0.02,
      'le taux horaire doit refléter le net bancaire réellement versé, divisé par les 169 h du contrat 39 h');
    assert.equal(await page.locator('#moreMetrics').count(), 0,
      'les indicateurs secondaires ne doivent plus encombrer les résultats');
    assert.equal(await page.locator('.metric-toggle').count(), 0,
      'les boutons d’indicateurs secondaires ne doivent plus être présents');
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
    await openSalaryEditor(page);
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
    await openSalaryEditor(page);
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
    await openSalaryEditor(page);
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
    await openSalaryEditor(page);
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

    await openSalaryEditor(page);
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
    assert.equal(Object.hasOwn(payload, 'foyer'), false);

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

test('la part salariale des titres-restaurant est bornée à 40–50 %', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    const card = page.locator('#cardsBody [data-card]').first();
    await card.locator('details.more summary').click();
    const part = card.locator('[data-key="partResto"]');
    assert.equal(await part.getAttribute('data-min'), '40');
    assert.equal(await part.getAttribute('data-max'), '50');
    const waterfallRows = await page.locator('.waterfall .salary-net-summary-row').allTextContents();

    assert.equal(waterfallRows.length, 3, 'le récapitulatif affiche trois valeurs lorsque les TR sont activés');
    assert.match(waterfallRows[0], /Net sans TR/);
    assert.match(waterfallRows[1], /TR — total des deux parts[\s\S]*168 €/);
    assert.match(waterfallRows[2], /Net avec TR/);
    assert.equal(await page.locator('.waterfall .salary-net-summary-row').nth(1).locator('strong').innerText(), '168 €',
      'le total des TR doit rester juste même si l’API omet l’une des parts');
    await addSecondScenario(page);
    const stackSummary = page.locator('#stackChart .stack-col .salary-net-summary')
      .filter({ hasText:'TR — total des deux parts' }).first();
    assert.equal(await stackSummary.count(), 1, 'le scénario conservant les TR doit avoir son récapitulatif');
    const stackRows = await stackSummary.locator('.salary-net-summary-row').allTextContents();
    assert.equal(stackRows.length, 3);
    assert.match(stackRows[0], /Net sans TR/);
    assert.match(stackRows[1], /TR — total des deux parts[\s\S]*168 €/);
    assert.match(stackRows[2], /Net avec TR/);
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
    await advanced.locator('summary').first().click();
    assert.equal(await page.locator('#cardsScroll').isVisible(), false);
    // openApp vérifie avant chaque test que les fiches et réglages fiscaux
    // portent bien l'attribut hidden, puis les démasque pour les tests legacy.
    assert.equal(await page.locator('#raiseModuleToggle').isVisible(), true);
  } finally {
    await context.close();
  }
});

test('une offre ouvre un écran de modification dédié', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ consent:false });
  try {
    await page.locator('#maquetteYourSalary [data-edit-offer]').first().click();
    assert.equal(await page.locator('.declaration-inline').isVisible(), true);
    assert.equal(await page.locator('#salaryEditorTitle').innerText(), 'Modifier — Poste actuel');
    await page.locator('#salaryEditorBack').click();
    assert.equal(await page.locator('.declaration-inline').isVisible(), false);
  } finally {
    await context.close();
  }
});

test('les actions et les barres restent cohérentes avec plusieurs postes sur mobile', { timeout: 90000 }, async () => {
  const { context, page } = await openApp();
  try {
    await addSecondScenario(page, '3400');

    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      const layout = await page.locator('#stackChart').evaluate(el => {
        const stages = [...el.querySelectorAll('.stack-bar-stage')].map(node => {
          const rect = node.getBoundingClientRect();
          return { left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width };
        });
        const actions = [...document.querySelectorAll('#maquetteOfferTabs .offer-tab-item')].map(item => {
          const button = item.querySelector('.offer-tab-action');
          const rect = button.getBoundingClientRect();
          return { label: button.textContent.trim(), visible: rect.width > 0 && rect.height > 0 };
        });
        return { stages, actions, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      });
      assert.equal(layout.stages.length, 2);
      assert.ok(Math.abs(layout.stages[0].bottom - layout.stages[1].bottom) <= 1,
        `les barres doivent partager la même ligne de base à ${width}px : ${JSON.stringify(layout.stages)}`);
      assert.ok(layout.stages.every(stage => stage.width > 0));
      assert.ok(await page.locator('#maquetteYourSalary .offer-comparison-card').count() === 2);
      assert.ok(layout.scrollWidth <= layout.clientWidth + 1,
        `le graphique déborde à ${width}px : ${JSON.stringify(layout)}`);
    }

    const secondName = await page.locator('#maquetteYourSalary [data-rename-offer]').nth(1).inputValue();
    // L'ajout d'une offre peut ouvrir son éditeur : revenir au comparatif
    // avant d'utiliser l'action de suppression qui n'existe que sur les cartes.
    if (await page.locator('#salaryEditorBack').isVisible()) {
      await page.locator('#salaryEditorBack').click();
    }
    await page.locator('#maquetteYourSalary .offer-comparison-remove').last().click();
    await page.locator('#modalOverlay [data-modal-confirm]').click();
    await page.waitForFunction(() =>
      document.querySelectorAll('#maquetteOfferTabs .offer-tab-item').length === 1 &&
      document.querySelectorAll('#cardsBody [data-result-state="ready"]').length === 1,
      null, { timeout: 15000 }
    );
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
      assert.ok(sizes.cards.every(card => card > 0 && Math.abs(card - sizes.panel) <= 1),
        `les repères doivent occuper la largeur disponible en une colonne à ${width}px : ${JSON.stringify(sizes)}`);
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

test('la première fenêtre tient sans défilement sur mobile, même avec les champs titres-restaurant ouverts', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ emptyStorage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    const modal = page.locator('#modalBox');
    await page.locator('#modalOnboardingTrToggle [data-tr="oui"]').click();
    const dimensions = await modal.evaluate(el => ({ clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, overflowY: getComputedStyle(el).overflowY }));
    assert.equal(dimensions.overflowY, 'hidden', 'la première modale ne doit pas être une zone défilante');
    assert.ok(dimensions.scrollHeight <= dimensions.clientHeight, `le contenu doit tenir sans défilement : ${JSON.stringify(dimensions)}`);
    assert.equal(await page.locator('#modalOnboardingSubmit').isVisible(), true);
  } finally { await context.close(); }
});

test('l’onboarding garde les paramètres secondaires repliés et n’affiche que la part salarié', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ emptyStorage: true });
  try {
    const modal = page.locator('#modalOverlay');
    await modal.waitFor({ state: 'visible' });
    assert.equal(await modal.locator('.onboarding-tr-fields').isVisible(), false);
    assert.equal(await modal.locator('#modalOnboardingTrToggle').isVisible(), true);
    await modal.locator('#modalOnboardingTrToggle').click();
    assert.equal(await modal.locator('.onboarding-tr-fields').isVisible(), true);
    assert.equal(await modal.locator('.onboarding-tr-fields .sub-hint').count(), 0,
      'aucune aide technique redondante ne doit apparaître sous les champs titres-restaurant');
    assert.equal(await modal.locator('.onboarding-tr-optional').count(), 0,
      'aucune mention facultatif ne doit apparaître à côté des titres-restaurant');
    assert.equal(await modal.locator('.onboarding-mutuelle-label').evaluate(el => getComputedStyle(el).fontWeight), '650',
      'le libellé Mutuelle doit avoir le même niveau de graisse que Titres-restaurant');
    assert.equal(await modal.locator('.onboarding-mutuelle-label').evaluate(el => getComputedStyle(el).fontSize), '12.5px');
    assert.equal(await modal.locator('.onboarding-tr-heading strong').evaluate(el => getComputedStyle(el).fontSize), '12.5px',
      'Titres-restaurant doit conserver la même taille que Mutuelle sur desktop');
    await page.setViewportSize({ width:390, height:844 });
    assert.equal(await modal.locator('.onboarding-mutuelle-label').evaluate(el => getComputedStyle(el).fontSize), '12.5px');
    assert.equal(await modal.locator('.onboarding-tr-heading strong').evaluate(el => getComputedStyle(el).fontSize), '12.5px',
      'les deux libellés doivent conserver 12,5 px sur mobile');
    assert.equal(await modal.locator('#modalOnboardingMutuelle').count(), 0);
    assert.equal(await modal.locator('#modalOnboardingMutuellePat').count(), 0);
    assert.ok((await modal.locator('.onboarding-mutuelle-note').innerText()).includes('30 € salarié'));
    await page.setViewportSize({ width:390, height:844 });
    const mutuelleLayout = await modal.locator('.onboarding-mutuelle-note').evaluate(el => {
      const rect = selector => {
        const box = el.querySelector(selector).getBoundingClientRect();
        return { left:box.left, right:box.right };
      };
      const note = el.getBoundingClientRect();
      return {
        note:{ left:note.left, right:note.right },
        icon:rect('.onboarding-mutuelle-icon'),
        label:rect('.onboarding-mutuelle-label'),
        amount:rect('strong:not(.onboarding-mutuelle-label)')
      };
    });
    assert.ok(mutuelleLayout.label.left <= mutuelleLayout.icon.right + 16,
      'le libellé Mutuelle doit suivre immédiatement son icône, sans centrage');
    assert.ok(mutuelleLayout.amount.left > mutuelleLayout.label.right,
      'le montant doit rester à droite du libellé');
    assert.ok(mutuelleLayout.note.right - mutuelleLayout.amount.right <= 16,
      'le montant doit rester aligné à droite de la ligne');
    assert.equal(await modal.locator('#modalOnboarding39Hint').count(), 0,
      'aucun paragraphe explicatif sur les 39 h ne doit encombrer la fenêtre');
    await modal.locator('#modalOnboardingDuree [data-duree="39"]').click();
    await modal.locator('#modalOnboardingDuree [data-duree="35"]').click();
    const modalBeforeTrToggle = await modal.evaluate(el => el.scrollTop);
    await modal.locator('#modalOnboardingTrToggle').click();
    await page.waitForTimeout(100);
    assert.equal(await modal.evaluate(el => el.scrollTop), modalBeforeTrToggle,
      'activer les titres-restaurant ne doit pas déplacer automatiquement la fenêtre');
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
    await openSalaryEditor(page);
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

    await openSalaryEditor(page);
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


test('préremplit l’hypothèse 39 h sans texte explicatif dans l’ajout de salaire', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    await page.locator('#addScenario').click();
    assert.equal(await page.locator('#modalAdd39Hint').count(), 0,
      'aucun paragraphe explicatif sur les 39 h ne doit être affiché');
    assert.equal(await page.locator('#modalAddDuree [data-duree="39"]').getAttribute('aria-pressed'), 'true');
    await page.locator('#modalAddDuree [data-duree="35"]').click();
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
    await page.locator('#modalAddCancel').click();
  } finally {
    await context.close();
  }
});


test('le graphique présente le net sans module fiscal', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    await page.waitForSelector('#comparePanel #stackChart');
    assert.equal((await page.locator('#comparePanel > h2').innerText()).trim().replace(/\s+/g, ' '), 'Où part votre salaire ?');
    assert.equal((await page.locator('#comparePanel > .sub').innerText()).trim(), 'Du brut au net.');
    assert.equal(await page.locator('#comparePanel .chart-scope-hint').count(), 0, 'la mention redondante sur la source des montants doit être absente');
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
    assert.equal(await card.locator('.hero-label').innerText(), 'Net annuel');
    await page.locator('#periodToggle [data-period="mois"]').click();
    assert.equal(await card.locator('.hero-label').innerText(), 'Net mensuel');
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

test('les valeurs principales se modifient dans un écran dédié à l’offre sélectionnée', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    const card = page.locator('#cardsBody [data-card]').first();
    assert.equal(await card.locator('[data-key="brut"]').count(), 0, 'pas de second champ de salaire dans la fiche détaillée');
    assert.equal(await card.locator('[data-duree]').count(), 0, 'pas de second réglage horaire dans la fiche détaillée');
    assert.match(await card.locator('.scenario-edit-hint').innerText(), /Votre situation/);
    assert.equal(await page.locator('#mainSalaryHours').count(), 1, 'un seul réglage horaire principal');
    assert.equal(await page.locator('.declaration-inline').isVisible(), false, 'le formulaire est masqué dans le comparatif');
    await page.locator('#maquetteYourSalary [data-edit-offer]').first().click();
    assert.equal(await page.locator('.declaration-inline').isVisible(), true, 'le formulaire apparaît après sélection d’une offre');
    const period = page.locator('#mainSalaryPeriod');
    assert.equal(await period.locator('button[data-period]').count(), 2, 'mensuel et annuel utilisent le même sélecteur à boutons');
    assert.equal(await period.locator('[data-period="month"]').getAttribute('aria-pressed'), 'true');
    await period.locator('[data-period="year"]').click();
    assert.equal(await period.locator('[data-period="year"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#moreMetrics').count(), 0, 'les indicateurs secondaires ont été retirés');
    await page.locator('#salaryEditorBack').click();
    assert.equal(await page.locator('.declaration-inline').isVisible(), false, 'le formulaire se replie au retour au comparatif');
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



test('les anciennes fiches sont repliées mais restent accessibles à la demande', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ legacyCardsOpen:false });
  try {
    const legacy = page.locator('#legacySalaryCards');
    assert.equal(await legacy.evaluate(el => el.open), false);
    assert.equal(await page.locator('#cardsScroll').isVisible(), false);
    await legacy.locator(':scope > summary').click();
    assert.equal(await legacy.evaluate(el => el.open), true);
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
    await openSalaryEditor(page);
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

    // Les captures doivent montrer le produit réellement comparatif, pas rester
    // dans l’éditeur de salaire utilisé uniquement pour préparer les données.
    await page.locator('#salaryEditorBack').click();
    await addSecondScenario(page, '3200');
    await page.locator('#salaryEditorBack').click();
    assert.equal(await page.locator('#maquetteYourSalary .offer-comparison-card').count(), 2,
      'les captures présentent deux offres comparables');
    assert.equal(await page.locator('#maquetteYourSalary [data-rename-offer]').count(), 2,
      'les deux offres sont visibles et renommables');

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
    const comparisonColumns = page.locator('#stackChart .stack-col');
    assert.equal(await comparisonColumns.count(), 2,
      'deux offres doivent produire deux colonnes comparatives');
    assert.equal(await page.locator('#stackChart .stack-col .stack-bar').count(), 2,
      'chaque offre doit avoir sa barre de répartition');
    const currentOffer = comparisonColumns.filter({ hasText: 'Poste actuel' });
    const summaryRows = await currentOffer.locator('.salary-net-summary-row').allTextContents();
    assert.equal(summaryRows.length, 3);
    assert.match(summaryRows[0], /Net sans TR/);
    assert.match(summaryRows[1], /TR — total des deux parts/);
    assert.match(summaryRows[2], /Net avec TR/);
    const parseEuro = value => Number(value.replace(/[^0-9]/g, ''));
    const summaryAmounts = await currentOffer.locator('.salary-net-summary-row strong').allTextContents();
    assert.equal(summaryAmounts.length, 3);
    assert.equal(parseEuro(summaryAmounts[1]), 168, 'le total des deux parts doit correspondre à 21 titres de 8 €');
    assert.equal(parseEuro(summaryAmounts[2]) - parseEuro(summaryAmounts[0]), 84, 'le gain de pouvoir d’achat correspond à la part employeur des titres');
    assert.match(await page.locator('#stackHint').innerText(), /définir comme référence/);

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

test('les repères SMIC et médiane sont espacés et lisibles sur mobile, et le formulaire reste relié au scénario', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForSelector('#benchmarkMount .benchmark-grid');
    const columns = await page.locator('#benchmarkMount .benchmark-grid').evaluate(el =>
      getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length
    );
    assert.equal(columns, 1, 'les cartes SMIC et médiane sont empilées sur mobile pour conserver une largeur lisible');
    const geometry = await page.locator('#benchmarkMount .benchmark-grid').evaluate(el => {
      const cards = [...el.querySelectorAll('.benchmark-item')].map(card => {
        const rect = card.getBoundingClientRect();
        return { top:rect.top, bottom:rect.bottom, left:rect.left, right:rect.right };
      });
      return { gap:getComputedStyle(el).rowGap, cards };
    });
    assert.equal(geometry.cards.length, 2);
    assert.ok(geometry.cards[1].top >= geometry.cards[0].bottom + 12,
      'un espace réel sépare les deux repères sur mobile');
    assert.match(await page.locator('#benchmarkMount').innerText(), /Zone\s+France/);
    await openSalaryEditor(page);
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

test('les offres peuvent être renommées et la référence est choisie explicitement', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    await addSecondScenario(page, '3200');
    // L’ajout ouvre l’éditeur de l’offre ; revenir au comparatif avant de tester
    // les contrôles de renommage et de référence qui y sont volontairement masqués.
    await page.locator('#salaryEditorBack').click();
    await page.locator('#maquetteYourSalary [data-rename-offer]').nth(1).click();
    const renameInput = page.locator('#renameOfferInput');
    await renameInput.fill('Proposition Rennes');
    await page.locator('#renameOfferSave').click();
    assert.equal(await page.locator('#maquetteYourSalary .offer-comparison-name').nth(1).innerText(), 'Proposition Rennes');
    let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')));
    assert.equal(saved.scenarios[1].name, 'Proposition Rennes', 'le nom est conservé localement');

    await page.locator('#maquetteYourSalary [data-set-offer-reference]').click();
    assert.equal(await page.locator('#maquetteYourSalary .offer-comparison-card.is-reference').count(), 1);
    assert.equal(await page.locator('#maquetteYourSalary .offer-comparison-card.is-reference .offer-reference-label').innerText(), 'Référence');
    saved = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')));
    assert.equal(saved.refId, saved.scenarios[1].id, 'le choix de référence est conservé localement');
    assert.equal(await page.locator('#maquetteYourSalary [data-set-offer-reference]').count(), 1,
      'seule l’offre non sélectionnée propose de devenir référence');
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
    await openSalaryEditor(page, 1);
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


test('le runtime applicatif est encapsulé sans exposer ses fonctions internes', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ consent: false });
  try {
    const runtime = await page.evaluate(() => ({
      appReady: Boolean(document.getElementById('mainSalaryGross')),
      urssafClientReady: typeof window.OnNetUrssafApi?.calculateWithUrssafApi === 'function',
      rendererExposed: typeof window.renderCard !== 'undefined',
      utilityExposed: typeof window.parseNum !== 'undefined',
      normalizerExposed: typeof window.sanitizeScenario !== 'undefined'
    }));
    assert.equal(runtime.appReady, true);
    assert.equal(runtime.urssafClientReady, true);
    assert.equal(runtime.rendererExposed, false,
      'les fonctions internes ne doivent plus polluer l’objet window');
    assert.equal(runtime.utilityExposed, false,
      'les utilitaires importés doivent rester privés au module runtime');
    assert.equal(runtime.normalizerExposed, false,
      'les normalisateurs importés doivent rester privés au module runtime');
  } finally {
    await context.close();
  }
});
