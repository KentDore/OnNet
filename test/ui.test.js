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
  const context = await browser.newContext(options.touch
    ? { hasTouch:true, isMobile:true, viewport:{ width:390, height:844 } }
    : {});
  if(options.mockVibrate){
    await context.addInitScript(() => {
      window.__onnetVibrations = [];
      Object.defineProperty(navigator, 'vibrate', {
        configurable:true,
        value:pattern => { window.__onnetVibrations.push(pattern); return true; }
      });
    });
  }
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
    // Une validation explicite dans la fenêtre d'édition accorde le consentement Urssaf.
    await page.locator('#maquetteYourSalary [data-edit-offer]').first().click();
    await page.locator('#editOfferSave').click();
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

async function openSalaryEditor(page, index = 0) {
  const field = page.locator('#editOfferGross');
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
      document.querySelectorAll('#stackChart .comparison-offer-card').length === 2;
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
    assert.match(await page.locator('#urssafStatusText').innerText(), /Vos offres sont conservées/);
    assert.equal(await page.locator('#urssafRememberConsent').count(), 0,
      'le choix de consentement ne doit plus être mémorisé par une case à cocher');
    assert.equal(await page.locator('.urssaf-data-details').count(), 0, 'le panneau de consentement redondant doit rester supprimé');
    assert.equal(await page.locator('.declaration-api-notice').count(), 0, 'aucun pavé de consentement redondant ne doit être affiché');
    assert.equal(await page.locator('.urssaf-status-main').count(), 0);
    assert.equal(await page.locator('#updateDeclaredSalary').count(), 0);

    await openSalaryEditor(page);
    await page.locator('#editOfferGross').fill('2300');
    await page.locator('#editOfferSave').click();
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
    assert.match(viewportContent || '', /width\s*=\s*device-width/i,
      'la mise en page doit suivre la largeur réelle de l’écran mobile');
    assert.match(viewportContent || '', /initial-scale\s*=\s*1(?:\.0)?/i,
      'la page doit démarrer à son échelle normale');
    assert.doesNotMatch(viewportContent || '', /maximum-scale\s*=\s*1|user-scalable\s*=\s*no/i,
      'le navigateur doit conserver le zoom tactile pour l’accessibilité mobile');
    const mobileFieldFontSizes = await page.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea').evaluateAll(elements =>
      elements.map(element => ({
        field: element.tagName.toLowerCase() + (element.id ? '#' + element.id : ''),
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize)
      }))
    );
    assert.ok(mobileFieldFontSizes.length > 0, 'les champs mobiles doivent être présents');
    assert.ok(mobileFieldFontSizes.every(field => field.fontSize >= 16),
      'les champs mobiles doivent rester à 16 px minimum pour éviter le zoom automatique au focus sur iOS : ' + JSON.stringify(mobileFieldFontSizes));
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

test('conserve l’autorisation Urssaf et les offres après rechargement sans réinitialisation', { timeout:60000 }, async () => {
  const { context, page, calls } = await openApp({ consent:false });
  try {
    const salaryRequests = () => calls.bodies.filter(body =>
      body.expressions.includes('salarié . rémunération . brut')
    ).length;
    const original = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')));
    assert.ok(original?.scenarios?.length, 'les offres existantes doivent être restaurées');
    assert.equal(await page.locator('#urssafConsentGrant').isVisible(), true,
      'une autorisation absente doit être demandée sans effacer les offres');
    assert.equal(salaryRequests(), 0,
      'aucun salaire ne doit être transmis avant l’autorisation explicite');

    await page.locator('#urssafConsentGrant').click();
    await page.waitForFunction(() => {
      const cards = [...document.querySelectorAll('#cardsBody [data-card]')];
      return document.getElementById('urssafStatusText')?.textContent.includes('Calculs à jour') &&
        cards.length > 0 && cards.every(card => card.dataset.resultState === 'ready');
    }, null, { timeout:20000 });
    assert.ok(salaryRequests() > 0, 'le calcul démarre après autorisation explicite');
    assert.equal(await page.evaluate(() => localStorage.getItem('onnet.urssaf.consent.v1')), 'granted');

    await page.reload();
    await page.waitForFunction(() => {
      const cards = [...document.querySelectorAll('#cardsBody [data-card]')];
      return document.getElementById('urssafStatusText')?.textContent.includes('Calculs à jour') &&
        cards.length > 0 && cards.every(card => card.dataset.resultState === 'ready');
    }, null, { timeout:20000 });
    assert.equal(await page.locator('#urssafConsentGrant').isVisible(), false,
      'l’autorisation enregistrée doit être restaurée après actualisation');
    assert.equal(await page.locator('#urssafConsentRevoke').isVisible(), true);
    const afterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')));
    assert.deepEqual(afterReload.scenarios.map(s => ({name:s.name,brut:s.brut,dureeType:s.dureeType})),
      original.scenarios.map(s => ({name:s.name,brut:s.brut,dureeType:s.dureeType})),
      'les offres sont conservées à l’identique');

    await page.locator('#urssafConsentRevoke').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('onnet.urssaf.consent.v1')), null,
      'le retrait doit supprimer uniquement l’autorisation');
    assert.equal(await page.locator('#urssafConsentGrant').isVisible(), true);
    const afterRevoke = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')));
    assert.deepEqual(afterRevoke.scenarios.map(s => s.name), original.scenarios.map(s => s.name),
      'retirer l’autorisation ne doit pas effacer les offres');
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
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')).scenarios[0].dureeType), '39',
      'le contrat de référence doit conserver la durée 39 h');
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
    assert.match(await page.locator('.comparison-subhead').innerText(), /Vos offres/);
    assert.match(await page.locator('.comparison-period').innerText(), /Mois/i,
      'la comparaison doit être mensuelle par défaut');
    assert.equal(await page.locator('.declaration-inline').count(), 0,
      'l’éditeur flottant remplace le formulaire intégré à la page');
    const medianMethod = await page.locator('#benchmarkBody .benchmark-details').nth(1).textContent();
    assert.match(medianMethod, /2\s?238/);
    assert.match(medianMethod, /Données INSEE 2025, publiées en 2026/);
    assert.doesNotMatch(medianMethod, /2\s?190|INSEE 2024/);
    assert.equal(await page.locator('.declaration-inline').count(), 0, 'aucun formulaire intégré ne doit doubler le comparatif');
    const cardNet = await page.locator('#cardsBody .hero-value').first().innerText();
    const benchmarkHourlyNet = await page.locator('#stackChart .comparison-offer-value').first().innerText();
    const parseEuro = value => Number(value.replace(/[^\d,.-]/g, '').replace(',', '.'));
    assert.equal(await page.locator('#cardsBody .hero-label').first().innerText(), 'Net mensuel');
    assert.equal(await page.locator('#cardsBody .hero-pas').count(), 0,
      'les fiches ne doivent pas afficher de ligne fiscale');
    assert.ok(parseEuro(cardNet) > 0, 'la valeur principale doit afficher le net calculé par l’API');
    assert.ok(Math.abs(parseEuro(benchmarkHourlyNet) - parseEuro(cardNet)) < 0.02,
      'la valeur du comparatif mensuel doit correspondre au net bancaire mensuel de la fiche');
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
    await page.locator('#editOfferGross').fill('2300');
    await page.locator('#editOfferSave').click();
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

