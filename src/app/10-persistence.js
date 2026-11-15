// ---------- Persistance locale (les données de paie ne sont envoyées qu'après consentement) ----------
const STORAGE_KEY = 'onnet.state.v1';
function loadPersistedState(){
  try{
    return deserializePersistedState(localStorage.getItem(STORAGE_KEY));
  } catch(e){ return null; }
}

let showToastImpl = null;
let storageWarningShown = false;

function saveState(){
  if(suppressAutosave) return;
  try{
    localStorage.setItem(STORAGE_KEY, serializePersistedState({
      scenarios, refId, metric, displayAmt, displayPeriod, foyer,
      onboardingCompleted, openCardIds
    }));
  } catch(e){
    // Une seule alerte par session : les saisies restent utilisables, mais
    // l'utilisateur doit savoir qu'elles ne seront pas restaurées au prochain lancement.
    if(!storageWarningShown){
      storageWarningShown = true;
      if(typeof showToastImpl === 'function'){
        showToastImpl('Sauvegarde indisponible : vos modifications ne seront pas conservées après fermeture.');
      }
    }
  }
}

function clearPersistedState(){
  try{ localStorage.removeItem(STORAGE_KEY); } catch(e){ /* ignoré */ }
}

