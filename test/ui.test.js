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
    if (options.failApi) {
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
  await page.goto(baseUrl);
  if (pageErrors.length) {
    await context.close();
    throw new Error('Erreur JavaScript au chargement :\n' + pageErrors.join('\n'));
  }

  if (options.consent !== false) {
    await page.locator('#urssafCalculateBtn').click();
    await page.waitForFunction(() => {
      const status = document.getElementById('urssafStatusText')?.textContent || '';
      const cards = [...document.querySelectorAll('#cardsBody [data-card]')];
      return status.includes('Calcul terminé') &&
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
    assert.equal(calls.count, 0);
    assert.equal(await page.locator('#absenceModule').count(), 0);
    assert.equal(await page.getByText('Simuler une absence', { exact: true }).count(), 0);
    assert.match(await page.locator('#urssafStatusText').innerText(), /transmis à l’API Urssaf/);
    assert.equal(await page.locator('#urssafCalculateBtn').isVisible(), true);

    await page.locator('#urssafCalculateBtn').click();
    await page.waitForFunction(() =>
      (document.getElementById('urssafStatusText')?.textContent || '').includes('Calcul terminé'),
      null, { timeout: 20000 }
    );
    assert.ok(calls.count >= 3);
    assert.match(await page.locator('#cardsBody [data-result-state="ready"]').first().innerText(), /moteur officiel Mon-entreprise \/ Urssaf/);
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

test('les chiffres principaux et le repère SMIC sont calculés via l’API', async () => {
  const { context, page, calls } = await openApp();
  try {
    assert.ok(calls.bodies.some(body => body.situation['salarié . temps de travail . heures supplémentaires']));
    assert.ok(calls.bodies.filter(body => body.expressions.includes('salarié . rémunération . brut')).every(body => body.situation['établissement . commune'] === "'Pacé'"));
    assert.ok(calls.bodies.some(body => body.expressions.includes('SMIC')));
    assert.ok(calls.bodies.some(body => body.situation['salarié . contrat . salaire brut'] === '1867.020000 €/mois'));
    assert.match(await page.locator('.benchmark-heading').innerText(), /par heure/);
    assert.match(await page.locator('.benchmark-your-salary').innerText(), /Votre net avant impôt/);
    const cardNet = await page.locator('#cardsBody .hero-value').first().innerText();
    const benchmarkNet = await page.locator('.benchmark-your-salary strong').innerText();
    assert.equal(cardNet, benchmarkNet.replace(' / mois', ''), 'la carte et le comparatif doivent réutiliser le même net Urssaf');
    assert.equal(await page.locator('#cardsBody [data-result-state="ready"]').count(), 1);
  } finally {
    await context.close();
  }
});


test('récupère le SMIC officiel à la volée et conserve une valeur manuelle explicite', async () => {
  const { context, page, calls } = await openApp({ smicValue: 1950.25 });
  try {
    assert.ok(calls.bodies.some(body => body.expressions.includes('SMIC')));
    assert.ok(calls.bodies.some(body => body.situation['salarié . contrat . salaire brut'] === '1950.250000 €/mois'));
    await page.locator('.benchmark-settings summary').click();
    await page.locator('#benchmarkSmicBrut').fill('1800');
    await page.locator('#benchmarkSmicDate').fill('2026-01-01');
    await page.locator('#saveBenchmarkSettings').click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#cardsBody [data-card]')].every(card => card.dataset.resultState === 'ready') &&
      (document.getElementById('urssafStatusText')?.textContent || '').includes('Calcul terminé'),
      null, { timeout: 15000 }
    );
    assert.ok(calls.bodies.some(body => body.situation['salarié . contrat . salaire brut'] === '1800.000000 €/mois'));
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.benchmarks.v1')));
    assert.equal(saved.smicBrut, 1800);
    assert.equal(saved.smicDate, '2026-01-01');

    await page.reload();
    assert.equal(await page.locator('#benchmarkSmicBrut').inputValue(), '1800.00');
    assert.ok(calls.bodies.some(body => body.situation['salarié . contrat . salaire brut'] === '1800.000000 €/mois'));
  } finally {
    await context.close();
  }
});

test('en cas d’échec de récupération du SMIC, ne présente pas le montant de secours comme actuel', async () => {
  const { context, page } = await openApp({ consent:false, failApi:true });
  try {
    await page.locator('#urssafCalculateBtn').click();
    await page.waitForFunction(() =>
      (document.getElementById('urssafStatusText')?.textContent || '').includes('ont échoué'),
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
    const card = page.locator('#cardsBody [data-card]').first();
    await card.locator('details.more summary').click();
    await card.locator('[data-key="commune"]').fill('Rennes');
    await card.locator('[data-key="commune"]').blur();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#cardsBody [data-card]')].every(card => card.dataset.resultState === 'ready') &&
      (document.getElementById('urssafStatusText')?.textContent || '').includes('Calcul terminé'),
      null, { timeout: 15000 }
    );
    assert.ok(calls.bodies.some(body => body.situation['établissement . commune'] === "'Rennes'"));

    await page.locator('#shareBtn').click();
    await page.locator('#shareCreateBtn').click();
    const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
    const payload = await page.evaluate(url => {
      const encoded = new URL(url).hash.slice('#share='.length).replace(/-/g, '+').replace(/_/g, '/');
      const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), c => c.charCodeAt(0))));
    }, shareUrl);
    assert.equal(payload.scenarios[0].commune, 'Rennes');
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

test('transmet les deux parts de mutuelle saisies lors de l’ajout', async () => {
  const { context, page, calls } = await openApp();
  try {
    const before = calls.count;
    await page.locator('#addScenario').click();
    await page.locator('#modalAddInput').fill('3400');
    await page.locator('#modalAddMutuelle').fill('25');
    await page.locator('#modalAddMutuellePat').fill('40');
    assert.equal(await page.locator('#modalAddMutuellePat').inputValue(), '40');
    await page.locator('#modalAddSubmit').click();
    await page.waitForFunction(() =>
      document.querySelectorAll('#cardsBody [data-result-state="ready"]').length === 2,
      null, { timeout: 15000 }
    );
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('onnet.state.v1')).scenarios[1]);
    assert.equal(stored.mutuelle, 25);
    assert.equal(stored.mutuellePat, 40);
    const request = calls.bodies.slice(before).find(body => body.situation['salarié . contrat . salaire brut']);
    assert.ok(request, 'le nouveau scénario doit être envoyé à l’API');
    assert.equal(request.situation['salarié . cotisations . prévoyances . santé . montant'], '65.000000 €/mois', JSON.stringify(calls.bodies.slice(before).map(body => ({ gross:body.situation['salarié . contrat . salaire brut'], health:body.situation['salarié . cotisations . prévoyances . santé . montant'], rate:body.situation['salarié . cotisations . prévoyances . santé . taux employeur'] }))));
    assert.equal(request.situation['salarié . cotisations . prévoyances . santé . taux employeur'], '61.538462%');
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
      (document.getElementById('urssafStatusText')?.textContent || '').includes('ne sont pas encore pris en charge')
    );
    assert.equal(await page.locator('#urssafCalculateBtn').isVisible(), false);
    assert.equal(calls.count, before, 'aucun nouvel appel API pour un scénario non pris en charge');
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
