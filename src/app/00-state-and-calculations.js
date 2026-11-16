"use strict";


// ---------- État ----------
let idCounter = 0;

// Consentement et état du repère SMIC partagés par les fragments applicatifs,
// sans persistance locale ni stockage dans un global mutable.
let urssafGeneration = 0;
let urssafDebounceTimer = null;
const urssafCalculationCache = createUrssafCalculationCache({ maxResults:100 });
const urssafSessionState = createUrssafSessionState();
const URSSAF_CONSENT_STORAGE_KEY = 'onnet.urssaf.consent.v1';

// L'autorisation explicite est distincte des salaires et survit aux mises à jour
// de la page. Elle reste révocable sans effacer le comparatif.
try{
  if(localStorage.getItem(URSSAF_CONSENT_STORAGE_KEY) === 'granted'){
    urssafSessionState.grantConsent();
  }
}catch(error){
  // Le calcul restera possible dans cette session si le stockage est bloqué.
}

function grantUrssafConsent(){
  urssafSessionState.grantConsent();
  try{
    localStorage.setItem(URSSAF_CONSENT_STORAGE_KEY, 'granted');
  }catch(error){
    // L'autorisation reste valable pour la session en cours.
  }
}

function revokeUrssafConsent(){
  urssafSessionState.revokeConsent();
  try{
    localStorage.removeItem(URSSAF_CONSENT_STORAGE_KEY);
  }catch(error){
    // L'autorisation est tout de même retirée en mémoire.
  }
  if(urssafDebounceTimer){
    clearTimeout(urssafDebounceTimer);
    urssafDebounceTimer = null;
  }
  urssafGeneration += 1;
  updateUrssafStatus(getCurrentComputed());
}

function currentCalculationDate(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}


function scenarioCalculationDate(s){
  return currentCalculationDate();
}


function getSmicGross(){
  const state = urssafSessionState.getOfficialSmicState();
  return state.status === 'ready' ? state.amount : null;
}



function getCurrentComputed(){
  return scenarios.map(s => ({s, r:urssafCalculationCache.getResult(buildUrssafCalculationKey(s,scenarioCalculationDate(s))) || null}));
}

function getCalculationError(s){
  const key = buildUrssafCalculationKey(s,scenarioCalculationDate(s));
  return urssafCalculationCache.getError(key) || unsupportedCalculationReason(s);
}

function getCachedSmicResult(){
  const base = findScenario(refId) || scenarios[0];
  if(!base) return null;
  const scenario = buildSmicScenario(base,getSmicGross());
  if(!scenario) return null;
  return urssafCalculationCache.getResult(buildUrssafCalculationKey(scenario,scenarioCalculationDate(scenario))) || null;
}

const queuedUrssafFetch = createRateLimitedFetch(
  (url, options) => window.fetch(url, options),
  { minimumIntervalMs:350 }
);