test('refuse le repère SMIC quand l’API signale une EngineError malgré une valeur numérique', { timeout: 60000 }, async () => {
  const { context, page, calls } = await openApp({
    consent:false,
    warnings:['[EngineError] comparaison impossible entre unités']
  });
  try {
    await page.locator('#urssafConsentGrant').click();
    await page.waitForFunction(() =>
      (document.getElementById('urssafStatusText')?.textContent || '').includes('Le calcul n’a pas abouti'),
      null, { timeout:15000 }
    );
    const smicRequests = calls.bodies.filter(body => body.expressions.includes('SMIC'));
    assert.ok(smicRequests.length > 0, 'la règle officielle SMIC doit avoir été interrogée');
    assert.ok(smicRequests.every(body =>
      body.expressions.length === 1 && body.expressions[0] === 'SMIC'
    ), 'les requêtes de référence ne doivent pas embarquer de données salariales');
    const benchmark = await page.locator('#benchmarkBody').innerText();
    assert.match(benchmark, /indisponible via l’API officielle/);
    assert.doesNotMatch(benchmark, /1\s?867,02/);
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

test('affiche les avertissements Urssaf sans exposer les diagnostics internes de valeurs par défaut', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({
    warnings: [{ message: 'Une règle expérimentale a été utilisée.' }],
    missingVariables: { 'salarié . contrat . catégorie professionnelle': 1 }
  });
  try {
    assert.equal(await page.locator('#urssafWarnings').isVisible(), true);
    assert.equal(await page.locator('#urssafWarnings summary').innerText(), 'Informations Urssaf');
    await page.locator('#urssafWarnings summary').scrollIntoViewIfNeeded();
    await page.locator('#urssafWarnings summary').click();
    assert.match(await page.locator('#urssafWarnings').innerText(), /Messages issus du calcul officiel Mon-entreprise\./);
    const diagnostics = await page.locator('#urssafWarningsList').innerText();
    assert.match(diagnostics, /règle expérimentale/);
    assert.doesNotMatch(diagnostics, /catégorie professionnelle|Valeur par défaut utilisée/);
    assert.equal(await page.locator('#cardsBody .result-source details summary').first().innerText(), 'Voir les messages (1)',
      'la source Urssaf doit être explicite sur chaque offre');
    // Vérifie que le libellé reste cohérent après un second calcul, pas seulement
    // lors du rendu initial de la carte.
    await openSalaryEditor(page);
    await page.locator('#editOfferGross').fill('2400');
    await page.locator('#editOfferSave').click();
    await page.waitForFunction(() => {
      const card = document.querySelector('#cardsBody [data-card]');
      return card?.dataset.resultState === 'ready' &&
        card.querySelector('.result-source details summary')?.textContent === 'Voir les messages (1)';
    });
    assert.equal(await page.locator('#cardsBody .result-source details summary').first().innerText(), 'Voir les messages (1)');
  } finally {
    await context.close();
  }
});

test('masque les diagnostics internes de valeurs par défaut quand aucun avertissement Urssaf ne remonte', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({
    missingVariables: {
      'entreprise . catégorie juridique': 1,
      'entreprise . catégorie juridique . EI': 1,
      'entreprise . catégorie juridique . SELAS': 1
    }
  });
  try {
    assert.equal(await page.locator('#urssafWarnings').isVisible(), false);
    assert.equal(await page.locator('#cardsBody .result-source details').count(), 0);
  } finally {
    await context.close();
  }
});

test('gère une indisponibilité Urssaf sans afficher de résultat local', { timeout: 60000 }, async () => {
  const { context, page, calls } = await openApp({ consent: false, failApi: true });
  try {
    assert.equal(calls.bodies.some(body => Object.hasOwn(body.situation, 'salarié . contrat . salaire brut')), false);
    await openSalaryEditor(page);
    await page.locator('#editOfferGross').fill('2500');
    await page.locator('#editOfferSave').click();
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
    const gross = page.locator('#editOfferGross');
    await gross.fill('3100');
    await page.locator('#editOfferSave').click();
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
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')).scenarios[0].brut), 3100);
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
    await page.locator('#editOfferGross').fill('3200');
    await page.locator('#editOfferSave').click();
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
    const waterfallDetails = page.locator('#stackChart .offer-net-details').first();
    await waterfallDetails.locator('summary').click();
    const waterfallRows = await waterfallDetails.locator('.salary-net-summary-row').allTextContents();

    assert.equal(waterfallRows.length, 3, 'le récapitulatif affiche trois valeurs lorsque les TR sont activés');
    assert.match(waterfallRows[0], /Net sans TR/);
    assert.match(waterfallRows[1], /TR — total des deux parts[\s\S]*168 €/);
    assert.match(waterfallRows[2], /Net avec TR/);
    assert.equal(await waterfallDetails.locator('.salary-net-summary-row').nth(1).locator('strong').innerText(), '168 €',
      'le total des TR doit rester juste même si l’API omet l’une des parts');
    await addSecondScenario(page);
    const stackDetails = page.locator('#stackChart .comparison-offer-card .offer-net-details').first();
    await stackDetails.locator('summary').click();
    assert.equal(await stackDetails.count(), 1, 'le scénario conservant les TR doit avoir son récapitulatif');
    const stackRows = await stackDetails.locator('.salary-net-summary-row').allTextContents();
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
    assert.equal(await page.locator('#cardsScroll').isVisible(), false);
    await advanced.evaluate(el => { el.open = true; });
    assert.equal(await advanced.evaluate(el => el.open), true);
    assert.equal(await page.locator('#cardsScroll').isVisible(), false);
    assert.equal(await page.locator('#raiseModuleToggle').isVisible(), true,
      'les outils secondaires deviennent accessibles lorsque leur panneau est ouvert');
  } finally {
    await context.close();
  }
});

test('une offre ouvre une fenêtre flottante de modification complète', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ consent:false });
  try {
    await page.locator('#maquetteYourSalary [data-edit-offer]').first().click();
    assert.equal(await page.locator('.modal-edit-offer').isVisible(), true);
    assert.equal(await page.locator('#modalBox').getAttribute('role'), 'dialog');
    assert.equal(await page.locator('#modalBox').getAttribute('aria-label'), 'Modifier une offre salariale');
    assert.equal(await page.locator('#modalBox').getAttribute('aria-describedby'), null);
    assert.equal(await page.locator('#editOfferName').inputValue(), 'Poste actuel');
    await page.waitForFunction(() => {
      const field = document.querySelector('#editOfferName');
      return field && document.activeElement === field && field.selectionStart === field.value.length && field.selectionEnd === field.value.length;
    }, { timeout: 5000 });
    assert.deepEqual(await page.locator('#editOfferName').evaluate(el => [el.selectionStart, el.selectionEnd]), ['Poste actuel'.length, 'Poste actuel'.length],
      'à l’ouverture, aucun texte ne doit être sélectionné et le curseur doit rester à la fin du nom');
    await page.locator('#editOfferName').click();
    assert.deepEqual(await page.locator('#editOfferName').evaluate(el => [el.selectionStart, el.selectionEnd]), [0, 'Poste actuel'.length],
      'un clic dans le champ sélectionne tout le nom existant');
    await page.locator('#editOfferName').pressSequentially('Nouvelle offre');
    assert.equal(await page.locator('#editOfferName').inputValue(), 'Nouvelle offre',
      'la saisie doit remplacer le nom existant sans suppression manuelle');
    assert.equal(await page.locator('#editOfferCommune').count(), 0);
    assert.equal(await page.locator('#editOfferMutuellePat').count(), 0);
    assert.equal(await page.locator('#editOfferMonths').count(), 0);
    assert.equal(await page.locator('#editOfferBonus').count(), 0);
    assert.equal(await page.locator('#editOffer13thBase').count(), 0);
    assert.equal((await page.locator('#editOfferMutuelleToggle').innerText()).replace(/\s+/g, ' ').trim(), '30 € / mois');
    await page.locator('#editOfferMutuelleToggle').click();
    assert.equal(await page.locator('#editOfferMutuelle').isVisible(), true);
    await page.setViewportSize({ width:375, height:667 });
    const modalFit = await page.locator('#modalBox').evaluate(el => {
      const rect = el.getBoundingClientRect();
      const form=el.querySelector('.edit-offer-modal');
      return { top:rect.top, bottom:rect.bottom, scrollHeight:el.scrollHeight, clientHeight:el.clientHeight, viewportHeight:window.innerHeight,
        children:[...form.children].map(node=>({className:node.className,tag:node.tagName,height:Math.round(node.getBoundingClientRect().height),margin:getComputedStyle(node).margin,gap:getComputedStyle(form).rowGap})),
        trColumns:getComputedStyle(el.querySelector('#editOfferTrFields .three-col')).gridTemplateColumns } ;
    });
    assert.ok(modalFit.top >= 0 && modalFit.bottom <= modalFit.viewportHeight,
      `l’éditeur doit rester entièrement visible sur mobile : ${JSON.stringify(modalFit)}`);
    assert.ok(modalFit.scrollHeight <= modalFit.clientHeight + 1,
      `l’éditeur ne doit pas imposer de défilement interne : ${JSON.stringify(modalFit)}`);
    await page.locator('#editOfferCancel').click();
    await page.locator('.modal-edit-offer').waitFor({ state: 'detached' });
  } finally {
    await context.close();
  }
});

