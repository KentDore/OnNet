// ---------- Persistance locale (les données de paie ne sont envoyées qu'après consentement) ----------
const STORAGE_KEY = 'onnet.state.v1';
const NUMERIC_KEYS = ['brut','mutuelle','mutuellePat','joursResto','valeurResto','partResto','nbMois','primes'];
function loadPersistedState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    const data = JSON.parse(raw);
    if(!data || !Array.isArray(data.scenarios)) return null;
    const restored = normalizeScenarioIds(
      data.scenarios.map(sanitizeScenario).filter(Boolean), data.refId, data.openCardIds);
    if(!restored.scenarios.length) return null;
    const legacyPristine = data.onboardingCompleted !== true && restored.scenarios.length === 1 &&
      Number(restored.scenarios[0].brut) === 2300 && String(restored.scenarios[0].dureeType) === '39' &&
      Number(restored.scenarios[0].mutuelle) === 30 && Number(restored.scenarios[0].mutuellePat) === 30 &&
      Number(restored.scenarios[0].joursResto) === 21 && Number(restored.scenarios[0].valeurResto) === 8 &&
      Number(restored.scenarios[0].partResto) === 50;
    return { scenarios: restored.scenarios, refId: restored.refId, metric: data.metric,
             displayAmt: data.displayAmt, displayPeriod: data.displayPeriod,
             openCardIds: restored.openCardIds, foyer: sanitizeFoyer(data.foyer),
             onboardingCompleted: data.onboardingCompleted === true || (data.onboardingCompleted !== false && !legacyPristine) };
  } catch(e){ return null; }
}

let showToastImpl = null;
let storageWarningShown = false;

function saveState(){
  if(suppressAutosave) return;
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v:1, scenarios, refId, metric, displayAmt, displayPeriod, foyer,
      onboardingCompleted, openCardIds:[...openCardIds]
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