function updateUrssafStatus(computed){
  const statusText = document.getElementById('urssafStatusText');
  if(!statusText) return;
  const status = document.getElementById('urssafStatus');
  if(status) status.classList.remove('is-error','has-diagnostics');
  const diagnostics = document.getElementById('urssafWarnings');
  const diagnosticsList = document.getElementById('urssafWarningsList');
  if(diagnostics) diagnostics.hidden = true;
  if(diagnosticsList) diagnosticsList.innerHTML = '';
  const smicState = urssafSessionState.getOfficialSmicState();
  if(!urssafSessionState.isConsentGranted()){
    statusText.textContent = 'Renseignez votre salaire pour autoriser sa transmission à l’API Urssaf. Aucune donnée salariale n’est transmise avant cette saisie.';
    return;
  }
  const failed = computed.filter(({s,r}) => !r && urssafCalculationCache.hasError(buildUrssafCalculationKey(s,scenarioCalculationDate(s))));
  const unsupported = computed.filter(({s,r}) => !r && unsupportedCalculationReason(s));
  const base = findScenario(refId) || scenarios[0];
  const smicScenario = base ? buildSmicScenario(base,getSmicGross()) : null;
  const smicResult = getCachedSmicResult();
  const smicKey = smicScenario ? buildUrssafCalculationKey(smicScenario,scenarioCalculationDate(smicScenario)) : null;
  const smicError = (smicScenario && !smicResult && urssafCalculationCache.hasError(smicKey)) ||
    (smicState.status === 'error');
  const smicPending = !smicResult && !smicError;
  const pending = computed.filter(({s,r}) => !r && !getCalculationError(s));
  if(smicPending) pending.push({s:smicScenario,r:null});
  if(failed.length || smicError){
    statusText.textContent = 'Le calcul n’a pas abouti. Vérifiez votre connexion puis réessayez.';
    if(status) status.classList.add('is-error');
    statusText.textContent += ' Modifiez un paramètre pour relancer le calcul.';
    return;
  }
  if(unsupported.length){
    statusText.textContent = 'Un ou plusieurs salaires nécessitent un ajustement. Consultez le message affiché dans la carte concernée.';
    statusText.textContent += ' Modifiez les paramètres concernés pour relancer le calcul.';
    return;
  }
  if(pending.length){
    statusText.textContent = 'Mise à jour des calculs…';
    return;
  }
  const ready = computed.map(x => x.r).filter(Boolean).concat(smicResult ? [smicResult] : []);
  if(smicState.status === 'ready') ready.push(smicState);
  const warnings = [...new Set(ready.flatMap(r => r.warnings || []))];
  const missing = [...new Set(ready.flatMap(r => r.missingVariables || []))];
  const checkedAt = ready.map(r => r.checkedAt).filter(Boolean).sort().slice(-1)[0];
  statusText.textContent = 'Calculs à jour.';
  if(diagnostics && diagnosticsList && (missing.length || warnings.length)){
    diagnosticsList.innerHTML = [
      ...missing.map(name => `<li>Valeur par défaut utilisée pour : ${esc(name)}</li>`),
      ...warnings.map(warning => `<li>${esc(warning)}</li>`)
    ].join('');
    diagnostics.hidden = false;
    if(status) status.classList.add('has-diagnostics');
  }
  // Aucun bouton de calcul : les résultats sont actualisés automatiquement.
}

let officialSmicPromise = null;
async function refreshOfficialSmic(forceRetry){
  if(officialSmicPromise) return officialSmicPromise;
  const currentSmicState = urssafSessionState.getOfficialSmicState();
  if(currentSmicState.status === 'ready' && !forceRetry) return currentSmicState;
  urssafSessionState.setOfficialSmicState({ status:'loading', amount:null, checkedAt:null, missingVariables:[], warnings:[], error:null });
  updateUrssafStatus(getCurrentComputed());
  officialSmicPromise = (async () => {
    try{
      if(!window.OnNetUrssafApi || typeof window.OnNetUrssafApi.evaluateUrssafExpression !== 'function'){
        throw new Error('Le client de règle SMIC officiel n’est pas chargé. Rechargez la page.');
      }
      const result = await window.OnNetUrssafApi.evaluateUrssafExpression(
        'SMIC', { date:currentCalculationDate() }, { fetchImpl:queuedUrssafFetch }
      );
      if(!Number.isFinite(result.value) || result.value <= 0) throw new Error('L’API Urssaf n’a pas renvoyé de montant SMIC valide.');
      urssafSessionState.setOfficialSmicState({ status:'ready', amount:result.value, checkedAt:result.checkedAt,
        missingVariables:result.missingVariables || [], warnings:result.warnings || [], error:null });
    }catch(error){
      urssafSessionState.setOfficialSmicState({ status:'error', amount:null, checkedAt:null, missingVariables:[], warnings:[],
        error:error instanceof Error ? error.message : 'Erreur de récupération du SMIC officiel.' });
    }finally{
      officialSmicPromise = null;
      updateComputed({skipUrssafSchedule:true});
      if(urssafSessionState.isConsentGranted() && urssafSessionState.getOfficialSmicState().status === 'ready') scheduleUrssafCalculations(true,false);
    }
    return urssafSessionState.getOfficialSmicState();
  })();
  return officialSmicPromise;
}

