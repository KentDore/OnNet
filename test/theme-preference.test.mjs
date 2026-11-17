'use strict';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeThemePreference } from '../src/theme-preference.mjs';

function createEnvironment({ saved = null, systemDark = false, storageThrows = false } = {}){
  const values = new Map(saved ? [['onnet.theme.preference', saved]] : []);
  const listeners = {};
  const systemListeners = {};
  const selector = {
    value: '',
    addEventListener(type, callback){ listeners[type] = callback; }
  };
  const root = { dataset: {} };
  const colorMeta = { content: '' };
  const documentRef = {
    documentElement: root,
    getElementById(id){ return id === 'themePreference' ? selector : null; },
    querySelector(){ return colorMeta; }
  };
  const storage = {
    getItem(key){
      if(storageThrows) throw new Error('storage blocked');
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value){
      if(storageThrows) throw new Error('storage blocked');
      values.set(key, value);
    },
    removeItem(key){
      if(storageThrows) throw new Error('storage blocked');
      values.delete(key);
    }
  };
  const media = {
    matches: systemDark,
    addEventListener(type, callback){ systemListeners[type] = callback; }
  };
  const windowRef = {
    localStorage: storage,
    matchMedia(query){
      assert.equal(query, '(prefers-color-scheme: dark)');
      return media;
    }
  };
  return { windowRef, documentRef, selector, root, colorMeta, values, listeners, media, systemListeners };
}

test('applique le thème système par défaut et suit ses changements', () => {
  const env = createEnvironment({ systemDark: true });
  initializeThemePreference(env);
  assert.equal(env.root.dataset.theme, 'dark');
  assert.equal(env.selector.value, 'auto');
  assert.equal(env.colorMeta.content, '#14181A');

  env.media.matches = false;
  env.systemListeners.change();
  assert.equal(env.root.dataset.theme, 'light');
  assert.equal(env.colorMeta.content, '#176b49');
});

test('restaure une préférence manuelle et ignore les changements système', () => {
  const env = createEnvironment({ saved: 'dark', systemDark: false });
  initializeThemePreference(env);
  assert.equal(env.root.dataset.theme, 'dark');
  env.media.matches = true;
  env.systemListeners.change();
  assert.equal(env.root.dataset.theme, 'dark');
});

test('enregistre un choix manuel et supprime la préférence au retour en automatique', () => {
  const env = createEnvironment();
  initializeThemePreference(env);

  env.selector.value = 'dark';
  env.listeners.change();
  assert.equal(env.values.get('onnet.theme.preference'), 'dark');
  assert.equal(env.root.dataset.theme, 'dark');

  env.selector.value = 'auto';
  env.media.matches = true;
  env.listeners.change();
  assert.equal(env.values.has('onnet.theme.preference'), false);
  assert.equal(env.root.dataset.theme, 'dark');
});

test('reste utilisable si localStorage est bloqué', () => {
  const env = createEnvironment({ storageThrows: true, systemDark: true });
  assert.doesNotThrow(() => initializeThemePreference(env));
  env.selector.value = 'light';
  assert.doesNotThrow(() => env.listeners.change());
  assert.equal(env.root.dataset.theme, 'light');
});

test('refuse une initialisation sans dépendances navigateur explicites', () => {
  assert.throws(() => initializeThemePreference(), /windowRef et documentRef sont requis/);
});