test('les repères SMIC et médiane appartiennent au bloc Comparaison, pas à Vos offres', { timeout:60000 }, async () => {
  const { context, page } = await openApp({ consent:false });
  try {
    await page.setViewportSize({ width:390, height:844 });
    const placement = await page.evaluate(() => ({
      insideComparison: !!document.querySelector('#comparePanel #benchmarkMount'),
      insideOffers: !!document.querySelector('.unified-salary-panel #benchmarkMount'),
      followsOffers: !!(document.querySelector('.unified-salary-panel').compareDocumentPosition(document.querySelector('#comparePanel')) & Node.DOCUMENT_POSITION_FOLLOWING)
    }));
    assert.equal(placement.insideComparison, true, 'les repères doivent être dans le bloc Comparaison');
    assert.equal(placement.insideOffers, false, 'les repères ne doivent pas être dans Vos offres');
    assert.equal(placement.followsOffers, true,
      'le bloc Comparaison doit suivre le bloc Vos offres dans l’ordre du document');
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
        const cards = [...el.querySelectorAll('.comparison-offer-card')].map(node => {
          const rect = node.getBoundingClientRect();
          return { left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom, width:rect.width };
        });
        return { cards, scrollWidth:el.scrollWidth, clientWidth:el.clientWidth };
      });
      assert.equal(layout.cards.length, 2);
      assert.ok(layout.cards.every(card => card.width > 0));
      if(width<=360){
        assert.ok(layout.cards[1].top >= layout.cards[0].bottom,
          `les cartes doivent s’empiler à ${width}px : ${JSON.stringify(layout.cards)}`);
      }else{
        assert.ok(Math.abs(layout.cards[0].top-layout.cards[1].top)<=1,
          `les cartes doivent être côte à côte à ${width}px : ${JSON.stringify(layout.cards)}`);
        assert.ok(layout.cards[1].left>=layout.cards[0].right,
          `un espace doit séparer les cartes à ${width}px : ${JSON.stringify(layout.cards)}`);
      }
      assert.ok(await page.locator('#maquetteYourSalary .offer-comparison-card').count() === 2);
      const offerMeta = await page.locator('#maquetteYourSalary .offer-comparison-meta').nth(1).innerText();
      const normalizedOfferMeta = offerMeta.replace(/\s/g, '');
      assert.ok(normalizedOfferMeta.includes('3400€brut/mois'));
      assert.ok(normalizedOfferMeta.includes('40800€brut/an'));
      assert.match(normalizedOfferMeta, /(?:35|39)h$/,
        'la durée hebdomadaire réelle de l’offre doit être affichée');
      assert.ok(
        normalizedOfferMeta.indexOf('3400€brut/mois') < normalizedOfferMeta.indexOf('40800€brut/an') &&
        normalizedOfferMeta.indexOf('40800€brut/an') < normalizedOfferMeta.search(/(?:35|39)h$/),
        'les deux montants bruts et la durée hebdomadaire doivent être affichés dans le même ordre'
      );
      assert.ok(layout.scrollWidth <= layout.clientWidth + 1,
        `le graphique déborde à ${width}px : ${JSON.stringify(layout)}`);
    }

    const secondName = await page.locator('#maquetteYourSalary .offer-comparison-name').nth(1).innerText();
    // L'ajout d'une offre peut ouvrir son éditeur : revenir au comparatif
    // avant d'utiliser l'action de suppression qui n'existe que sur les cartes.
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
        cards: [...document.querySelectorAll('.benchmark-item')].map(el => el.getBoundingClientRect().width),
        positions: [...document.querySelectorAll('.benchmark-item')].map(el => el.getBoundingClientRect().top)
      }));
      assert.ok(sizes.scroll <= sizes.panel + 1, `débordement du comparatif à ${width}px : ${JSON.stringify(sizes)}`);
      assert.equal(sizes.cards.length, 2);
      assert.ok(sizes.cards.every(card=>card>0&&card<sizes.panel-8),
        `les deux repères doivent rester côte à côte à ${width}px : ${JSON.stringify(sizes)}`);
      assert.ok(Math.abs(sizes.cards[0]-sizes.cards[1])<=1);
      assert.ok(Math.abs(sizes.positions[0]-sizes.positions[1])<=1,
        `les deux repères doivent être sur la même ligne à ${width}px : ${JSON.stringify(sizes)}`);
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
    assert.equal(await page.locator('#comparePanel .comparison-period').count(), 1,
      'le sélecteur de période appartient au panneau de comparaison');
    assert.equal(await page.locator('.unified-salary-panel .comparison-period').count(), 0,
      'la gestion des offres ne doit pas contenir le sélecteur de période');
    const hour = page.locator('[data-maquette-period="hour"]');
    const month = page.locator('[data-maquette-period="month"]');
    const year = page.locator('[data-maquette-period="year"]');
    const valueLabel = page.locator('#stackChart .comparison-offer-value-label');
    const valueUnit = page.locator('#stackChart .comparison-offer-value small');
    assert.equal(await valueLabel.innerText(), 'Net mensuel · avant impôt');
    assert.equal(await month.getAttribute('aria-pressed'), 'true', 'le mensuel est sélectionné par défaut');
    assert.equal(await hour.getAttribute('aria-pressed'), 'false');
    assert.equal(await year.getAttribute('aria-pressed'), 'false');
    assert.equal(await valueUnit.innerText(), '/ mois');
    await hour.click();
    assert.equal(await hour.getAttribute('aria-pressed'), 'true');
    assert.equal(await month.getAttribute('aria-pressed'), 'false');
    assert.equal(await valueLabel.innerText(), 'Net horaire · avant impôt');
    assert.equal(await valueUnit.count(), 0, 'le taux horaire contient déjà son unité €/h');
    for (const result of await page.locator('#benchmarkMount .benchmark-result').allTextContents()) {
      assert.doesNotMatch(result, /€\/h\s*\/\s*heure/, 'les écarts horaires ne doivent pas répéter l’unité');
    }
    await month.click();
    assert.equal(await month.getAttribute('aria-pressed'), 'true');
    assert.equal(await hour.getAttribute('aria-pressed'), 'false');
    assert.equal(await year.getAttribute('aria-pressed'), 'false');
    assert.equal(await valueLabel.innerText(), 'Net mensuel · avant impôt');
    assert.equal(await valueUnit.innerText(), '/ mois');
    await year.click();
    assert.equal(await year.getAttribute('aria-pressed'), 'true');
    assert.equal(await month.getAttribute('aria-pressed'), 'false');
    assert.equal(await valueLabel.innerText(), 'Net annuel · avant impôt');
    assert.equal(await valueUnit.innerText(), '/ an');

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
    await page.locator('#editOfferGross').fill('2500');
    await page.locator('#editOfferSave').click();
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
    await page.locator('#editOfferGross').fill('2500');
    await page.locator('#editOfferSave').click();
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
    assert.equal((await page.locator('#comparePanel > h2').innerText()).trim().replace(/\s+/g, ' '), 'Comparer les offres');
    assert.equal((await page.locator('#comparePanel > .sub').innerText()).trim(), 'Même période pour toutes les offres · durée réelle de chaque contrat.');
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
    assert.match(await card.locator('.scenario-edit-hint').innerText(), /Modifier cette offre/);
    assert.equal(await page.locator('.modal-edit-offer').count(), 0, 'aucune fenêtre ne reste ouverte dans le comparatif');
    await page.locator('#maquetteYourSalary [data-edit-offer]').first().click();
    assert.equal(await page.locator('.modal-edit-offer').isVisible(), true, 'la fenêtre flottante apparaît après sélection d’une offre');
    const period = page.locator('#editOfferPeriod');
    assert.equal(await period.locator('button[data-period]').count(), 2, 'mensuel et annuel utilisent le même sélecteur à boutons');
    assert.equal(await period.locator('[data-period="mois"]').getAttribute('aria-pressed'), 'true');
    await period.locator('[data-period="an"]').click();
    assert.equal(await period.locator('[data-period="an"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#moreMetrics').count(), 0, 'les indicateurs secondaires ont été retirés');
    
    await page.locator('#editOfferCancel').click();
    await page.locator('.modal-edit-offer').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.modal-edit-offer').count(), 0, 'la fenêtre se ferme à l’annulation');
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
    assert.match(await page.locator('#urssafStatusText').innerText(), /Vos offres sont conservées/);
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
    assert.match(await card.locator('.scenario-edit-hint').innerText(), /Modifier cette offre/);
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

    // Aligner la capture sur un exemple de brut mensuel.
    await openSalaryEditor(page);
    await page.locator('#editOfferGross').fill('2500');
    await page.locator('#editOfferSave').click();
    await page.waitForFunction(() =>
      (document.getElementById('urssafStatusText')?.textContent || '').includes('Calculs à jour') &&
      JSON.parse(localStorage.getItem('onnet.state.v1') || 'null')?.scenarios?.[0]?.brut === 2500,
      null, { timeout:20000 });
    await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));

    await page.setViewportSize({ width:1440, height:1000 });
    await page.locator('#maquetteYourSalary [data-edit-offer]').first().click();
    assert.equal(await page.locator('.modal-edit-offer').isVisible(), true);
    assert.ok(await page.locator('.modal-edit-offer').evaluate(el => el.scrollHeight > 0));
    await page.locator('#editOfferCancel').click();

    // Les captures doivent montrer le comparatif, sans fenêtre ouverte.
    
    await addSecondScenario(page, '3200');
    
    assert.equal(await page.locator('#maquetteYourSalary .offer-comparison-card').count(), 2,
      'les captures présentent deux offres comparables');
    assert.equal(await page.locator('#maquetteYourSalary [data-rename-offer]').count(), 0,
      'le renommage est réservé à la fenêtre de modification');

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
    const comparisonCards = page.locator('#stackChart .comparison-offer-card');
    assert.equal(await comparisonCards.count(), 2,
      'deux offres doivent produire deux cartes comparatives');
    assert.equal(await page.locator('#stackChart .stack-bar').count(), 0,
      'l’ancien graphique empilé ne doit plus être affiché');
    const currentOffer = comparisonCards.filter({ hasText: 'Poste actuel' });
    const currentOfferDetails = currentOffer.locator('.offer-net-details');
    await currentOfferDetails.locator('summary').click();
    const summaryRows = await currentOfferDetails.locator('.salary-net-summary-row').allTextContents();
    assert.equal(summaryRows.length, 3);
    assert.match(summaryRows[0], /Net sans TR/);
    assert.match(summaryRows[1], /TR — total des deux parts/);
    assert.match(summaryRows[2], /Net avec TR/);
    const parseEuro = value => Number(value.replace(/[^0-9]/g, ''));
    const summaryAmounts = await currentOffer.locator('.salary-net-summary-row strong').allTextContents();
    assert.equal(summaryAmounts.length, 3);
    assert.equal(parseEuro(summaryAmounts[1]), 168, 'le total des deux parts doit correspondre à 21 titres de 8 €');
    assert.equal(parseEuro(summaryAmounts[2]) - parseEuro(summaryAmounts[0]), 84, 'le gain de pouvoir d’achat correspond à la part employeur des titres');
    assert.match(await page.locator('#stackHint').innerText(), /mensuel/);
    assert.match(await page.locator('#stackHint').innerText(), /avant impôt/);

  } finally {
    await context.close();
  }
});


