'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const codecPromise = import(pathToFileURL(path.join(__dirname, '..', 'src', 'share-encoding.mjs')).href);

test('encode et decode les chaînes ASCII en Base64 URL sans padding', async () => {
  const { toBase64Url, fromBase64Url } = await codecPromise;
  assert.equal(toBase64Url('OnNet'), 'T25OZXQ');
  assert.equal(fromBase64Url('T25OZXQ'), 'OnNet');
  assert.equal(toBase64Url(''), '');
  assert.equal(fromBase64Url(''), '');
});

test('préserve les caractères accentués, emoji et caractères multioctets', async () => {
  const { toBase64Url, fromBase64Url } = await codecPromise;
  for (const value of ['Pacé', 'Rémunération 💶', '你好', 'العربية', 'é'.repeat(1000)]) {
    assert.equal(fromBase64Url(toBase64Url(value)), value);
  }
});

test('produit un alphabet URL sûr et aucun padding', async () => {
  const { toBase64Url } = await codecPromise;
  const encoded = toBase64Url('\u00fb\u00ef\u00ff');
  assert.match(encoded, /^[A-Za-z0-9_-]*$/);
  assert.equal(encoded.includes('='), false);
});

test('rejette les entrées Base64 URL invalides et les séquences UTF-8 mal formées', async () => {
  const { fromBase64Url, toBase64Url } = await codecPromise;
  for (const value of ['a', 'a=', 'abc$', 'ab+c', 'ab/c', '____=']) {
    assert.throws(() => fromBase64Url(value));
  }
  assert.throws(() => fromBase64Url('_w'));
  assert.throws(() => toBase64Url(null));
});
