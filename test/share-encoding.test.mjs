import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBase64Url, fromBase64Url } from '../src/share-encoding.mjs';

test('encode et decode les chaînes ASCII en Base64 URL sans padding', () => {
  assert.equal(toBase64Url('OnNet'), 'T25OZXQ');
  assert.equal(fromBase64Url('T25OZXQ'), 'OnNet');
  assert.equal(toBase64Url(''), '');
  assert.equal(fromBase64Url(''), '');
});

test('préserve les caractères accentués, emoji et caractères multioctets', () => {
  for (const value of ['Pacé', 'Rémunération 💶', '你好', 'العربية', 'é'.repeat(1000)]) {
    assert.equal(fromBase64Url(toBase64Url(value)), value);
  }
});

test('produit un alphabet URL sûr et aucun padding', () => {
  const encoded = toBase64Url('\u00fb\u00ef\u00ff');
  assert.match(encoded, /^[A-Za-z0-9_-]*$/);
  assert.equal(encoded.includes('='), false);
});

test('rejette les entrées Base64 URL invalides et les séquences UTF-8 mal formées', () => {
  for (const value of ['a', 'a=', 'abc$', 'ab+c', 'ab/c', '____=']) {
    assert.throws(() => fromBase64Url(value));
  }
  assert.throws(() => fromBase64Url('_w'));
  assert.throws(() => toBase64Url(null));
});