test('les cartes de comparaison affichent la même unité après les calculs API', { timeout: 60000 }, async () => {
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
        legend?.hidden === true && chart.querySelectorAll('.comparison-offer-card').length === 2;
    }, null, { timeout:20000 });
    assert.match(await page.locator('#stackHint').innerText(), /mensuel.*avant impôt/);
  } finally {
    await context.close();
  }
});

test('les repères SMIC et médiane restent en deux colonnes lisibles sur tous les mobiles', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    await page.waitForSelector('#benchmarkMount .benchmark-grid');
    for (const width of [320, 360, 375, 390, 430]) {
      await page.setViewportSize({ width, height:844 });
      const geometry = await page.locator('#benchmarkMount .benchmark-grid').evaluate(el => {
        const cards = [...el.querySelectorAll('.benchmark-item')].map(card => {
          const rect = card.getBoundingClientRect();
          return { top:rect.top, left:rect.left, right:rect.right, width:rect.width };
        });
        return {
          columns:getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
          scrollWidth:el.scrollWidth, clientWidth:el.clientWidth, cards
        };
      });
      assert.equal(geometry.columns, 2, 'SMIC et médiane doivent rester côte à côte à '+width+' px');
      assert.equal(geometry.cards.length, 2);
      assert.ok(geometry.cards.every(card=>card.width>0));
      assert.ok(geometry.cards[1].left >= geometry.cards[0].right + 8,
        'un espace horizontal réel sépare les deux repères à '+width+' px');
      assert.ok(Math.abs(geometry.cards[1].top - geometry.cards[0].top) < 2,
        'les deux repères sont alignés à '+width+' px');
      assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1,
        'les repères ne débordent pas à '+width+' px');
    }
    const benchmarkText = (await page.locator('#benchmarkMount').innerText()).replace(/\s+/g, ' ');
    assert.match(benchmarkText, /Référence statistique.*INSEE 2025.*France/);
    assert.doesNotMatch(benchmarkText, /Zone France/);
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
    
    await page.locator('#maquetteYourSalary [data-edit-offer]').nth(1).click();
    const nameInput = page.locator('#editOfferName');
    await page.waitForFunction(() => {
      const field = document.querySelector('#editOfferName');
      return field && document.activeElement === field && field.selectionStart === field.value.length && field.selectionEnd === field.value.length;
    }, { timeout: 5000 });
    const initialSelection = await nameInput.evaluate(el => [el.selectionStart, el.selectionEnd, el.value.length]);
    assert.notDeepEqual(initialSelection.slice(0, 2), [0, initialSelection[2]],
      'le nom reste non sélectionné à l’ouverture');
    await nameInput.click();
    const selectedName = await nameInput.evaluate(el => ({
      value: el.value, start: el.selectionStart, end: el.selectionEnd
    }));
    assert.equal(selectedName.start, 0,
      'un clic sélectionne le nom depuis son premier caractère');
    assert.equal(selectedName.end, selectedName.value.length,
      'la sélection couvre la totalité du nom, quelle que soit sa longueur');
    assert.equal(await page.locator('#editOfferName').locator('xpath=..').innerText().then(text => text.includes('facultatif')), false,
      'le libellé ne présente plus le nom comme facultatif');
    await page.locator('#editOfferName').fill('Proposition Rennes');
    await page.locator('#editOfferSave').click();
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
    await page.locator('#editOfferHours [data-hours="35"]').click();
    await page.locator('#editOfferSave').click();
    // Le repère SMIC suit l'offre de référence : sélectionner explicitement l'offre 35 h.
    await page.locator('#maquetteYourSalary [data-set-offer-reference]').click();
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
      appReady: Boolean(document.getElementById('maquetteAddSalary')),
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