async function executeUrssafCalculations(generation, forceRetry){
  if(urssafSessionState.getOfficialSmicState().status !== 'ready'){
    await refreshOfficialSmic(forceRetry === true);
    if(generation !== urssafGeneration) return;
  }

  const jobs = scenarios.map(s => Object.assign({},s));
  const base = findScenario(refId) || scenarios[0];
  const smicScenario = base ? buildSmicScenario(base,getSmicGross()) : null;
  if(smicScenario) jobs.push(smicScenario);
  const seen = new Set();
  for(const s of jobs){
    if(generation !== urssafGeneration) return;
    const key = buildUrssafCalculationKey(s,scenarioCalculationDate(s));
    if(seen.has(key) || urssafCalculationCache.hasResult(key)) continue;
    seen.add(key);
    if(forceRetry) urssafCalculationCache.deleteError(key);
    if(urssafCalculationCache.hasError(key)) continue;
    const unsupported = unsupportedCalculationReason(s);
    if(unsupported) continue;
    try{
      if(!window.OnNetUrssafApi || typeof window.OnNetUrssafApi.calculateWithUrssafApi !== 'function'){
        throw new Error('Le client de calcul Urssaf n’est pas chargé. Rechargez la page.');
      }
      const result = await window.OnNetUrssafApi.calculateWithUrssafApi(
        buildUrssafInput(s,scenarioCalculationDate(s)), {fetchImpl:queuedUrssafFetch}
      );
      // Une réponse valide reste réutilisable pour ses paramètres exacts,
      // même si une saisie plus récente a rendu son affichage obsolète.
      urssafCalculationCache.setResult(key,mapUrssafResultToOnNet(result));
      urssafCalculationCache.deleteError(key);
    }catch(error){
      // Une erreur obsolète ne doit pas bloquer une prochaine tentative.
      if(generation === urssafGeneration){
        urssafCalculationCache.setError(key,error instanceof Error ? error.message : 'Erreur de calcul Urssaf inconnue.');
      }
    }
    if(generation !== urssafGeneration) return;
    updateUrssafStatus(getCurrentComputed());
  }
  if(generation === urssafGeneration) updateComputed({skipUrssafSchedule:true});
}

function scheduleUrssafCalculations(immediate, forceRetry){
  if(urssafDebounceTimer) clearTimeout(urssafDebounceTimer);
  const generation = ++urssafGeneration;
  const computed = getCurrentComputed();
  updateUrssafStatus(computed);
  if(!urssafSessionState.isConsentGranted()) return;
  const run = () => executeUrssafCalculations(generation, forceRetry === true);
  if(immediate) run();
  else urssafDebounceTimer = setTimeout(run, 300);
}

// Id du scénario tout juste créé, pour lui appliquer une animation d'entrée
// une seule fois (effacé à la fin du render() qui l'utilise).
let justAddedId = null;
function mkScenario(over){
  const base = {
    id: idCounter++, name:'Salaire', brut:2800, commune:'Pacé', codePostal:'35740', departement:'Ille-et-Vilaine',
    mutuelle:scenarioDefaults.mutuelle, mutuellePat:scenarioDefaults.mutuelle,
    joursResto:scenarioDefaults.joursResto, valeurResto:scenarioDefaults.valeurResto,
    partResto:scenarioDefaults.partResto,
    dureeType:'35', nbMois:scenarioDefaults.nbMois, primes:0,
    treiziemeMoisBase:'base',
  };
  const scenario = Object.assign(base, over || {});
  if(over && Object.prototype.hasOwnProperty.call(over, 'commune') && over.commune !== 'Pacé' &&
     !Object.prototype.hasOwnProperty.call(over, 'codePostal') && !Object.prototype.hasOwnProperty.call(over, 'departement')){
    scenario.codePostal = '';
    scenario.departement = '';
  }
  // Compatibilité avec les créations historiques : la part employeur suit
  // la part salarié, sauf lorsqu'une valeur distincte est fournie.
  if(!over || !Object.prototype.hasOwnProperty.call(over, 'mutuellePat')){
    scenario.mutuellePat = scenario.mutuelle;
  }
  return scenario;
}

function defaultScenarios(){
  return [
    mkScenario({ name:'Poste actuel', brut:2300, dureeType:'39', joursResto:21, valeurResto:8 })
  ];
}

