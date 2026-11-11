'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');

const ENDPOINT = 'https://mon-entreprise.urssaf.fr/api/v1/evaluate';

test('API officielle accessible depuis Chromium : SMIC, salaire 35 h et salaire 39 h', async () => {
  let server;
  let browser;
  try {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html lang="fr"><meta charset="utf-8"><title>OnNet API smoke test</title><body>Test API officielle</body></html>');
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const browserErrors = [];
    page.on('pageerror', error => browserErrors.push(error.message));

    const result = await page.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(result.status(), 200);

    const apiResult = await page.evaluate(async endpoint => {
      async function evaluate(expressions, situation) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ expressions, situation })
        });
        const body = await response.json();
        return { status: response.status, ok: response.ok, body };
      }

      const commonSituation = {
        'salarié': 'oui',
        'salarié . contrat': "'CDI'",
        'salarié . contrat . statut cadre': 'non',
        'salarié . contrat . temps de travail . temps partiel': 'non',
        'établissement . commune': "'Pacé'",
        'salarié . convention collective': "'droit commun'",
        'salarié . activité partielle': 'non',
        'date': '11/11/2026'
      };

      const weeklyOvertime = 4 * 52 / 12;
      const monthlyBaseHours = 151.67;
      const baseGrossFor39h = 2300 * monthlyBaseHours /
        (monthlyBaseHours + weeklyOvertime);

      const [thirtyFiveHours, thirtyNineHours] = await Promise.all([
        evaluate([
          'SMIC',
          'salarié . rémunération . brut',
          'salarié . rémunération . net . à payer avant impôt'
        ], {
          ...commonSituation,
          'salarié . contrat . salaire brut': '2300 €/mois',
          'salarié . temps de travail . heures supplémentaires': '0 heure/mois'
        }),
        evaluate([
          'salarié . rémunération . brut',
          'salarié . rémunération . heures supplémentaires',
          'salarié . rémunération . net . à payer avant impôt'
        ], {
          ...commonSituation,
          'salarié . contrat . salaire brut': `${baseGrossFor39h.toFixed(6)} €/mois`,
          'salarié . temps de travail . heures supplémentaires': `${weeklyOvertime} heure/mois`
        })
      ]);

      return { thirtyFiveHours, thirtyNineHours, weeklyOvertime, baseGrossFor39h };
    }, ENDPOINT);

    const thirtyFive = apiResult.thirtyFiveHours;
    assert.equal(thirtyFive.ok, true, `35 h : HTTP ${thirtyFive.status} depuis le navigateur`);
    assert.equal(thirtyFive.body.evaluate?.length, 3, '35 h : les trois expressions doivent être retournées');
    const smic = thirtyFive.body.evaluate[0].nodeValue;
    const gross35 = thirtyFive.body.evaluate[1].nodeValue;
    const net35 = thirtyFive.body.evaluate[2].nodeValue;
    assert.ok(Number.isFinite(smic) && smic > 0, 'La règle SMIC doit renvoyer une valeur positive');
    // Référence indépendante publiée par l'Urssaf pour le 11/11/2026 : 1 867,02 €/mois.
    // https://mon-entreprise.urssaf.fr/documentation/SMIC
    assert.ok(Math.abs(smic - 1867.02) <= 0.02,
      `SMIC mensuel : attendu 1 867,02 € selon la documentation Urssaf (reçu : ${smic})`);
    assert.ok(Number.isFinite(gross35) && Math.abs(gross35 - 2300) <= 0.05,
      `35 h : le brut API doit correspondre à 2 300 € (reçu : ${gross35})`);
    assert.ok(Number.isFinite(net35) && net35 > 0, '35 h : le net avant impôt doit être positif');

    const thirtyNine = apiResult.thirtyNineHours;
    assert.equal(thirtyNine.ok, true, `39 h : HTTP ${thirtyNine.status} depuis le navigateur`);
    assert.equal(thirtyNine.body.evaluate?.length, 3, '39 h : les trois expressions doivent être retournées');
    const gross39 = thirtyNine.body.evaluate[0].nodeValue;
    const overtimePay39 = thirtyNine.body.evaluate[1].nodeValue;
    const net39 = thirtyNine.body.evaluate[2].nodeValue;
    assert.ok(Number.isFinite(gross39) && gross39 > apiResult.baseGrossFor39h,
      `39 h : le brut doit inclure le salaire de base et les heures supplémentaires (reçu : ${gross39})`);
    assert.ok(Number.isFinite(overtimePay39) && overtimePay39 > 0,

      `39 h : les heures supplémentaires doivent être rémunérées (reçu : ${overtimePay39})`);
    assert.ok(Math.abs(gross39 - apiResult.baseGrossFor39h - overtimePay39) <= 0.05,
      '39 h : le brut total doit correspondre au salaire de base plus la rémunération des heures supplémentaires');
    assert.ok(Number.isFinite(net39) && net39 > 0, '39 h : le net avant impôt doit être positif');

    const smicBenchmark = await page.evaluate(async ({ endpoint, commonSituation, smic }) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          expressions: [
            'salarié . rémunération . brut',
            'salarié . rémunération . net . à payer avant impôt'
          ],
          situation: {
            ...commonSituation,
            'salarié . contrat . salaire brut': `${smic} €/mois`,
            'salarié . temps de travail . heures supplémentaires': '0 heure/mois'
          }
        })
      });
      const body = await response.json();
      return { status: response.status, ok: response.ok, body };
    }, { endpoint: ENDPOINT, commonSituation: {
      'salarié': 'oui',
      'salarié . contrat': "'CDI'",
      'salarié . contrat . statut cadre': 'non',
      'salarié . contrat . temps de travail . temps partiel': 'non',
      'établissement . commune': "'Pacé'",
      'salarié . convention collective': "'droit commun'",
      'salarié . activité partielle': 'non',
      'date': '11/11/2026'
    }, smic });
    assert.equal(smicBenchmark.ok, true, 'SMIC : le calcul dédié doit répondre');
    assert.equal(smicBenchmark.body.evaluate?.length, 2, 'SMIC : brut et net avant impôt attendus');
    assert.ok(Number.isFinite(smicBenchmark.body.evaluate[0].nodeValue), 'SMIC : brut numérique');
    assert.ok(Number.isFinite(smicBenchmark.body.evaluate[1].nodeValue), 'SMIC : net avant impôt numérique');

    // Vérification de robustesse sur des montants très faibles, usuels et élevés.
    // Ces cas contrôlent le comportement technique de l'API, pas la conformité
    // juridique de chaque situation particulière.
    for (const grossTarget of [1, 500, 1867.02, 4000, 100000]) {
      const response = await page.evaluate(async ({ endpoint, commonSituation, grossTarget }) => {
        const apiResponse = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            expressions: [
              'salarié . rémunération . brut',
              'salarié . rémunération . net . à payer avant impôt',
              'salarié . rémunération . net . imposable',
              'salarié . cotisations . salarié'
            ],
            situation: {
              ...commonSituation,
              'salarié . contrat . salaire brut': `${grossTarget} €/mois`,
              'salarié . temps de travail . heures supplémentaires': '0 heure/mois'
            }
          })
        });
        const body = await apiResponse.json();
        return { status: apiResponse.status, ok: apiResponse.ok, body };
      }, { endpoint: ENDPOINT, commonSituation: {
        'salarié': 'oui',
        'salarié . contrat': "'CDI'",
        'salarié . contrat . statut cadre': 'non',
        'salarié . contrat . temps de travail . temps partiel': 'non',
        'établissement . commune': "'Pacé'",
        'salarié . convention collective': "'droit commun'",
        'salarié . activité partielle': 'non',
        'date': '11/11/2026'
      }, grossTarget });

      assert.equal(response.ok, true, `Brut ${grossTarget} € : HTTP ${response.status}`);
      assert.equal(response.body.evaluate?.length, 4, `Brut ${grossTarget} € : quatre expressions attendues`);
      const [gross, net, taxable, contributions] = response.body.evaluate.map(item => item.nodeValue);
      assert.ok(Number.isFinite(gross), `Brut ${grossTarget} € : le brut doit être numérique (reçu : ${gross})`);
      assert.ok(Number.isFinite(net), `Brut ${grossTarget} € : le net doit être numérique (reçu : ${net})`);
      if (grossTarget >= 4000) {
        for (const [label, value] of Object.entries({ taxable, contributions })) {
          assert.ok(Number.isFinite(value), `Brut ${grossTarget} € : ${label} doit être numérique (reçu : ${value})`);
        }
      } else {
        // Pour les très faibles salaires, certaines expressions détaillées
        // peuvent être absentes. Le client refuse alors le résultat incomplet au lieu
        // de fabriquer un net imposable ou des cotisations.
        for (const [label, value] of Object.entries({ taxable, contributions })) {
          assert.ok(value === undefined || Number.isFinite(value),
            `Brut ${grossTarget} € : ${label} doit être absent ou numérique (reçu : ${value})`);
        }
      }
      assert.ok(Math.abs(gross - grossTarget) <= 0.05,
        `Brut demandé ${grossTarget} € : montant calculé ${gross} €`);
      assert.ok(net >= 0, `Brut ${grossTarget} € : le net ne doit pas être négatif (${net})`);
    }

    assert.deepEqual(browserErrors, []);
  } catch (error) {
    if (/Failed to fetch|CORS|NetworkError/i.test(String(error))) {
      throw new Error(`Le navigateur ne peut pas accéder à l’API Urssaf (CORS/réseau) : ${error.message}`);
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
}, { timeout: 45000 });