test('les cartes de gestion ne dupliquent pas les montants nets du comparatif', { timeout:60000 }, async () => {
  const { context, page } = await openApp();
  try {
    await page.waitForSelector('#maquetteYourSalary .offer-comparison-card');
    assert.equal(await page.locator('#maquetteYourSalary .offer-comparison-card').count(), 1);
    assert.equal(await page.locator('#maquetteYourSalary .offer-comparison-net').count(), 0,
      'les montants nets sont réservés au comparatif inférieur');
    assert.match(await page.locator('#maquetteYourSalary').innerText(), /Contrat/);
  } finally {
    await context.close();
  }
});


test('le changement de période affiche un salaire arrondi sans dérive de conversion', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    await page.locator('#maquetteAddSalary').click();
    await page.locator('#modalAddPeriod [data-period="an"]').click();
    await page.locator('#modalAddInput').fill('29500');
    await page.locator('#modalAddPeriod [data-period="mois"]').click();
    assert.equal(await page.locator('#modalAddInput').inputValue(), '2458,33',
      'le mensuel doit être affiché au centime, sans longue décimale flottante');
    await page.locator('#modalAddPeriod [data-period="an"]').click();
    assert.equal(await page.locator('#modalAddInput').inputValue(), '29500',
      'le retour à l’annuel doit conserver le montant initial');
    await page.locator('#modalAddCancel').click();
  } finally {
    await context.close();
  }
});

