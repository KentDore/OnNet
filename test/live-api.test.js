'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');

const ENDPOINT = 'https://mon-entreprise.urssaf.fr/api/v1/evaluate';

test('API officielle accessible depuis un navigateur (CORS) et règle SMIC numérique', async () => {
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
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          expressions: [
            'SMIC',
            'salarié . rémunération . net . à payer avant impôt'
          ],
          situation: {
            'salarié': 'oui',
            'salarié . contrat': "'CDI'",
            'salarié . contrat . salaire brut': '2300 €/mois',
            'salarié . contrat . statut cadre': 'non',
            'salarié . contrat . temps de travail . temps partiel': 'non',
            'établissement . commune': "'Pacé'",
            'salarié . convention collective': "'droit commun'",
            'salarié . activité partielle': 'non',
            'salarié . temps de travail . heures supplémentaires': '0 heure/mois',
            'date': '11/11/2026'
          }
        })
      });
      const body = await response.json();
      return { status: response.status, ok: response.ok, body };
    }, ENDPOINT);

    assert.equal(apiResult.ok, true, `HTTP ${apiResult.status} depuis le navigateur`);
    assert.ok(Array.isArray(apiResult.body.evaluate), 'Réponse API sans tableau evaluate');
    assert.equal(apiResult.body.evaluate.length, 2, 'L’API doit retourner les deux expressions demandées');
    assert.ok(Number.isFinite(apiResult.body.evaluate[0].nodeValue), 'La règle SMIC doit renvoyer une valeur numérique');
    assert.ok(apiResult.body.evaluate[0].nodeValue > 0, 'La valeur SMIC doit être positive');
    assert.ok(Number.isFinite(apiResult.body.evaluate[1].nodeValue), 'Le net avant impôt doit être numérique');
    assert.ok(apiResult.body.evaluate[1].nodeValue > 0, 'Le net avant impôt doit être positif');
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
