'use strict';

// Contrôleur du thème : seul ce module connaît les API navigateur utilisées.
// Les dépendances sont injectées pour permettre des tests sans DOM réel.
export function initializeThemePreference({ windowRef, documentRef } = {}){
  if(!windowRef || !documentRef){
    throw new TypeError('windowRef et documentRef sont requis.');
  }

  const STORAGE_KEY = 'onnet.theme.preference';
  const root = documentRef.documentElement;
  const selector = documentRef.getElementById('themePreference');
  const colorMeta = documentRef.querySelector('meta[name="theme-color"]');
  const systemPreference = typeof windowRef.matchMedia === 'function'
    ? windowRef.matchMedia('(prefers-color-scheme: dark)')
    : null;

  function readPreference(){
    try{
      const saved = windowRef.localStorage.getItem(STORAGE_KEY);
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
        if(preference === 'auto') windowRef.localStorage.removeItem(STORAGE_KEY);
        else windowRef.localStorage.setItem(STORAGE_KEY, preference);
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
}