test('compare correctement une offre 35 h et une offre 39 h sur les trois périodes', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    await addSecondScenario(page, '3200');
    await openSalaryEditor(page, 1);
    await page.locator('#editOfferHours [data-hours="35"]').click();
    await page.locator('#editOfferSave').click();
    await page.waitForFunction(() => {
      const state = JSON.parse(localStorage.getItem('onnet.state.v1') || 'null');
      const cards = [...document.querySelectorAll('#cardsBody [data-card]')];
      const durations = (state?.scenarios || []).map(s => String(s.dureeType));
      return durations.includes('35') && durations.includes('39') &&
        cards.length === 2 && cards.every(card => card.dataset.resultState === 'ready') &&
        document.querySelectorAll('#stackChart .comparison-offer-card').length === 2 &&
        (document.getElementById('urssafStatusText')?.textContent || '').includes('Calculs à jour');
    }, null, { timeout: 20000 });
    

    const source = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('onnet.state.v1') || 'null');
      const cards = [...document.querySelectorAll('#cardsBody [data-card]')];
      return {
        hours: Object.fromEntries(state.scenarios.map(s => [String(s.id), Number(s.dureeType)])),
        monthlyNet: Object.fromEntries(cards.map(card => [
          card.dataset.card,
          card.querySelector('.hero-value')?.textContent || ''
        ]))
      };
    });
    assert.deepEqual(Object.values(source.hours).sort(), [35, 39]);
    const parseEuro = value => Number(String(value).replace(/[^0-9,.-]/g, '').replace(',', '.'));

    const readComparison = async () => page.locator('#stackChart .comparison-offer-card').evaluateAll(cards =>
      cards.map(card => ({
        id: card.dataset.comparisonOffer,
        label: card.querySelector('.comparison-offer-value-label')?.textContent || '',
        value: card.querySelector('.comparison-offer-value')?.textContent || ''
      }))
    );

    await page.locator('[data-maquette-period="hour"]').click();
    let values = await readComparison();
    assert.equal(values.length, 2);
    for (const item of values) {
      const monthlyNet = parseEuro(source.monthlyNet[item.id]);
      const monthlyHours = source.hours[item.id] * 52 / 12;
      assert.ok(Math.abs(parseEuro(item.value) - monthlyNet / monthlyHours) < 0.02,
        `le taux horaire de l’offre ${item.id} doit utiliser ses propres heures contractuelles`);
    }

    await page.locator('[data-maquette-period="month"]').click();
    values = await readComparison();
    for (const item of values) {
      assert.match(item.label, /Net mensuel/);
      assert.ok(Math.abs(parseEuro(item.value) - parseEuro(source.monthlyNet[item.id])) < 0.03,
        `le net mensuel de l’offre ${item.id} doit rester celui calculé pour son contrat`);
    }

    await page.locator('[data-maquette-period="year"]').click();
    values = await readComparison();
    for (const item of values) {
      assert.match(item.label, /Net annuel/);
      assert.ok(Math.abs(parseEuro(item.value) - parseEuro(source.monthlyNet[item.id]) * 12) < 0.10,
        `le net annuel de l’offre ${item.id} doit être cohérent avec ses 12 mensualités`);
    }
  } finally {
    await context.close();
  }
});


test('conserve exactement un brut annuel saisi et propose un nom facultatif', { timeout: 60000 }, async () => {
  const { context, page } = await openApp();
  try {
    assert.equal(await page.locator('#maquetteCompareTitle').innerText(), 'Vos offres');
    assert.equal(await page.locator('.offer-rename-button').count(), 0,
      'le renommage ne doit plus être proposé sur les cartes');
    await page.locator('#maquetteAddSalary').click();
    assert.equal(await page.locator('#modalAddName').inputValue(), 'Offre 2');
    await page.locator('#modalAddPeriod [data-period="an"]').click();
    await page.locator('#modalAddInput').fill('29500');
    await page.locator('#modalAddName').fill('');
    await page.locator('#modalAddSubmit').click();
    await page.waitForFunction(() => {
      const state = JSON.parse(localStorage.getItem('onnet.state.v1') || 'null');
      return state?.scenarios?.length === 2 &&
        state.scenarios[1].salaireSaisi === 29500 &&
        state.scenarios[1].salaireSaisiPeriode === 'an' &&
        document.querySelectorAll('#cardsBody [data-result-state="ready"]').length === 2;
    }, null, { timeout: 20000 });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')).scenarios[1]);
    assert.equal(saved.name, 'Offre 2', 'le nom proposé doit rester utilisable si le champ facultatif est vide');
    assert.equal(saved.brut, 29500 / 12,
      'le brut mensuel interne doit conserver la précision issue du brut annuel');
    assert.ok(Math.abs(saved.brut * 12 - 29500) < 1e-8,
      'reconstituer l’annuel ne doit pas produire 29 499,96 €');
  } finally {
    await context.close();
  }
});


