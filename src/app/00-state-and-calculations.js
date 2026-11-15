"use strict";


// ---------- État ----------
let idCounter = 0;

// L'accord de transmission est donné par la saisie/validation du formulaire.
// Il reste limité à la session et n'est jamais mémorisé sur l'appareil.
let urssafConsentGranted = false;
let urssafGeneration = 0;
let urssafDebounceTimer = null;
const urssafResultCache = new Map();
const urssafErrorCache = new Map();
let officialSmicState = { status:'idle', amount:null, checkedAt:null, missingVariables:[], warnings:[], error:null };

function currentCalculationDate(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}


function scenarioCalculationDate(s){
  return currentCalculationDate();
}


function getSmicGross(){
  return officialSmicState.status === 'ready' ? officialSmicState.amount : null;
}



function getCurrentComputed(){
  return scenarios.map(s => ({s, r:urssafResultCache.get(buildUrssafCalculationKey(s,foyer,scenarioCalculationDate(s))) || null}));
}

function getCalculationError(s, f){
  const key = buildUrssafCalculationKey(s, f || foyer, scenarioCalculationDate(s));
  return urssafErrorCache.get(key) || unsupportedCalculationReason(s);
}

function getCachedSmicResult(){
  const base = findScenario(refId) || scenarios[0];
  if(!base) return null;
  const scenario = buildSmicScenario(base,getSmicGross());
  if(!scenario) return null;
  return urssafResultCache.get(buildUrssafCalculationKey(scenario,foyer,scenarioCalculationDate(scenario))) || null;
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
  if(!urssafConsentGranted){
    statusText.textContent = 'Renseignez votre salaire pour autoriser sa transmission à l’API Urssaf. Aucune donnée salariale n’est transmise avant cette saisie.';
    return;
  }
  const failed = computed.filter(({s,r}) => !r && urssafErrorCache.has(buildUrssafCalculationKey(s,foyer,scenarioCalculationDate(s))));
  const unsupported = computed.filter(({s,r}) => !r && unsupportedCalculationReason(s));
  const base = findScenario(refId) || scenarios[0];
  const smicScenario = base ? buildSmicScenario(base,getSmicGross()) : null;
  const smicResult = getCachedSmicResult();
  const smicKey = smicScenario ? buildUrssafCalculationKey(smicScenario,foyer,scenarioCalculationDate(smicScenario)) : null;
  const smicError = (smicScenario && !smicResult && urssafErrorCache.has(smicKey)) ||
    (officialSmicState.status === 'error');
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
  if(officialSmicState.status === 'ready') ready.push(officialSmicState);
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
  if(officialSmicState.status === 'ready' && !forceRetry) return officialSmicState;
  officialSmicState = { status:'loading', amount:null, checkedAt:null, missingVariables:[], warnings:[], error:null };
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
      officialSmicState = { status:'ready', amount:result.value, checkedAt:result.checkedAt,
        missingVariables:result.missingVariables || [], warnings:result.warnings || [], error:null };
    }catch(error){
      officialSmicState = { status:'error', amount:null, checkedAt:null, missingVariables:[], warnings:[],
        error:error instanceof Error ? error.message : 'Erreur de récupération du SMIC officiel.' };
    }finally{
      officialSmicPromise = null;
      updateComputed({skipUrssafSchedule:true});
      if(urssafConsentGranted && officialSmicState.status === 'ready') scheduleUrssafCalculations(true,false);
    }
    return officialSmicState;
  })();
  return officialSmicPromise;
}

async function executeUrssafCalculations(generation, forceRetry){
  if(officialSmicState.status !== 'ready'){
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
    const key = buildUrssafCalculationKey(s,foyer,scenarioCalculationDate(s));
    if(seen.has(key) || urssafResultCache.has(key)) continue;
    seen.add(key);
    if(forceRetry) urssafErrorCache.delete(key);
    if(urssafErrorCache.has(key)) continue;
    const unsupported = unsupportedCalculationReason(s);
    if(unsupported) continue;
    try{
      if(!window.OnNetUrssafApi || typeof window.OnNetUrssafApi.calculateWithUrssafApi !== 'function'){
        throw new Error('Le client de calcul Urssaf n’est pas chargé. Rechargez la page.');
      }
      const result = await window.OnNetUrssafApi.calculateWithUrssafApi(
        buildUrssafInput(s,foyer,scenarioCalculationDate(s)), {fetchImpl:queuedUrssafFetch}
      );
      // Une réponse valide reste réutilisable pour ses paramètres exacts,
      // même si une saisie plus récente a rendu son affichage obsolète.
      urssafResultCache.set(key,mapUrssafResultToOnNet(result));
      urssafErrorCache.delete(key);
      if(urssafResultCache.size > 100) urssafResultCache.delete(urssafResultCache.keys().next().value);
    }catch(error){
      // Une erreur obsolète ne doit pas bloquer une prochaine tentative.
      if(generation === urssafGeneration){
        urssafErrorCache.set(key,error instanceof Error ? error.message : 'Erreur de calcul Urssaf inconnue.');
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
  if(!urssafConsentGranted) return;
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

