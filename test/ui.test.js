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
  await page.addInitScript(() => {
    if (!localStorage.getItem('onnet.state.v1')) {
      localStorage.setItem('onnet.state.v1', JSON.stringify({
        v: 1,
        scenarios: [{ id: 0, name: 'Poste actuel', brut: 2300, dureeType: '39' }],
        refId: 0,
        metric: 'netHoraire',
        displayAmt: 'net',
        displayPeriod: 'mensuel'
      }));
    }
  });
  await page.goto(baseUrl);
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
    const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(shareUrl, /#share=/);

    const sharedPage = await context.newPage();
    await sharedPage.goto(shareUrl);
    assert.equal(await sharedPage.locator('#cardsBody [data-card]').count(), 2);
    assert.equal(await sharedPage.locator('#cardsBody [data-key="brut"]').nth(1).inputValue(), '3450');
  } finally {
    await context.close();
  }
});

test('affiche les repères salariaux et permet d’actualiser le SMIC localement', async () => {
  const { context, page } = await openApp();
  try {
    assert.equal(await page.locator('.benchmark-item').count(), 2);
    assert.equal(await page.locator('#benchmarkSmicBrut').inputValue(), '1867.02');
    await page.locator('#benchmarkSettings summary').click().catch(() => {});
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