test('conserve aussi le brut annuel saisi pendant le premier démarrage', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ emptyStorage: true, consent: false });
  try {
    await page.locator('#modalOnboardingPeriod [data-period="an"]').click();
    await page.locator('#modalOnboardingInput').fill('29500');
    await page.locator('#modalOnboardingSubmit').click();
    await page.waitForFunction(() => {
      const state = JSON.parse(localStorage.getItem('onnet.state.v1') || 'null');
      return state?.scenarios?.[0]?.salaireSaisi === 29500 &&
        state.scenarios[0].salaireSaisiPeriode === 'an' &&
        Number.isFinite(state.scenarios[0].brut);
    });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')).scenarios[0]);
    assert.equal(saved.salaireSaisi, 29500);
    assert.equal(saved.salaireSaisiPeriode, 'an');
    assert.ok(Math.abs(saved.brut * 12 - 29500) < 1e-8);
  } finally {
    await context.close();
  }
});


test('la fenêtre de modification simplifiée conserve les paramètres masqués et permet de modifier la mutuelle', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ consent:false });
  try {
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('onnet.state.v1'));
      Object.assign(state.scenarios[0], {
        commune:'Pacé', codePostal:'35740', departement:'Ille-et-Vilaine',
        codeCommune:'35210', codeDepartement:'35', nbMois:13, primes:1200,
        treiziemeMoisBase:'ensemble', mutuellePat:55
      });
      localStorage.setItem('onnet.state.v1', JSON.stringify(state));
    });
    await page.reload();
    await page.locator('#maquetteYourSalary [data-edit-offer]').first().click();
    await page.locator('#editOfferName').click();
    await page.locator('#editOfferName').fill('Poste modifié');
    await page.locator('#editOfferPeriod [data-period="an"]').click();
    await page.locator('#editOfferGross').fill('29500');
    await page.locator('#editOfferHours [data-hours="39"]').click();
    await page.locator('#editOfferMutuelleToggle').click();
    await page.locator('#editOfferMutuelle').fill('42,50');
    await page.locator('#editOfferMealDays').fill('20');
    await page.locator('#editOfferMealValue').fill('9,50');
    await page.locator('#editOfferMealShare [data-share="40"]').click();
    await page.locator('#editOfferSave').click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')).scenarios[0]);
    assert.equal(saved.name, 'Poste modifié');
    assert.equal(saved.salaireSaisi, 29500);
    assert.equal(saved.salaireSaisiPeriode, 'an');
    assert.ok(Math.abs(saved.brut * 12 - 29500) < 1e-8);
    assert.equal(saved.dureeType, '39');
    assert.equal(saved.commune, 'Pacé');
    assert.equal(saved.codePostal, '35740');
    assert.equal(saved.departement, 'Ille-et-Vilaine');
    assert.equal(saved.codeCommune, '35210');
    assert.equal(saved.codeDepartement, '35');
    assert.equal(saved.mutuelle, 42.5);
    assert.equal(saved.mutuellePat, 55);
    assert.equal(saved.joursResto, 20);
    assert.equal(saved.valeurResto, 9.5);
    assert.equal(saved.partResto, 40);
    assert.equal(saved.nbMois, 13);
    assert.equal(saved.primes, 1200);
    assert.equal(saved.treiziemeMoisBase, 'ensemble');
  } finally {
    await context.close();
  }
});

test('les titres-restaurant doivent être renseignés avant activation du calcul', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ consent:false });
  try {
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('onnet.state.v1'));
      state.scenarios[0].joursResto = 0;
      state.scenarios[0].valeurResto = 0;
      localStorage.setItem('onnet.state.v1', JSON.stringify(state));
    });
    await page.reload();
    await page.locator('#maquetteYourSalary [data-edit-offer]').first().click();
    const save = page.locator('#editOfferSave');
    assert.equal(await save.isEnabled(), true, 'une offre sans titres-restaurant reste enregistrable');
    await page.locator('#editOfferTrToggle [data-tr="oui"]').click();
    assert.equal(await save.isDisabled(), true, 'activer les titres-restaurant exige des paramètres valides');
    await page.locator('#editOfferMealDays').fill('21');
    await page.locator('#editOfferMealValue').fill('8');
    assert.equal(await save.isEnabled(), true, 'des paramètres complets autorisent l’enregistrement');
    await page.locator('#editOfferTrToggle [data-tr="non"]').click();
    assert.equal(await save.isEnabled(), true, 'désactiver les titres-restaurant ne bloque pas l’enregistrement');
    await save.click();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')).scenarios[0]);
    assert.equal(saved.joursResto, 0);
    assert.equal(saved.valeurResto, 0);
  } finally {
    await context.close();
  }
});

test('les actions tactiles utiles vibrent brièvement seulement si l’API est disponible', { timeout:60000 }, async () => {
  const desktop = await openApp({ mockVibrate:true });
  try{
    await desktop.page.locator('[data-maquette-period="month"]').click();
    assert.deepEqual(await desktop.page.evaluate(() => window.__onnetVibrations), [],
      'un clic souris ne doit pas déclencher de vibration');
  }finally{
    await desktop.context.close();
  }

  const mobile = await openApp({ touch:true, mockVibrate:true });
  try{
    await mobile.page.locator('[data-maquette-period="month"]').tap();
    assert.deepEqual(await mobile.page.evaluate(() => window.__onnetVibrations), [8],
      'une sélection tactile doit produire une impulsion courte');
    await mobile.page.locator('#maquetteAddSalary').tap();
    assert.deepEqual(await mobile.page.evaluate(() => window.__onnetVibrations), [8,8],
      'l’ajout d’une offre doit produire le même retour discret');
  }finally{
    await mobile.context.close();
  }
});



