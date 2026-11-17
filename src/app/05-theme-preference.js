'use strict';

// ---------- Préférence d'apparence ----------
// Le thème système est le défaut. Un choix manuel reste indépendant
// des préférences du téléphone jusqu'au retour explicite au mode automatique.
(() => {
  const STORAGE_KEY = 'onnet.theme.preference';
  const root = document.documentElement;
  const selector = document.getElementById('themePreference');
  const colorMeta = document.querySelector('meta[name="theme-color"]');
  const systemPreference = window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

  function readPreference(){
    try{
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === 'light' || saved === 'dark' ? saved : 'auto';
    }catch(_){
      return 'auto';
    }
  }

  let preference = readPreference();

  function applyTheme(){
    const theme = preference === 'auto'
      ? (systemPreference && systemPreference.matches ? 'dark' : 'light')
      : preference;
    root.dataset.theme = theme;
    if(colorMeta) colorMeta.content = theme === 'dark' ? '#14181A' : '#176b49';
    if(selector && selector.value !== preference) selector.value = preference;
  }

  if(selector){
    selector.value = preference;
    selector.addEventListener('change', () => {
      const next = selector.value;
      preference = next === 'light' || next === 'dark' ? next : 'auto';
      try{
        if(preference === 'auto') localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, preference);
      }catch(_){
        // Le thème reste utilisable pour la session même si le stockage est bloqué.
      }
      applyTheme();
    });
  }

  if(systemPreference){
    const onSystemChange = () => {
      if(preference === 'auto') applyTheme();
    };
    if(typeof systemPreference.addEventListener === 'function'){
      systemPreference.addEventListener('change', onSystemChange);
    }else if(typeof systemPreference.addListener === 'function'){
      systemPreference.addListener(onSystemChange);
    }
  }

  applyTheme();
})();