test('le thème automatique suit le système et les choix manuels restent prioritaires', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ consent: false });
  try {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark',
      'le thème sombre du système doit être appliqué dès le chargement');
    const darkSurfaces = await page.evaluate(() => {
      const read = selector => {
        const style = getComputedStyle(document.querySelector(selector));
        return { background: style.backgroundColor, backgroundImage: style.backgroundImage, color: style.color };
      };
      return {
        body: read('body'),
        hero: read('header.hero'),
        offerPanel: read('.unified-salary-panel'),
        comparison: read('#comparePanel'),
        benchmark: read('#benchmarkMount .benchmark-item')
      };
    });
    for (const [name, surface] of Object.entries(darkSurfaces)) {
      assert.notEqual(surface.background, 'rgb(255, 255, 255)',
        `la surface ${name} ne doit pas rester blanche en thème sombre`);
    }

    const textContrasts = await page.evaluate(() => {
      const luminance = color => {
        const values = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
        if (!values || values.length !== 3) return null;
        const channels = values.map(value => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };
      const ratio = (foreground, background) => {
        const a = luminance(foreground), b = luminance(background);
        if (a === null || b === null) return null;
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const pairs = [
        ['comparison title', '#comparePanel .bars-title', '#comparePanel'],
        ['benchmark label', '#benchmarkMount .benchmark-label', '#benchmarkMount .benchmark-item'],
        ['benchmark value', '#benchmarkMount .benchmark-value', '#benchmarkMount .benchmark-item']
      ];
      return pairs.map(([name, foreground, background]) => {
        const fg = document.querySelector(foreground);
        const bg = document.querySelector(background);
        if (!fg || !bg) return { name, contrast: null };
        return {
          name,
          contrast: ratio(getComputedStyle(fg).color, getComputedStyle(bg).backgroundColor)
        };
      });
    });
    for (const pair of textContrasts) {
      assert.ok(pair.contrast !== null && pair.contrast >= 4.5,
        `${pair.name} doit respecter le contraste WCAG AA (4,5:1), obtenu : ${pair.contrast}`);
    }
    assert.match(darkSurfaces.hero.backgroundImage, /linear-gradient/,
      'le bandeau principal doit conserver son dégradé dédié en thème sombre');
    assert.notEqual(darkSurfaces.comparison.background, darkSurfaces.body.background,
      'le comparatif doit avoir une surface dédiée en thème sombre');
    await page.locator('#headerMenu summary').click();
    const theme = page.locator('#themePreference');
    assert.equal(await theme.inputValue(), 'auto');

    await theme.selectOption('light');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light',
      'un choix manuel clair doit primer sur le système');
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');

    await theme.selectOption('auto');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark',
      'le retour au mode automatique doit reprendre la préférence système');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 3000 });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light',
      'un changement système doit être suivi sans recharger la page');
    assert.equal(await theme.inputValue(), 'auto');
  } finally {
    await context.close();
  }
});


test('le renommage reste enregistrable avec des titres-restaurant historiques incomplets et le nom reste sans fond en thème sombre', { timeout:60000 }, async () => {
  const { context, page } = await openApp({ consent:false });
  try {
    await page.evaluate(() => {
      const state=JSON.parse(localStorage.getItem('onnet.state.v1'));
      state.scenarios[0].joursResto=0;
      state.scenarios[0].valeurResto=8;
      state.scenarios[0].partResto=50;
      localStorage.setItem('onnet.state.v1',JSON.stringify(state));
      localStorage.setItem('onnet.theme.preference','dark');
    });
    await page.reload();
    await page.locator('#maquetteYourSalary [data-edit-offer]').first().click();
    const save=page.locator('#editOfferSave');
    assert.equal(await save.isEnabled(),true,
      'un paramétrage historique inchangé ne doit pas bloquer le simple renommage');
    await page.locator('#editOfferName').click();
    await page.locator('#editOfferName').fill('Poste renommé');
    await save.click();
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('onnet.state.v1')));
    assert.equal(saved.scenarios[0].name,'Poste renommé');
    assert.equal(saved.scenarios[0].joursResto,0,'les paramètres historiques restent inchangés');
    assert.equal(saved.scenarios[0].valeurResto,8,'les paramètres historiques restent inchangés');
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    const nameStyle=await page.locator('#maquetteYourSalary .offer-comparison-name').first().evaluate(el=>{
      const style=getComputedStyle(el);
      return {background:style.backgroundColor,backgroundImage:style.backgroundImage};
    });
    assert.equal(nameStyle.background,'rgba(0, 0, 0, 0)',
      'le nom de l’offre ne doit pas avoir de fond en thème sombre');
    assert.equal(nameStyle.backgroundImage,'none');
  } finally {
    await context.close();
  }
});


test('prépare les sections détaillées pour l’impression puis restaure leur état', { timeout: 60000 }, async () => {
  const { context, page } = await openApp({ consent:false });
  try {
    const before = await page.evaluate(() => {
      window.__onnetPrintCalls = 0;
      window.print = () => { window.__onnetPrintCalls += 1; };
      return [...document.querySelectorAll('details.more, #moreMetrics, #legacySalaryCards')]
        .map(el => ({ id:el.id, open:el.open }));
    });

    await page.locator('#headerMenu summary').click();
    await page.locator('#printBtn').click();
    await page.waitForFunction(() => window.__onnetPrintCalls === 1);

    const duringPrint = await page.evaluate(() => ({
      calls:window.__onnetPrintCalls,
      states:[...document.querySelectorAll('details.more, #moreMetrics, #legacySalaryCards')]
        .map(el => ({ id:el.id, open:el.open }))
    }));
    assert.equal(duringPrint.calls, 1, 'le bouton doit déclencher exactement une impression');
    assert.ok(duringPrint.states.every(item => item.open),
      'toutes les sections détaillées ciblées doivent être ouvertes avant impression');

    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    const afterPrint = await page.evaluate(() => [...document.querySelectorAll('details.more, #moreMetrics, #legacySalaryCards')]
      .map(el => ({ id:el.id, open:el.open })));
    assert.deepEqual(afterPrint, before,
      'l’état initial des sections doit être restauré après fermeture de l’aperçu');
  } finally {
    await context.close();
  }
});
