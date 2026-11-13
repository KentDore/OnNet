"use strict";


// ---------- État ----------
let idCounter = 0;

// L'accord de transmission est donné par la saisie/validation du formulaire.
// Il reste limité à la session et n'est jamais mémorisé sur l'appareil.
let urssafConsentGranted = false;
let urssafGeneration = 0;
let urssafDebounceTimer = null;
let urssafRequestQueue = Promise.resolve();
let urssafLastRequestAt = 0;
const urssafResultCache = new Map();
const urssafErrorCache = new Map();
let officialSmicState = { status:'idle', amount:null, checkedAt:null, missingVariables:[], warnings:[], error:null };

function currentCalculationDate(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function taxInputForFoyer(f){
  if(f.mode === 'taux'){
    return { modeImpot:'personnalisé', tauxPAS:Number(f.pasRate) || 0 };
  }
  return {
    modeImpot:'barème',
    situationFamille:f.couple ? 'couple' : 'célibataire',
    enfantsACharge:Number(f.personnesCharge) || 0,
    parentIsole:!f.couple && f.parentIsole === true,
    autresRevenusImposables:f.couple ? (Number(f.autresRevenus) || 0) : 0
  };
}

function scenarioCalculationDate(s){
  return currentCalculationDate();
}

function calculationKey(s, f){
  return JSON.stringify({
    brut:Number(s.brut),
    dureeType:String(s.dureeType),
    mutuelle:Number(s.mutuelle) || 0,
    mutuellePat:Number(s.mutuellePat) || 0,
    joursResto:Number(s.joursResto) || 0,
    valeurResto:Number(s.valeurResto) || 0,
    partResto:Number(s.partResto) || 0,
    nbMois:Number(s.nbMois || 12),
    primes:Number(s.primes || 0),
    commune:String(s.commune || 'Pacé').trim(),
    codePostal:String(s.codePostal || ''),
    departement:String(s.departement || ''),
    date:scenarioCalculationDate(s),
    fiscal:s.isBenchmark ? null : taxInputForFoyer(f)
  });
}

function unsupportedCalculationReason(s){
  if(!Number.isFinite(Number(s.brut)) || Number(s.brut) <= 0){
    return 'Le salaire brut doit être strictement supérieur à 0 € pour effectuer une simulation.';
  }
  if(Number(s.nbMois || 12) !== 12){
    return 'Ce scénario utilise un nombre de mensualités différent de 12. Le traitement du 13ᵉ/14ᵉ mois n’est pas encore raccordé à l’API Urssaf.';
  }
  if(Number(s.primes || 0) > 0){
    return 'Ce scénario comporte des primes annuelles libres qui ne sont pas encore raccordées à l’API Urssaf.';
  }
  if(!String(s.codePostal || '').trim() || !String(s.departement || '').trim()){
    return 'Sélectionnez une commune dans les suggestions pour renseigner son code postal et son département avant le calcul.';
  }
  return null;
}

function buildUrssafInput(s, f){
  const reason = unsupportedCalculationReason(s);
  if(reason) throw new Error(reason);
  return Object.assign({
    brut:Number(s.brut),
    dureeType:String(s.dureeType),
    mutuelle:Number(s.mutuelle) || 0,
    mutuellePat:Number(s.mutuellePat) || 0,
    joursResto:Number(s.joursResto) || 0,
    valeurResto:Number(s.valeurResto) || 0,
    partResto:Number(s.partResto),
    commune:String(s.commune || 'Pacé').trim(),
    codePostal:String(s.codePostal || ''),
    departement:String(s.departement || ''),
    date:scenarioCalculationDate(s),
    benchmarkOnly:Boolean(s.isBenchmark)
  }, s.isBenchmark ? {} : taxInputForFoyer(f));
}

function mapUrssafResultToOnNet(result){
  if(result.benchmarkOnly){
    return {
      engine:result.engine,
      checkedAt:result.checkedAt,
      missingVariables:result.missingVariables,
      warnings:result.warnings,
      netApres:result.netBeforeTax
    };
  }
  const gross = result.grossCalculated;
  const overtimeHours = result.overtimeHours;
  const monthlyHours = HEURES_BASE + overtimeHours;
  // Le total des cotisations salarié inclut déjà la part salariale de mutuelle.
  // On isole cette ligne pour conserver la décomposition visuelle sans la compter deux fois.
  const otherEmployeeContributions = Math.max(0, result.employeeContributions - result.employeeHealth);
  const monthly = {
    brutTotal:gross,
    netApres:result.netBeforeTax,
    netImposable:result.taxableNet,
    cotisNettes:otherEmployeeContributions,
    mutuelle:result.employeeHealth,
    netSocial:result.netBeforeTax + result.mealTicketEmployee
  };
  const annual = {
    brutTotal:gross * 12,
    netApres:result.netBeforeTax * 12,
    netImposable:result.taxableNet * 12
  };
  const tr = {
    totalSalarie:result.mealTicketEmployee,
    totalEmployeur:result.mealTicketEmployer,
    reintegre:result.mealTicketNonDeductible,
    motif:result.mealTicketNonDeductible > 0.005 ? 'api' : null
  };
  return {
    engine:result.engine,
    checkedAt:result.checkedAt,
    missingVariables:result.missingVariables,
    warnings:result.warnings,
    hasHS:overtimeHours > 0,
    heuresSup:overtimeHours,
    brutHS:result.overtimePay,
    tr,
    m:monthly,
    a:annual,
    netApres:monthly.netApres,
    netImposable:monthly.netImposable,
    annuelNet:annual.netApres,
    netApresImpot:result.netAfterTax,
    annuelNetApresImpot:result.netAfterTax === null ? null : result.netAfterTax * 12,
    impotAnnuel:result.incomeTax,
    tauxImpot:result.calculatedTaxRate,
    brutHoraire:result.baseGross / HEURES_BASE,
    netHoraire:monthlyHours > 0 ? monthly.netApres / monthlyHours : 0,
    tauxEffectif:gross > 0 ? result.employeeContributions / gross * 100 : 0
  };
}

function getSmicGross(){
  return officialSmicState.status === 'ready' ? officialSmicState.amount : null;
}

function getSmicGrossTarget(baseGross, weeklyHours){
  const overtimeHours=Number(weeklyHours)===39?4*52/12:0;
  if(!overtimeHours) return baseGross;
  // En 39 h : SMIC de base 35 h + 4 h supplémentaires hebdomadaires à +25 %.
  return Math.round(baseGross*(1+overtimeHours*1.25/HEURES_BASE)*100)/100;
}

function buildSmicScenario(base){
  const amount = getSmicGross();
  if(!Number.isFinite(amount) || amount <= 0) return null;
  const weeklyHours=Number(base.dureeType)===39?39:35;
  return Object.assign({}, base, {
    id:-1, name:'Référence SMIC', brut:getSmicGrossTarget(amount,weeklyHours), dureeType:String(weeklyHours),
    mutuelle:0, mutuellePat:0, joursResto:0, valeurResto:0, partResto:0,
    nbMois:12, primes:0, isBenchmark:true
  });
}

function getCurrentComputed(){
  return scenarios.map(s => ({s, r:urssafResultCache.get(calculationKey(s,foyer)) || null}));
}

function getCalculationError(s, f){
  const key = calculationKey(s, f || foyer);
  return urssafErrorCache.get(key) || unsupportedCalculationReason(s);
}

function getCachedSmicResult(){
  const base = findScenario(refId) || scenarios[0];
  if(!base) return null;
  const scenario = buildSmicScenario(base);
  if(!scenario) return null;
  return urssafResultCache.get(calculationKey(scenario,foyer)) || null;
}

function queuedUrssafFetch(url, options){
  const request = urssafRequestQueue.then(async () => {
    const delay = Math.max(0, 350 - (Date.now() - urssafLastRequestAt));
    if(delay) await new Promise(resolve => setTimeout(resolve, delay));
    urssafLastRequestAt = Date.now();
    return window.fetch(url, options);
  });
  urssafRequestQueue = request.catch(() => {});
  return request;
}

function updateUrssafStatus(computed){
  const statusText = document.getElementById('urssafStatusText');
  if(!statusText) return;
  const status = document.getElementById('urssafStatus');
  if(status) status.classList.remove('is-error');
  const diagnostics = document.getElementById('urssafWarnings');
  const diagnosticsList = document.getElementById('urssafWarningsList');
  if(diagnostics) diagnostics.hidden = true;
  if(diagnosticsList) diagnosticsList.innerHTML = '';
  if(!urssafConsentGranted){
    statusText.textContent = 'Renseignez votre salaire pour autoriser sa transmission à l’API Urssaf. Aucune donnée salariale n’est transmise avant cette saisie.';
    return;
  }
  const failed = computed.filter(({s,r}) => !r && urssafErrorCache.has(calculationKey(s,foyer)));
  const unsupported = computed.filter(({s,r}) => !r && unsupportedCalculationReason(s));
  const base = findScenario(refId) || scenarios[0];
  const smicScenario = base ? buildSmicScenario(base) : null;
  const smicResult = getCachedSmicResult();
  const smicKey = smicScenario ? calculationKey(smicScenario,foyer) : null;
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
  const smicScenario = base ? buildSmicScenario(base) : null;
  if(smicScenario) jobs.push(smicScenario);
  const seen = new Set();
  for(const s of jobs){
    if(generation !== urssafGeneration) return;
    const key = calculationKey(s,foyer);
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
        buildUrssafInput(s,foyer), {fetchImpl:queuedUrssafFetch}
      );
      if(generation !== urssafGeneration) return;
      urssafResultCache.set(key,mapUrssafResultToOnNet(result));
      if(urssafResultCache.size > 100) urssafResultCache.delete(urssafResultCache.keys().next().value);
    }catch(error){
      if(generation !== urssafGeneration) return;
      urssafErrorCache.set(key,error instanceof Error ? error.message : 'Erreur de calcul Urssaf inconnue.');
    }
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

// ---------- Persistance locale (les données de paie ne sont envoyées qu'après consentement) ----------
const STORAGE_KEY = 'onnet.state.v1';
const NUMERIC_KEYS = ['brut','mutuelle','mutuellePat','joursResto','valeurResto','partResto','nbMois','primes'];
// Métriques de la section « D'autres chiffres utiles ». Le net mensuel n'y
// figure pas : c'est déjà ce que montre le graphique juste au-dessus.
// Une métrique inconnue (état sauvegardé ou lien partagé antérieur, par exemple
// l'ancien « Coût employeur » ou l'ancien « Net ») retombe sur METRIC_DEFAUT.
const METRIC_KEYS = ['netImposable','annuelNet','netApresImpot','netHoraire','brutHoraire'];
const METRIC_DEFAUT = 'netHoraire';
function sanitizeScenario(raw){
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const clean = Object.assign({}, raw);
  const limits = {
    brut:[0,1000000], mutuelle:[0,100000], mutuellePat:[0,100000], joursResto:[0,31],
    valeurResto:[0,500], partResto:[0,100], nbMois:[1,24],
    primes:[0,100000000]
  };
  for(const [key, range] of Object.entries(limits)){
    if(clean[key] === undefined) continue;
    const n = Number(clean[key]);
    if(!Number.isFinite(n) || n < range[0] || n > range[1]) return null;
    clean[key] = n;
  }
  if(clean.brut === undefined || !Number.isFinite(Number(clean.brut)) || Number(clean.brut) < 0) return null;
  // Compatibilité avec les états antérieurs : l'ancien modèle supposait une
  // part employeur égale à la part salarié.
  if(clean.mutuellePat === undefined){
    clean.mutuellePat = clean.mutuelle === undefined ? scenarioDefaults.mutuelle : clean.mutuelle;
  }
  clean.commune = typeof clean.commune === 'string' && clean.commune.trim()
    ? clean.commune.trim().replace(/\s+/g, ' ').slice(0, 80)
    : 'Pacé';
  if(clean.commune === 'Pacé' && !clean.codePostal && !clean.departement){
    clean.codePostal = '35740';
    clean.departement = 'Ille-et-Vilaine';
  }
  clean.codePostal = typeof clean.codePostal === 'string' && /^\d{5}$/.test(clean.codePostal) ? clean.codePostal : '';
  clean.departement = typeof clean.departement === 'string' ? clean.departement.trim().slice(0, 80) : '';
  if(!['base','ensemble'].includes(clean.treiziemeMoisBase)) clean.treiziemeMoisBase = 'base';
  if(typeof clean.name !== 'string' || !clean.name.trim()) clean.name = 'Salaire';
  clean.name = clean.name.trim().slice(0, 80);
  delete clean.statut;
  delete clean.rate;
  if(clean.dureeType !== '35' && clean.dureeType !== '39') clean.dureeType = '35';
  // Les scénarios d'absence historiques sont supprimés et ne sont plus calculés.
  delete clean.absenceType;
  delete clean.absenceDuree;
  delete clean.maintienPct;
  delete clean.carenceCouverte;
  if(!Number.isSafeInteger(clean.id) || clean.id < 0) delete clean.id;
  return clean;
}

// Le foyer fiscal est un réglage global (une personne, pas un salaire) : il est
// donc stocké à part des scénarios, et normalisé de la même façon qu'eux.
// mode 'bareme' : impôt reconstitué au barème à partir de la situation du foyer.
// mode 'taux'   : le taux de prélèvement à la source réel, saisi directement,
//                 s'applique tel quel — les champs de situation n'ont alors
//                 plus de rôle dans le calcul et disparaissent de l'UI.
const FOYER_DEFAUT = { mode:'bareme', situation:'seul', couple:false, personnesCharge:0, parentIsole:false, autresRevenus:0, pasRate:0 };
function sanitizeFoyer(raw){
  const f = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const nb = (v, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? clamp(n, min, max) : 0;
  };
  // Rétrocompatibilité : les anciens états ne connaissent que couple=true/false.
  const situation = ['seul','commun','concubinage'].includes(f.situation)
    ? f.situation : (f.couple === true ? 'commun' : 'seul');
  const couple = situation === 'commun';
  const personnesCharge = Math.floor(nb(f.personnesCharge, 0, 4));
  const parentIsole = situation === 'seul' && personnesCharge > 0 && f.parentIsole === true;
  return {
    mode: f.mode === 'taux' ? 'taux' : 'bareme',
    situation,
    couple,
    personnesCharge,
    parentIsole,
    autresRevenus: couple ? nb(f.autresRevenus, 0, 100000000) : 0,
    pasRate: nb(f.pasRate, 0, 100)
  };
}

function normalizeScenarioIds(scenarios, refId, openCardIds){
  // Les identifiants restaurés ne sont jamais conservés : une suite compacte
  // évite les dépassements de précision et garantit un prochain id exploitable.
  const oldToIndex = new Map();
  const normalized = scenarios.map((scenario, index) => {
    if(Number.isSafeInteger(scenario.id) && scenario.id >= 0 && !oldToIndex.has(scenario.id)){
      oldToIndex.set(scenario.id, index);
    }
    return Object.assign({}, scenario, { id: index });
  });
  const refIndex = Number.isSafeInteger(refId) ? oldToIndex.get(refId) : undefined;
  const normalizedRefId = refIndex === undefined
    ? (normalized.length ? normalized[0].id : null)
    : normalized[refIndex].id;
  const normalizedOpenCardIds = Array.isArray(openCardIds)
    ? [...new Set(openCardIds
        .filter(id => Number.isSafeInteger(id) && oldToIndex.has(id))
        .map(id => normalized[oldToIndex.get(id)].id))]
    : [];
  return { scenarios: normalized, refId: normalizedRefId, openCardIds: normalizedOpenCardIds };
}

function loadPersistedState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    const data = JSON.parse(raw);
    if(!data || !Array.isArray(data.scenarios)) return null;
    const restored = normalizeScenarioIds(
      data.scenarios.map(sanitizeScenario).filter(Boolean), data.refId, data.openCardIds);
    if(!restored.scenarios.length) return null;
    return { scenarios: restored.scenarios, refId: restored.refId, metric: data.metric,
             displayAmt: data.displayAmt, displayPeriod: data.displayPeriod,
             openCardIds: restored.openCardIds, foyer: sanitizeFoyer(data.foyer) };
  } catch(e){ return null; }
}

let showToastImpl = null;
let storageWarningShown = false;

function saveState(){
  if(suppressAutosave) return;
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v:1, scenarios, refId, metric, displayAmt, displayPeriod, foyer,
      openCardIds:[...openCardIds]
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

// ---------- Partage par URL (l'état vit dans le hash — jamais envoyé à un serveur) ----------
function toBase64Url(str){
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function fromBase64Url(str){
  let b64 = str.replace(/-/g,'+').replace(/_/g,'/');
  while(b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function loadShareState(){
  try{
    if(!location.hash) return null;
    const encoded = new URLSearchParams(location.hash.slice(1)).get('share');
    if(!encoded) return null;
    const data = JSON.parse(fromBase64Url(encoded));
    if(!data || !Array.isArray(data.scenarios)) return null;
    const restored = normalizeScenarioIds(
      data.scenarios.map(sanitizeScenario).filter(Boolean), data.refId);
    if(!restored.scenarios.length) return null;
    return { scenarios: restored.scenarios, refId: restored.refId, metric: data.metric,
             displayAmt: data.displayAmt, displayPeriod: data.displayPeriod,
             foyer: sanitizeFoyer(data.foyer) };
  } catch(e){ return null; }
}

function buildShareUrl(options){
  const opts = options || {};
  const selectedIds = Array.isArray(opts.scenarioIds) ? new Set(opts.scenarioIds) : null;
  const sharedScenarios = scenarios.filter(s => !selectedIds || selectedIds.has(s.id));
  if(!sharedScenarios.length) throw new Error('Sélectionnez au moins un salaire à partager.');

  const sharedData = sharedScenarios.map(s => opts.includeDetails ? { ...s } : ({
    // Données essentielles à la comparaison salariale.
    id:s.id, name:s.name, brut:s.brut, dureeType:s.dureeType, commune:s.commune || 'Pacé',
    codePostal:s.codePostal || '', departement:s.departement || '',
    nbMois:s.nbMois, primes:s.primes, treiziemeMoisBase:s.treiziemeMoisBase,
    // Sans option « détails », neutraliser explicitement ces valeurs plutôt
    // que laisser les valeurs par défaut du navigateur destinataire s'appliquer.
    mutuelle:0, mutuellePat:0, joursResto:0, valeurResto:0, partResto:50,
  }));

  const payload = {
    v:2,
    scenarios:sharedData,
    refId:sharedScenarios.some(s => s.id === refId) ? refId : sharedScenarios[0].id,
    metric, displayAmt, displayPeriod,
    foyer:opts.includeFoyer ? { ...foyer } : { ...FOYER_DEFAUT }
  };
  const encoded = toBase64Url(JSON.stringify(payload));
  // Pas location.origin : il vaut la chaîne « null » sur file:// (Firefox,
  // Safari), or le README documente l'ouverture directe du fichier.
  return location.href.split('#')[0] + '#share=' + encoded;
}

// Repli historique : fonctionne même là où l'API Clipboard moderne est
// bloquée par une Permissions Policy (ex. Artifact affiché dans un iframe
// sandboxé), car execCommand('copy') n'est pas soumis à cette politique.
function legacyCopy(text){
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try{ ok = document.execCommand('copy'); } catch(e){ ok = false; }
  document.body.removeChild(ta);
  return ok;
}

function showShareOptionsModal(){
  const scenarioChoices = scenarios.map(s => `
    <label class="share-scenario-option" for="shareScenario-${s.id}">
      <input type="checkbox" id="shareScenario-${s.id}" value="${s.id}" checked>
      <span><strong>${esc(s.name)}</strong><small>${fmt(s.brut)} brut/mois · ${s.dureeType} h · ${s.nbMois} mensualités${s.primes ? ` · primes ${fmt(s.primes)}/an` : ''}</small></span>
    </label>`).join('');
  const html = `
    <p id="modalMsg" class="modal-msg">Choisissez les informations à inclure dans le lien.</p>
    <p class="sub-hint">Toujours inclus : brut mensuel, durée hebdomadaire, nombre de mensualités, primes et réglage du 13ᵉ/14ᵉ mois.</p>
    <fieldset class="share-options-group">
      <legend>Salaires à partager</legend>
      ${scenarioChoices}
    </fieldset>
    <fieldset class="share-options-group">
      <legend>Informations facultatives</legend>
      <label class="share-extra-option" for="shareIncludeDetails">
        <input type="checkbox" id="shareIncludeDetails">
        <span><strong>Détails de paie</strong><small>Mutuelle salarié/employeur et titres restaurant.</small></span>
      </label>
      <label class="share-extra-option" for="shareIncludeFoyer">
        <input type="checkbox" id="shareIncludeFoyer">
        <span><strong>Situation fiscale</strong><small>Situation du foyer, personnes à charge, revenus du conjoint et taux de prélèvement.</small></span>
      </label>
    </fieldset>
    <div class="alert alert-warn" style="margin-top:12px;">
      <span>${ICON.warn}</span><span>Les salaires sélectionnés sont toujours inclus. Le lien n'est pas chiffré ni protégé par mot de passe : toute personne qui le reçoit peut lire les données qu'il contient.</span>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn modal-btn-cancel" data-modal-cancel>Annuler</button>
      <button type="button" class="btn btn-primary" id="shareCreateBtn">Créer le lien</button>
    </div>`;
  const pending = openModal(html);
  const overlay = document.getElementById('modalOverlay');
  const confirm = overlay.querySelector('#shareCreateBtn');
  const updateAvailability = () => {
    confirm.disabled = overlay.querySelectorAll('.share-scenario-option input:checked').length === 0;
  };
  overlay.querySelectorAll('.share-scenario-option input').forEach(input => {
    input.addEventListener('change', updateAvailability);
  });
  overlay.querySelector('[data-modal-cancel]').addEventListener('click', () => closeModal(null));
  confirm.addEventListener('click', () => {
    const scenarioIds = [...overlay.querySelectorAll('.share-scenario-option input:checked')]
      .map(input => Number(input.value));
    closeModal({
      scenarioIds,
      includeDetails: overlay.querySelector('#shareIncludeDetails').checked,
      includeFoyer: overlay.querySelector('#shareIncludeFoyer').checked
    });
  });
  updateAvailability();
  return pending;
}

async function shareLink(){
  const options = await showShareOptionsModal();
  if(!options) return;
  const url = buildShareUrl(options);
  // Copie directe après le choix explicite des données à partager. Si le
  // presse-papiers est refusé, le lien reste accessible dans la modale de repli.
  if(navigator.clipboard && navigator.clipboard.writeText){
    try{
      await navigator.clipboard.writeText(url);
      showToastImpl('Lien copié dans le presse-papiers !');
      return;
    } catch(e){ /* on tente le repli ci-dessous */ }
  }
  if(legacyCopy(url)){
    showToastImpl('Lien copié dans le presse-papiers !');
    return;
  }
  showShareModal(url);
}

const shareState = loadShareState();
const persisted = loadPersistedState();
const loadedFromShare = !!shareState;
const initialSource = shareState || persisted;
// L'onboarding n'a de sens que tout premier chargement (aucun état enregistré,
// aucun lien partagé) ou juste après une réinitialisation — les deux cas
// arrivent ici, puisque ni le localStorage ni le hash de l'URL n'ont fourni
// quoi que ce soit à restaurer.
let showOnboarding = !initialSource;
// Ne pas persister le brut placeholder tant que la pop-up d'onboarding n'a
// pas été validée — même logique que pour un chargement depuis un lien
// partagé, pour ne jamais écraser silencieusement un état déjà enregistré.
let suppressAutosave = loadedFromShare || showOnboarding;

if(loadedFromShare){
  // On retire les données de partage de la barre d'adresse une fois lues —
  // évite de redéclencher ceci sur un simple rechargement et garde l'URL propre.
  history.replaceState(null, '', location.pathname + location.search);
}

let scenarios, refId, metric, openCardIds, displayAmt, displayPeriod, foyer;
if(initialSource){
  scenarios = initialSource.scenarios.map(sv => mkScenario(sv));
  idCounter = scenarios.length;
  refId = scenarios.some(s => s.id === initialSource.refId) ? initialSource.refId : scenarios[0].id;
  metric = METRIC_KEYS.includes(initialSource.metric) ? initialSource.metric : METRIC_DEFAUT;
  displayAmt = initialSource.displayAmt === 'brut' ? 'brut' : 'net';
  displayPeriod = initialSource.displayPeriod === 'an' ? 'an' : 'mois';
  const validIds = new Set(scenarios.map(s => s.id));
  openCardIds = new Set(Array.isArray(initialSource.openCardIds) ? initialSource.openCardIds.filter(id => validIds.has(id)) : []);
  foyer = sanitizeFoyer(initialSource.foyer);
} else {
  scenarios = defaultScenarios();
  refId = scenarios[0].id;
  metric = METRIC_DEFAUT;
  openCardIds = new Set();
  displayAmt = 'net';
  displayPeriod = 'mois';
  foyer = sanitizeFoyer(FOYER_DEFAUT);
}

const metricHints = {
  netImposable: 'La base retenue pour l\'impôt sur le revenu — utile pour anticiper votre déclaration.',
  annuelNet: 'Le total net sur l\'année, primes comprises, <em>avant</em> prélèvement à la source — pratique quand les salaires comparés n\'ont pas le même nombre de mensualités (ex. 13ᵉ mois).',
  netApresImpot: 'Le net après prélèvement à la source évalué par le modèle fiscal officiel Mon-entreprise / Urssaf selon les paramètres du foyer transmis.',
  netHoraire: 'Le net ramené aux heures réellement travaillées dans le mois — pratique pour comparer un 35h et un 39h sur une base commune.',
  brutHoraire: 'Le taux horaire de base du contrat, hors majoration des heures supplémentaires — le chiffre qu\'on retrouve en général sur une offre d\'emploi.'
};

function findScenario(id){ return scenarios.find(s => s.id === id); }
function heroValue(r){
  if(displayAmt === 'net'){
    const value = displayPeriod === 'mois' ? r.netApresImpot : r.annuelNetApresImpot;
    return Number.isFinite(value) ? value : null;
  }
  return displayPeriod === 'mois' ? r.m.brutTotal : r.a.brutTotal;
}
function heroLabel(){
  if(displayAmt === 'brut') return 'Brut ' + (displayPeriod === 'mois' ? 'mensuel' : 'annuel');
  return 'Net après impôt estimé ' + (displayPeriod === 'mois' ? 'mensuel' : 'annuel');
}
function heroPasValue(r){
  return displayPeriod === 'mois' ? r.m.netApres : r.a.netApres;
}
function heroPasShown(){
  return displayAmt === 'net';
}

// ---------- Rendu des cartes ----------
function num(id, key, uid, value, opts){
  const o = opts || {};
  return `<input type="text" inputmode="decimal" id="${id}" value="${String(value).replace('.', ',')}"
    data-id="${uid}" data-key="${key}"
    ${o.min !== undefined ? `data-min="${o.min}"` : ''}
    ${o.max !== undefined ? `data-max="${o.max}"` : ''}>`;
}

function renderCard(s, r, showRemove){
  const uid = s.id;
  const isRef = s.id === refId;
  const trWarn = !!(r && r.tr && r.tr.reintegre > 0.005);
  const calculationError = getCalculationError(s,foyer);
  const trMotifs = {
    sous50: 'Part patronale sous 50 % : vérifiez la valeur reconnue par le moteur Urssaf.',
    sur60: 'Part patronale au-delà de 60 % : vérifiez la valeur reconnue par le moteur Urssaf.',
    plafond: 'Le moteur Urssaf identifie une fraction de titres-restaurant non déductible.',
    api: 'Le moteur Urssaf identifie une part non déductible des frais professionnels transmis.'
  };
  const resultState = r ? 'ready' : (calculationError ? 'error' : 'pending');
  const resultText = r
    ? 'Calculé via l’API officielle Mon-entreprise (Urssaf).'
    : (calculationError || 'Calcul en attente de validation par l’API Urssaf.');
  return `
  <div class="card ${isRef ? 'is-ref' : ''} ${s.id === justAddedId ? 'card-enter' : ''}" data-card="${uid}" data-result-state="${resultState}">
    <div class="card-top">
      <button type="button" class="drag-handle" draggable="true" data-drag-handle="${uid}" aria-label="Déplacer la tuile ${esc(s.name)}. Utilisez les flèches gauche et droite pour la réordonner au clavier." aria-keyshortcuts="ArrowLeft ArrowRight" title="Cliquer et glisser pour réorganiser">⠿</button>
      <label class="sr-only" for="f-name-${uid}">Nom du salaire</label>
      <input class="name-input" id="f-name-${uid}" value="${esc(s.name)}" data-id="${uid}" data-key="name">
      ${isRef ? '<span class="ref-badge">référence</span>' : ''}
      ${showRemove ? `<button class="remove-btn" data-remove="${uid}" aria-label="Supprimer le salaire ${esc(s.name)}">✕</button>` : ''}
    </div>

    <div class="hero">
      <div class="hero-value" id="c-hero-${uid}" aria-live="polite">${r && heroValue(r) !== null ? fmt(heroValue(r)) : '—'}</div>
      <div class="hero-label" id="c-herolabel-${uid}">${heroLabel()}</div>
      <div class="hero-pas" id="c-heropas-${uid}" style="${heroPasShown() ? '' : 'display:none;'}">${r ? `Avant impôt : <strong>${fmt(heroPasValue(r))}</strong>` : 'Avant impôt : —'}</div>
      <div class="result-source ${calculationError ? 'result-error' : ''}" id="c-result-state-${uid}" role="status" ${r ? 'hidden' : ''}>${esc(resultText)}</div>
      <div class="result-source" id="c-result-warnings-${uid}" ${r && r.warnings && r.warnings.length ? '' : 'hidden'}>${r && r.warnings && r.warnings.length ? `<details><summary>Avertissements du moteur (${r.warnings.length})</summary><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}</div>
    </div>

    <div class="field-row">
      <label for="f-brut-${uid}">Salaire brut mensuel (€)</label>
      ${num(`f-brut-${uid}`,'brut',uid,s.brut,{min:0})}
    </div>

    <div class="sub-hint" id="rate-hint-${uid}" style="margin:-6px 0 14px;">${r ? `Taux effectif : <strong>${r.tauxEffectif.toFixed(1)} %</strong> du brut` : 'Taux effectif : —'}</div>

    <div class="field-row">
      <label>Base horaire</label>
      <div class="pill-toggle" data-durree-group="${uid}">
        <button type="button" data-duree="35" data-id="${uid}" aria-pressed="${s.dureeType==='35'}">35 h</button>
        <button type="button" data-duree="39" data-id="${uid}" aria-pressed="${s.dureeType==='39'}">39 h</button>
      </div>
      ${s.dureeType === '39' ? '<div class="sub-hint">Calcul fondé sur le droit commun : 4 h supplémentaires rémunérées par semaine, majorées à 25 %. Les taux particuliers des conventions collectives ne sont pas pris en compte. Les RTT ne sont pas pris en compte.</div>' : ''}
    </div>

    <details class="more">
      <summary>Détails avancés</summary>
      <div class="more-body">
        <div class="section-tag">Lieu de travail</div>
    <div class="field-row">
      <label for="f-commune-${uid}">Commune de l’établissement</label>
      <input type="text" id="f-commune-${uid}" value="${esc(communeLabel(s))}" data-id="${uid}" data-key="commune" maxlength="120" autocomplete="off" aria-autocomplete="list" aria-controls="commune-suggestions-${uid}">
      <div class="commune-suggestions" id="commune-suggestions-${uid}" role="listbox" hidden></div>
      <div class="sub-hint" id="commune-hint-${uid}">${s.codePostal && s.departement ? `Lieu identifié : ${esc(s.codePostal)} — ${esc(s.departement)}. Le nom de la commune et son département sont transmis à l’API Urssaf.` : 'Choisissez une suggestion pour confirmer le code postal et le département.'}</div>
    </div>
    <div class="section-tag">Mutuelle</div>
        <div class="two-col">
          <div class="field-row">
            <label for="f-mutuelle-${uid}">Part salarié (€ / mois)</label>
            ${num(`f-mutuelle-${uid}`,'mutuelle',uid,s.mutuelle,{min:0})}
          </div>
          <div class="field-row">
            <label for="f-mutuelle-pat-${uid}">Part employeur (€ / mois)</label>
            ${num(`f-mutuelle-pat-${uid}`,'mutuellePat',uid,s.mutuellePat,{min:0})}
          </div>
        </div>
        <div class="sub-hint">Les deux parts sont transmises séparément au moteur Urssaf.</div>
        <div class="section-tag">Titres restaurant</div>
        <div class="three-col">
          <div class="field-row"><label for="f-jours-${uid}">Jours/mois</label>${num(`f-jours-${uid}`,'joursResto',uid,s.joursResto,{min:0,max:31})}</div>
          <div class="field-row"><label for="f-valeur-${uid}">Valeur (€)</label>${num(`f-valeur-${uid}`,'valeurResto',uid,s.valeurResto,{min:0,max:500})}</div>
          <div class="field-row"><label for="f-part-${uid}">Part salarié (%)</label>${num(`f-part-${uid}`,'partResto',uid,s.partResto,{min:40,max:50})}</div>
        </div>
        <div class="alert alert-warn" id="c-trwarn-${uid}" style="${trWarn ? '' : 'display:none;'}">
          <span>${ICON.warn}</span><span id="c-trwarn-text-${uid}">${trWarn ? (trMotifs[r.tr.motif] || trMotifs.api) : ''}</span>
        </div>
        <div class="section-tag">Mensualités &amp; primes</div>
        <div class="two-col">
          <div class="field-row">
            <label for="f-nbmois-${uid}">Mensualités / an</label>
            ${num(`f-nbmois-${uid}`,'nbMois',uid,s.nbMois,{min:1,max:24})}
          </div>
          <div class="field-row">
            <label for="f-primes-${uid}">Primes annuelles (€)</label>
            ${num(`f-primes-${uid}`,'primes',uid,s.primes,{min:0})}
          </div>
        </div>
        <div class="sub-hint">La version actuelle calcule 12 mensualités sans prime libre. Un scénario avec 13ᵉ/14ᵉ mois ou prime reste indisponible tant que cette donnée n'est pas raccordée à l'API Urssaf.</div>
      </div>
    </details>
  </div>`;
}

// ---------- Carte fantôme d'ajout de salaire ----------
function renderAddCard(){
  return `
  <button type="button" class="card card-add" id="addScenario" aria-label="Ajouter un salaire">
    <span class="card-add-icon">${ICON.plus}</span>
    <span class="card-add-label">Ajouter un salaire</span>
  </button>`;
}

// ---------- Graphique empilé de répartition ----------
const STACK_COLORS = { cotis:'var(--stack-cotis)', mutuelle:'var(--gold)', tr:'var(--stack-tr)', net:'var(--accent)' };

function renderStack(computed){
  const sorted = [...computed].sort((a,b) => b.r.m.netApres - a.r.m.netApres);
  const maxBrut = Math.max(...computed.map(x => x.r.m.brutTotal), 1);
  const maxPx = 240;
  const ref = computed.find(x => x.s.id === refId) || computed[0];
  return sorted.map(({s, r}) => {
    const m = r.m;
    const cotis = m.cotisNettes, mutuelle = m.mutuelle, tr = r.tr.totalSalarie;
    const net = m.netApres, netSansTR = m.netSocial, brut = m.brutTotal;
    const scale = maxPx / maxBrut, delta = net - ref.r.m.netApres;
    const cls = delta > 0 ? 'pos' : (delta < 0 ? 'neg' : '');
    const pxCotis = Math.round(cotis * scale), pxMutuelle = Math.round(mutuelle * scale);
    const pxTr = Math.round(tr * scale), pxNet = Math.max(22, Math.round(net * scale));
    const barHtml = `
      <div class="stack-bar">
        <div class="stack-seg stack-seg-cotis" style="height:${pxCotis}px" title="Cotisations sociales : ${fmt(cotis)}" role="img" aria-label="Cotisations sociales : ${fmt(cotis)}"></div>
        <div class="stack-seg stack-seg-mutuelle" style="height:${pxMutuelle}px" title="Mutuelle : ${fmt(mutuelle)}" role="img" aria-label="Mutuelle : ${fmt(mutuelle)}"></div>
        <div class="stack-seg stack-seg-tr" style="height:${pxTr}px" title="Titres restaurant (part salariale) : ${fmt(tr)}" role="img" aria-label="Titres restaurant, part salariale : ${fmt(tr)}"></div>
        <div class="stack-seg stack-seg-net" style="height:${pxNet}px" title="Net : ${fmt(net)}" role="img" aria-label="Net : ${fmt(net)}"><span class="stack-net-tag">net</span></div>
      </div>`;
    return `
    <div class="stack-col ${s.id === refId ? 'is-ref' : ''} ${s.id === justAddedId ? 'card-enter' : ''}" ${s.id !== refId ? `data-setref="${s.id}" role="button" tabindex="0" aria-label="Définir ${esc(s.name)} comme salaire de référence"` : 'aria-current="true"'}>
      <div class="stack-brut">brut ${fmt(brut)}</div>${barHtml}
      <div class="stack-ref-row"><span class="stack-ref-dot ${s.id === refId ? 'is-ref' : ''}" aria-hidden="true"></span><span class="stack-name" title="${esc(s.name)}">${esc(s.name)}</span></div>
      <div class="stack-net">${fmt(net)}</div>
      ${tr > 0.5 ? `<div class="stack-net-notr">sans TR : ${fmt(netSansTR)}</div>` : ''}
      <div class="stack-delta ${cls}">${fmtSigned(delta)}</div>
    </div>`;
  }).join('');
}

function renderStackLegend(){
  return `
  <div class="legend-item"><span class="legend-swatch" style="background:${STACK_COLORS.net}"></span>Net</div>
  <div class="legend-item"><span class="legend-swatch" style="background:${STACK_COLORS.tr}"></span>Titres restaurant</div>
  <div class="legend-item"><span class="legend-swatch" style="background:${STACK_COLORS.mutuelle}"></span>Mutuelle</div>
  <div class="legend-item"><span class="legend-swatch" style="background:${STACK_COLORS.cotis}"></span>Cotisations sociales</div>`;
}

function renderWaterfall(computed){
  const { s, r } = computed[0];
  const m = r.m;
  const brut = Math.max(0, m.brutTotal);
  const net = Math.max(0, m.netApres);
  const deductions = Math.max(0, brut - net);
  const ratio = brut > 0 ? Math.max(0, Math.min(100, net / brut * 100)) : 0;
  const cotis = Math.max(0, m.cotisNettes);
  const mutuelle = Math.max(0, m.mutuelle);
  const tr = Math.max(0, r.tr.totalSalarie);
  const netSansTR = m.netSocial;
  const trValeurFaciale = r.tr.totalSalarie + r.tr.totalEmployeur;
  const trNote = tr > 0.5
    ? `Sans TR : <strong>${fmt(netSansTR)}</strong> · TR perçus : <strong>${fmt(trValeurFaciale)}</strong>`
    : '';
  return `
  <div class="waterfall">
    <div class="wf-stack" role="img" aria-label="Salaire brut : ${fmt(brut)} ; net avant impôt : ${fmt(net)} ; retenues sur le brut : ${fmt(deductions)}">
      <span class="wf-stack-net" style="width:${ratio.toFixed(3)}%"></span>
      <span class="wf-stack-deductions" style="width:${(100-ratio).toFixed(3)}%"></span>
    </div>
    <div class="wf-breakdown">
      <div class="wf-breakdown-item">
        <span class="wf-key wf-key-net" aria-hidden="true"></span>
        <div><strong>${fmt(net)}</strong><span>Net avant impôt</span></div>
      </div>
      <div class="wf-breakdown-item">
        <span class="wf-key wf-key-deductions" aria-hidden="true"></span>
        <div><strong>${fmt(deductions)}</strong><span>Retenues sur le brut</span></div>
      </div>
    </div>
    <p class="wf-components">Dont : cotisations sociales ${fmt(cotis)} · mutuelle ${fmt(mutuelle)} · titres-restaurant (part salarié) ${fmt(tr)}</p>
    ${trNote ? `<p class="wf-note">${trNote}</p>` : ''}
  </div>`;
}

function renderInsight(computed){
  if(computed.length < 2) return '';
  const ref = computed.find(x => x.s.id === refId) || computed[0];
  const others = computed.filter(x => x.s.id !== refId);
  if(!others.length) return '';
  const isHourly = HOURLY_METRICS.has(metric);
  const valueOf = x => Number(x.r[metric]) || 0;
  const best = others.reduce((a,b) => valueOf(b) > valueOf(a) ? b : a);
  const delta = valueOf(best) - valueOf(ref);
  const unit = isHourly ? 'par heure' : metric === 'annuelNet' ? 'par an' : 'par mois';
  const metricLabel = {
    netImposable:'net imposable', annuelNet:'net annuel',
    netApresImpot:'net après impôt', netHoraire:'net horaire',
    brutHoraire:'brut horaire'
  }[metric] || 'valeur sélectionnée';
  const format = isHourly ? fmtHoraire : fmt;
  if(Math.abs(delta) < (isHourly ? 0.01 : 1)){
    return `<div class="insight neutral">Ces salaires donnent à peu près le même ${metricLabel}.</div>`;
  }
  return `<div class="insight"><strong>${esc(best.s.name)}</strong> donne ${format(Math.abs(delta))} de ${delta > 0 ? 'plus' : 'moins'} en ${metricLabel} ${unit} que <strong>${esc(ref.s.name)}</strong>.</div>`;
}

const HOURLY_METRICS = new Set(['netHoraire', 'brutHoraire']);

function renderBars(computed){
  const ref = computed.find(x => x.s.id === refId) || computed[0];
  const isHourly = HOURLY_METRICS.has(metric);
  const fmtV = isHourly ? fmtHoraire : fmt;
  const fmtD = isHourly ? fmtHoraireSigned : fmtSigned;
  const vals = computed.map(x => x.r[metric]);
  const maxVal = Math.max(...vals.map(v => Math.abs(v)), 1);
  return computed.map(({s, r}) => {
    const v = r[metric];
    const pct = Math.max(3, Math.round((Math.abs(v)/maxVal)*100));
    const delta = v - ref.r[metric];
    const cls = delta > 0 ? 'pos' : (delta < 0 ? 'neg' : '');
    return `
    <div class="bar-row">
      <div class="bar-top">
        <span class="bar-name" title="${esc(s.name)}">${esc(s.name)}${s.id===refId ? ' · réf.' : ''}</span>
        <span class="bar-value"><span>${fmtV(v)}</span><span class="bar-delta ${cls}">${fmtD(delta)}</span></span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function renderAlerts(computed){
  const out = [];
  const nbMoisSet = new Set(computed.map(x => x.s.nbMois));
  // Le graphique affiche toujours du net mensuel : l'écart est trompeur dès que
  // les salaires comparés n'ont pas le même nombre de mensualités.
  if(nbMoisSet.size > 1){
    out.push(`<div class="alert alert-info"><span>${ICON.info}</span><span>Ces salaires n'ont pas le même nombre de mois de paie. Comparez le <strong>net annuel</strong> pour un écart représentatif.</span></div>`);
  }
  return out.join('');
}


function benchmarkDelta(value, reference){
  const delta = value - reference;
  const pct = reference > 0 ? delta / reference * 100 : 0;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return { amount: sign + fmt(Math.abs(delta)), pct: (delta > 0 ? '+' : '') + pct.toLocaleString('fr-FR',{maximumFractionDigits:1,minimumFractionDigits:1}) + ' %', positive: delta >= 0 };
}
function renderBenchmarks(computed){
  const item=computed.find(x=>x.s.id===refId);
  if(!item) return '';
  const {s,r}=item;
  const weeklyHours=Number(s.dureeType), userMonthlyHours=weeklyHours*52/12;
  const medianNetBeforeTax=2238, medianNetHourly=medianNetBeforeTax/HEURES_BASE;
  const factor=maquetteComparisonPeriod==='hour'?1:maquetteComparisonPeriod==='year'?userMonthlyHours*12:userMonthlyHours;
  const unit=maquetteComparisonPeriod==='hour'?'heure':maquetteComparisonPeriod==='year'?'an':'mois';
  const format=maquetteComparisonPeriod==='hour'?fmtHoraire:fmt;
  const medianValue=medianNetHourly*factor;
  const smicResult=getCachedSmicResult();
  const smicGross=getSmicGross();
  const smicGrossTarget=smicGross===null?null:getSmicGrossTarget(smicGross,weeklyHours);
  const smicHourlyGross=smicGross/HEURES_BASE;
  const userNetBeforeTax=r?Math.max(0,r.netApres):null;
  const userNetHourly=userNetBeforeTax===null?null:(userMonthlyHours>0?userNetBeforeTax/userMonthlyHours:0);
  const userValue=userNetHourly===null?null:userNetHourly*factor;
  const gapText=value=>(value>=0?'+':'−')+format(Math.abs(value))+' / '+unit;
  const gapClass=value=>value>=0?'benchmark-positive':'benchmark-negative';
  const durationLabel=weeklyHours.toLocaleString('fr-FR')+' h';
  const smicNetHourly=smicResult?Math.max(0,smicResult.netApres)/userMonthlyHours:null;
  const smicValue=smicNetHourly===null?null:smicNetHourly*factor;
  const smicGap=userValue===null||smicValue===null?null:userValue-smicValue;
  const medianGap=userValue===null?null:userValue-medianValue;
  const smicStatus=officialSmicState.status==='error'
    ? 'Repère SMIC indisponible via l’API officielle. Réessayez le calcul.'
    : 'Le repère net sera récupéré auprès de l’Urssaf après votre autorisation.';
  const smicCard=`
      <article class="benchmark-item">
        <div class="benchmark-label">SMIC net</div>
        <div class="benchmark-value">${smicValue===null?'À calculer':format(smicValue)}</div>
        <div class="benchmark-meta">${smicValue===null?esc(smicStatus):'Par '+unit+' · repère '+durationLabel}</div>
        ${smicGap===null?'<div class="benchmark-result">Écart disponible après calcul</div>':'<div class="benchmark-result '+gapClass(smicGap)+'">'+gapText(smicGap)+'</div>'}
        ${smicResult?`<details class="benchmark-details"><summary>Comment est calculé l’écart ?</summary>
          <p>Le SMIC net est estimé par l’API officielle Mon-entreprise / Urssaf sur une base de ${durationLabel}${weeklyHours===39?' : 35 h au SMIC + 4 h supplémentaires hebdomadaires majorées à 25 %':''}. Pour les périodes mensuelle et annuelle, le repère est calculé sur cette même durée. Il est calculé sans mutuelle ni titres-restaurant.</p>
          <p>${weeklyHours===39?`Brut mensuel de référence à 35 h : ${fmt(smicGross)}. Brut total estimé à 39 h : ${fmt(smicGrossTarget)}, avec 4 h supplémentaires hebdomadaires majorées à 25 %.`:`Brut mensuel de référence : ${fmt(smicGross)}.`} Taux horaire brut de base : ${fmtHoraire(smicHourlyGross)}. Règle consultée le ${officialSmicState.checkedAt?new Date(officialSmicState.checkedAt).toLocaleDateString('fr-FR'):'—'}.</p>
          <p><a href="https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/montant-smic.html" target="_blank" rel="noopener noreferrer">Source officielle : Urssaf — montant du SMIC</a></p>
        </details>`:''}
      </article>`;
  const medianCard=`
      <article class="benchmark-item">
        <div class="median-card-head"><div class="benchmark-label">Médiane des salaires privés</div><span class="geo-inline"><span>Zone</span><strong>France</strong></span></div>
        <div class="benchmark-value">${format(medianValue)}</div>
        <div class="benchmark-meta">Par ${unit} · INSEE 2025 · France</div>
        ${medianGap===null?'<div class="benchmark-result">Écart disponible après calcul</div>':'<div class="benchmark-result '+gapClass(medianGap)+'">'+gapText(medianGap)+'</div>'}
        <details class="benchmark-details"><summary>Que signifie la médiane ?</summary>
          <p>Données INSEE 2025, publiées en 2026, pour la France. La médiane publiée est de 2 238 € nets mensuels en EQTP. Le taux horaire est ramené à 151,67 h/mois ; les périodes mensuelle et annuelle sont ajustées à la durée du contrat comparé (${durationLabel}).</p>
          <p>Le champ couvre les salariés du privé en France, y compris alternants, stagiaires et contrats aidés ; il exclut l’agriculture et les particuliers employeurs. Il est plus large que le périmètre CDI non-cadre d’OnNet.</p>
          <p>Source : <a href="https://www.insee.fr/fr/statistiques/9087193" target="_blank" rel="noopener noreferrer">INSEE, salaires dans le secteur privé en 2025</a>.</p>
        </details>
      </article>`;
  return '<div class="benchmark-grid">'+smicCard+medianCard+'</div>';
}
// ---------- Rendu ----------
let maquetteComparisonPeriod='hour';
function renderMaquetteControls(computedOverride){
  const benchmarkPanel=document.querySelector('#comparePanel .benchmark-panel');
  const benchmarkMount=document.getElementById('benchmarkMount');
  if(benchmarkPanel && benchmarkMount && benchmarkPanel.parentElement!==benchmarkMount) benchmarkMount.appendChild(benchmarkPanel);
  const tabs=document.getElementById('maquetteOfferTabs');
  if(!tabs) return;
  tabs.replaceChildren();
  scenarios.forEach((scenario,index)=>{
    const button=document.createElement('button');
    button.type='button';button.className='offer-tab'+(scenario.id===refId?' active':'');
    button.setAttribute('aria-pressed',String(scenario.id===refId));
    button.append(document.createTextNode(scenario.name));
    const small=document.createElement('small');small.textContent=index===0?'Actuelle':'Proposition';button.append(small);
    button.addEventListener('click',()=>{refId=scenario.id;render();});
    tabs.append(button);
  });
  const selected=findScenario(refId)||scenarios[0];
  document.querySelectorAll('[data-maquette-period]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.maquettePeriod===maquetteComparisonPeriod)));
  const period=document.getElementById('mainSalaryPeriod');
  const gross=document.getElementById('mainSalaryGross');
  const hours=document.getElementById('mainSalaryHours');
  if(selected && period && gross && hours && ![period,gross,hours].includes(document.activeElement)){
    period.value='month';gross.value=String(Math.round(Number(selected.brut)*100)/100);hours.value=selected.dureeType;
  }
  const selectedId=(findScenario(refId)||scenarios[0])?.id;
  const computed=(computedOverride||getCurrentComputed()).find(x=>x.s.id===selectedId);
  const mutuelleText=document.getElementById('mainSalaryMutuelleText');
  if(mutuelleText && selected) mutuelleText.textContent=fmt(selected.mutuelle||0)+' / mois déduits de votre net (part salarié).';
  const applyDeclaredSalary=()=>{
    const scenario=findScenario(refId)||scenarios[0];
    const raw=Number(gross?.value);
    if(!scenario||!Number.isFinite(raw)||raw<=0||raw>1200000) return;
    scenario.brut=period?.value==='year'?Math.round(raw/12*100)/100:raw;
    scenario.dureeType=hours?.value==='39'?'39':'35';
    // La modification explicite du formulaire vaut accord à la transmission
    // annoncée juste au-dessus des champs.
    urssafConsentGranted = true;
    saveState();
    scheduleUrssafCalculations(false,false);
  };
  // Les champs remplacent l’ancien bouton : toute modification valide
  // met à jour le scénario et relance le calcul après un court délai.
  if(gross){
    gross.oninput=applyDeclaredSalary;
    gross.onchange=applyDeclaredSalary;
  }
  if(period) period.onchange=applyDeclaredSalary;
  if(hours) hours.onchange=applyDeclaredSalary;
  const summary=document.getElementById('maquetteYourSalary');
  if(summary){
    if(!computed || !computed.r){summary.innerHTML='<div class="benchmark-your-salary"><span>Votre net avant impôt</span><strong>À calculer</strong><div class="benchmark-meta benchmark-comparison-base">Le résultat apparaîtra après le calcul de votre salaire.</div></div>';}
    else{
      const weekly=Number(selected.dureeType), hoursMonth=weekly*52/12;
      const hourly=hoursMonth>0?computed.r.netApres/hoursMonth:0;
      const factor=maquetteComparisonPeriod==='hour'?1:maquetteComparisonPeriod==='year'?weekly*52:selected.dureeType*52/12;
      const value=hourly*factor, unit=maquetteComparisonPeriod==='hour'?'heure':maquetteComparisonPeriod==='year'?'an':'mois';
      const amount=maquetteComparisonPeriod==='hour'?fmtHoraire(value):fmt(value);
      summary.innerHTML='<div class="benchmark-your-salary"><span class="sr-only">Votre net avant impôt</span><span><b>VOUS</b>　'+esc(selected.name)+'</span><strong>'+amount+' <small>/ '+unit+'</small></strong><div class="benchmark-meta benchmark-comparison-base">'+fmt(selected.brut)+' brut / mois · '+weekly+' h · mutuelle salarié : '+fmt(selected.mutuelle||0)+' / mois</div></div>';
    }
  }
  const status=document.getElementById('urssafStatus'), mount=document.getElementById('maquetteUrssafMount');
  if(status && mount && status.parentElement!==mount) mount.appendChild(status);
}

function renderComparisonChart(computed){
  const isSingle = computed.length === 1;
  const hasSalaryResults = computed.length > 0 && computed.every(x => !!x.r);
  const allReady = hasSalaryResults && !!getCachedSmicResult();
  const comparePanel = document.getElementById('comparePanel');
  if(comparePanel) comparePanel.hidden = !hasSalaryResults;

  if(comparePanel){
    const chartElements = ['#stackHint','#insightBox','.stack-chart-scroll','#stackLegend','#barsAlerts'];
    chartElements.forEach(selector => {
      const element = comparePanel.querySelector(selector);
      if(element) element.hidden = !allReady;
    });
  }

  const stackChartEl = document.getElementById('stackChart');
  if(!stackChartEl) return;
  if(allReady){
    document.getElementById('stackHint').textContent = isSingle
      ? `Salaire brut de ${fmt(computed[0].r.m.brutTotal)} par mois.`
      : 'Cliquez sur une carte pour la définir comme référence.';
    document.getElementById('insightBox').innerHTML = renderInsight(computed);
    stackChartEl.className = isSingle ? '' : 'stack-chart';
    stackChartEl.innerHTML = isSingle ? renderWaterfall(computed) : renderStack(computed);
    document.getElementById('stackLegend').innerHTML = isSingle ? '' : renderStackLegend();
    document.getElementById('barsBody').innerHTML = renderBars(computed);
    document.getElementById('barsAlerts').innerHTML = renderAlerts(computed);
  } else {
    document.getElementById('stackHint').textContent = 'Les résultats s’affichent après validation par l’API officielle Mon-entreprise (Urssaf).';
    document.getElementById('insightBox').innerHTML = '';
    stackChartEl.className = '';
    stackChartEl.innerHTML = '';
    document.getElementById('stackLegend').innerHTML = '';
    document.getElementById('barsBody').innerHTML = '';
    document.getElementById('barsAlerts').innerHTML = '';
  }
}

function render(){
  if(!scenarios.some(s => s.id === refId)) refId = scenarios[0].id;
  const computed = getCurrentComputed();
  renderComparisonChart(computed);
  updateRaiseBaseName();
  bindRefPickers();
  document.getElementById('benchmarkBody').innerHTML = renderBenchmarks(computed);
  renderMaquetteControls(computed);
  updateFoyerImpot(computed);
  syncFoyerUI();
  document.getElementById('refSelect').innerHTML = scenarios
    .map(s => `<option value="${s.id}" ${s.id===refId?'selected':''}>${esc(s.name)}</option>`).join('');
  document.getElementById('cardsBody').innerHTML =
    computed.map(({s,r}) => renderCard(s, r, scenarios.length > 1)).join('') + renderAddCard();
  bindCardDragAndDrop();
  document.querySelectorAll('#cardsBody .card-enter, #stackChart .card-enter').forEach(el => {
    el.addEventListener('animationend', () => el.classList.remove('card-enter'), { once:true });
  });

  document.querySelectorAll('.metric-toggle button').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.metric === metric ? 'true' : 'false');
  });
  setHTML('metricHint', metricHints[metric] || '');

  document.querySelectorAll('.card').forEach(cardEl => {
    const id = parseInt(cardEl.dataset.card, 10);
    const d = cardEl.querySelector('details.more');
    if(d){
      if(openCardIds.has(id)) d.open = true;
      d.addEventListener('toggle', () => {
        if(d.open) openCardIds.add(id); else openCardIds.delete(id);
        saveState();
      });
    }
  });

  bindScenarioInputs();
  updateNavButtons();
  saveState();
  suppressAutosave = false;
  justAddedId = null;
  updateUrssafStatus(computed);
  renderMaquetteControls(computed);
  scheduleUrssafCalculations(false,false);
}

function bindCardDragAndDrop(){
  const cardsBody = document.getElementById('cardsBody');
  if(cardsBody.dataset.dragBound) return;
  cardsBody.dataset.dragBound = 'true';

  const clearDropTargets = () => {
    cardsBody.querySelectorAll('.drop-before, .drop-after').forEach(card => {
      card.classList.remove('drop-before', 'drop-after');
    });
  };

  cardsBody.addEventListener('dragstart', e => {
    const handle = e.target.closest('[data-drag-handle]');
    const card = handle && handle.closest('.card[data-card]');
    if(!card) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.card);
    requestAnimationFrame(() => card.classList.add('is-dragging'));
  });

  cardsBody.addEventListener('dragover', e => {
    const target = e.target.closest('.card[data-card]');
    if(!target || target.classList.contains('card-add')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropTargets();
    const before = e.clientX < target.getBoundingClientRect().left + target.offsetWidth / 2;
    target.classList.add(before ? 'drop-before' : 'drop-after');
  });

  cardsBody.addEventListener('drop', e => {
    const target = e.target.closest('.card[data-card]');
    if(!target || target.classList.contains('card-add')) return;
    e.preventDefault();
    const draggedId = Number(e.dataTransfer.getData('text/plain'));
    const targetId = Number(target.dataset.card);
    if(!Number.isInteger(draggedId) || draggedId === targetId) return clearDropTargets();

    const from = scenarios.findIndex(s => s.id === draggedId);
    if(from < 0) return clearDropTargets();
    const before = e.clientX < target.getBoundingClientRect().left + target.offsetWidth / 2;
    const [moved] = scenarios.splice(from, 1);
    const targetIndex = scenarios.findIndex(s => s.id === targetId);
    if(targetIndex < 0){
      scenarios.splice(from, 0, moved);
      return clearDropTargets();
    }
    scenarios.splice(targetIndex + (before ? 0 : 1), 0, moved);
    render();
  });

  cardsBody.addEventListener('dragend', e => {
    const card = e.target.closest('.card[data-card]');
    if(card) card.classList.remove('is-dragging');
    clearDropTargets();
  });

  cardsBody.addEventListener('keydown', e => {
    const handle = e.target.closest('[data-drag-handle]');
    if(!handle || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();

    const id = Number(handle.dataset.dragHandle);
    const from = scenarios.findIndex(s => s.id === id);
    const to = from + (e.key === 'ArrowLeft' ? -1 : 1);
    if(from < 0 || to < 0 || to >= scenarios.length) return;

    const [moved] = scenarios.splice(from, 1);
    scenarios.splice(to, 0, moved);
    render();
    const nextHandle = cardsBody.querySelector(`[data-drag-handle="${id}"]`);
    if(nextHandle) nextHandle.focus();
    showToastImpl(`${moved.name} déplacé à la position ${to + 1} sur ${scenarios.length}.`);
  });
}

function bindScenarioInputs(){
  document.querySelectorAll('#cardsBody [data-key]').forEach(el => {
    if(el.type === 'checkbox'){
      el.addEventListener('change', onCheck);
    } else if(el.tagName === 'SELECT'){
      el.addEventListener('change', onStructural);
    } else {
      el.addEventListener('input', onInput);
      el.addEventListener('blur', onBlurClamp);
    }
  });
  document.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => removeScenario(parseInt(btn.dataset.remove, 10)));
  });
  document.querySelectorAll('[data-duree]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id, 10);
      const s = findScenario(id);
      if(!s) return;
      if(s.dureeType === btn.dataset.duree) return;
      s.dureeType = btn.dataset.duree;
      render();
    });
  });
}

function bindRefPickers(){
  document.querySelectorAll('[data-setref]').forEach(el => {
    el.addEventListener('click', () => {
      refId = parseInt(el.dataset.setref, 10);
      render();
    });
    el.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        refId = parseInt(el.dataset.setref, 10);
        render();
      }
    });
  });
}

// ---------- Mise à jour ciblée (ne touche jamais aux champs en cours de saisie) ----------
// ---------- Module « Foyer fiscal » (réglage global, pas par salaire) ----------
function foyerResume(){
  if(foyer.mode === 'taux') return `Taux personnel : ${foyer.pasRate.toFixed(1)} %`;
  const n = foyer.personnesCharge;
  const situationLabel = foyer.situation === 'commun' ? 'Marié(e) / PACS'
    : foyer.situation === 'concubinage' ? 'Concubinage (imposition séparée)' : 'Seul(e)';
  const bouts = [situationLabel];
  bouts.push(n === 0 ? 'sans personne à charge'
                     : (n === 1 ? '1 personne à charge' : `${n} personnes à charge`));
  if(foyer.parentIsole) bouts.push('parent isolé (case T)');
  if(foyer.couple && foyer.autresRevenus > 0) bouts.push(`conjoint ${fmt(foyer.autresRevenus)}/an`);
  return bouts.join(', ');
}

// L'impôt affiché dans le module suit le salaire de référence.
function updateFoyerImpot(computed){
  const ref = computed.find(x => x.s.id === refId) || computed[0];
  if(ref && ref.r) setText('foyerImpot', `${fmt(ref.r.impotAnnuel/12)} / mois (${Number(ref.r.tauxImpot || 0).toFixed(1)} %)`);
  else setText('foyerImpot', '—');
}

function syncFoyerUI(){
  document.querySelectorAll('#foyerMode button').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.mode === foyer.mode ? 'true' : 'false');
  });
  setShown('foyerBaremeFields', foyer.mode !== 'taux');
  setShown('foyerTauxFields', foyer.mode === 'taux');

  document.querySelectorAll('#foyerSituation button').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.foyer === foyer.situation ? 'true' : 'false');
  });
  // Les revenus du conjoint ne sont inclus que pour un foyer fiscal commun.
  // En concubinage, les deux déclarations restent séparées.
  setShown('foyerConcubinageInfo', foyer.situation === 'concubinage');
  const parentIsolePossible = foyer.situation === 'seul' && foyer.personnesCharge > 0;
  setShown('foyerParentIsoleRow', parentIsolePossible);
  const parentIsoleInput = document.getElementById('foyerParentIsole');
  if(parentIsoleInput) parentIsoleInput.checked = parentIsolePossible && foyer.parentIsole;
  if(!parentIsolePossible) foyer.parentIsole = false;
  setShown('foyerConjointRow', foyer.couple);
  const alerteBareme = foyer.couple && !(foyer.autresRevenus > 0);
  setShown('foyerWarn', alerteBareme);

  // Le taux saisi vaut pour la situation actuelle : il devient trompeur dès
  // qu'on compare des salaires de brut différent (le taux réel monte avec le
  // revenu, un taux constant ne peut pas en rendre compte).
  const brutsDistincts = new Set(scenarios.map(s => s.brut)).size > 1;
  const alerteTaux = foyer.mode === 'taux' && brutsDistincts;
  setShown('foyerPasWarn', alerteTaux);

  const alerte = foyer.mode === 'taux' ? alerteTaux : alerteBareme;
  // Le bloc étant replié au chargement, l'alerte doit aussi remonter dans le
  // bandeau : autrement elle n'apparaît qu'à ceux qui l'ouvrent déjà.
  let resume = foyerResume();
  if(alerte){
    resume = foyer.mode === 'taux'
      ? 'Taux personnel — écart entre salaires optimiste'
      : 'Marié/PACS — revenus du conjoint à renseigner';
  }
  setText('foyerModuleDesc', resume);
  const desc = document.getElementById('foyerModuleDesc');
  if(desc) desc.classList.toggle('is-warn', alerte);

  setHTML('foyerImpotHint', foyer.mode === 'taux'
    ? `Le taux personnalisé transmis à l’Urssaf s’applique selon les règles de son modèle fiscal. Ce taux est constant dans vos scénarios : il peut donc limiter la pertinence d’une comparaison entre salaires très différents.`
    : `Estimation calculée par le modèle fiscal officiel Mon-entreprise / Urssaf à partir du foyer renseigné. Le modèle est simplifié et certaines règles sont signalées comme expérimentales ; ce résultat ne remplace pas un avis d’imposition. Vérifiez les avertissements éventuels du moteur.`);
}

function bindFoyerModule(){
  document.querySelectorAll('#foyerMode button').forEach(btn => {
    btn.addEventListener('click', () => {
      foyer.mode = btn.dataset.mode === 'taux' ? 'taux' : 'bareme';
      syncFoyerUI();
      updateComputed();
    });
  });
  document.querySelectorAll('#foyerSituation button').forEach(btn => {
    btn.addEventListener('click', () => {
      foyer.situation = ['seul','commun','concubinage'].includes(btn.dataset.foyer)
        ? btn.dataset.foyer : 'seul';
      foyer.couple = foyer.situation === 'commun';
      if(!foyer.couple){
        foyer.autresRevenus = 0;
        const champ = document.getElementById('foyerConjoint');
        if(champ) champ.value = '0';
      }
      if(foyer.situation !== 'seul') foyer.parentIsole = false;
      syncFoyerUI();
      updateComputed();
    });
  });
  const charges = document.getElementById('foyerCharges');
  if(charges) charges.addEventListener('change', () => {
    foyer.personnesCharge = Math.max(0, Math.min(4, Math.floor(parseNum(charges.value))));
    if(foyer.personnesCharge === 0) foyer.parentIsole = false;
    syncFoyerUI();
    updateComputed();
  });
  const parentIsole = document.getElementById('foyerParentIsole');
  if(parentIsole) parentIsole.addEventListener('change', () => {
    foyer.parentIsole = parentIsole.checked;
    syncFoyerUI();
    updateComputed();
  });
  const conjoint = document.getElementById('foyerConjoint');
  if(conjoint) conjoint.addEventListener('input', () => {
    if(!validateNumericInput(conjoint, false)) return;
    foyer.autresRevenus = Math.max(0, parseNum(conjoint.value));
    syncFoyerUI();
    updateComputed();
  });
  const pasRate = document.getElementById('foyerPasRate');
  if(pasRate) pasRate.addEventListener('input', () => {
    if(!validateNumericInput(pasRate, false)) return;
    foyer.pasRate = clamp(parseNum(pasRate.value), 0, 100);
    syncFoyerUI();
    updateComputed();
  });
  // Refléter l'état restauré (localStorage ou lien partagé) dans les champs.
  if(charges) charges.value = String(Math.min(4, foyer.personnesCharge));
  if(conjoint) conjoint.value = String(foyer.autresRevenus);
  if(pasRate) pasRate.value = String(foyer.pasRate);
  syncFoyerUI();
}

function setText(id, txt){ const el = document.getElementById(id); if(el) el.textContent = txt; }
function setHTML(id, html){ const el = document.getElementById(id); if(el) el.innerHTML = html; }
function setShown(id, shown){ const el = document.getElementById(id); if(el) el.style.display = shown ? '' : 'none'; }

function updateComputed(options = {}){
  const computed = getCurrentComputed();
  renderComparisonChart(computed);
  bindRefPickers();
  document.getElementById('benchmarkBody').innerHTML = renderBenchmarks(computed);
  renderMaquetteControls(computed);
  updateFoyerImpot(computed);
  syncFoyerUI();

  computed.forEach(({s, r}) => {
    const u = s.id;
    const basisRow = document.getElementById(`c-13m-basis-row-${u}`);
    if(basisRow) basisRow.style.display = s.dureeType === '39' && s.nbMois > 12 ? '' : 'none';
    setText(`c-hero-${u}`, r && heroValue(r) !== null ? fmt(heroValue(r)) : '—');
    setText(`c-herolabel-${u}`, heroLabel());
    setHTML(`c-heropas-${u}`, r ? `Avant impôt : <strong>${fmt(heroPasValue(r))}</strong>` : 'Avant impôt : —');
    setShown(`c-heropas-${u}`, heroPasShown());

    const hint = document.getElementById(`rate-hint-${u}`);
    if(hint) hint.innerHTML = r ? `Taux effectif : <strong>${r.tauxEffectif.toFixed(1)} %</strong> du brut` : 'Taux effectif : —';

    const state = document.getElementById(`c-result-state-${u}`);
    const card = document.querySelector(`#cardsBody [data-card="${u}"]`);
    const error = getCalculationError(s,foyer);
    if(state) state.textContent = r
      ? 'Calculé via l’API officielle Mon-entreprise (Urssaf).'
      : (error || 'Calcul en attente de validation par l’API Urssaf.');
    if(card) card.dataset.resultState = r ? 'ready' : (error ? 'error' : 'pending');
    const warnings = document.getElementById(`c-result-warnings-${u}`);
    if(warnings){
      warnings.hidden = !(r && r.warnings && r.warnings.length);
      warnings.innerHTML = r && r.warnings && r.warnings.length
        ? `<details><summary>Avertissements du moteur (${r.warnings.length})</summary><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>`
        : '';
    }
    const trWarn = !!(r && r.tr && r.tr.reintegre > 0.005);
    setShown(`c-trwarn-${u}`, trWarn);
    if(trWarn){
      const motifs = {
        sous50: 'Part patronale sous 50 % : vérifiez la valeur reconnue par le moteur Urssaf.',
        sur60: 'Part patronale au-delà de 60 % : vérifiez la valeur reconnue par le moteur Urssaf.',
        plafond: 'Le moteur Urssaf identifie une fraction de titres-restaurant non déductible.',
        api: 'Le moteur Urssaf identifie une part non déductible des frais professionnels transmis.'
      };
      setHTML(`c-trwarn-text-${u}`, motifs[r.tr.motif] || motifs.api);
    }
  });
  updateUrssafStatus(computed);
  saveState();
  if(!options.skipUrssafSchedule) scheduleUrssafCalculations(false,false);
}

// ---------- Navigation du rail de cartes horizontal ----------
function updateNavButtons(){
  const scroller = document.getElementById('cardsScroll');
  const prev = document.getElementById('scrollPrev');
  const next = document.getElementById('scrollNext');
  if(!scroller) return;
  const atStart = scroller.scrollLeft <= 4;
  const atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4;
  prev.disabled = atStart;
  next.disabled = atEnd || scroller.scrollWidth <= scroller.clientWidth + 4;
}
document.getElementById('cardsScroll').addEventListener('scroll', updateNavButtons);
document.getElementById('scrollPrev').addEventListener('click', () => {
  document.getElementById('cardsScroll').scrollBy({ left: -300, behavior: 'smooth' });
});
document.getElementById('scrollNext').addEventListener('click', () => {
  document.getElementById('cardsScroll').scrollBy({ left: 300, behavior: 'smooth' });
});
window.addEventListener('resize', updateNavButtons);

// ---------- Rebond léger en butée du rail de cartes ----------
(function setupRailBounce(){
  const scroller = document.getElementById('cardsScroll');
  if(!scroller) return;
  // scroll-snap-align + le padding du rail font naturellement reposer
  // scrollLeft sur le padding-left (16px sur mobile, 2px au-delà de
  // 640px) plutôt que sur 0 pile : la marge de tolérance suit ce padding
  // au lieu d'un seuil fixe qui casserait sur l'un des deux gabarits.
  const edgeTolerance = () => parseFloat(getComputedStyle(scroller).paddingLeft || '0') + 4;
  const atLeft = () => scroller.scrollLeft <= edgeTolerance();
  const atRight = () => scroller.scrollLeft >= scroller.scrollWidth - scroller.clientWidth - edgeTolerance();

  function triggerRailBounce(dir){
    const cards = document.getElementById('cardsBody');
    if(!cards) return;
    const cls = dir === 'left' ? 'bounce-left' : 'bounce-right';
    if(cards.classList.contains('bounce-left') || cards.classList.contains('bounce-right')) return;
    cards.classList.add(cls);
    cards.addEventListener('animationend', () => cards.classList.remove(cls), { once:true });
  }

  scroller.addEventListener('wheel', (e) => {
    if(Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // molette verticale de la page, pas ce rail
    if(e.deltaX < 0 && atLeft()) triggerRailBounce('left');
    else if(e.deltaX > 0 && atRight()) triggerRailBounce('right');
  }, { passive:true });

  let touchStartX = null;
  let touchBounced = false;
  scroller.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchBounced = false;
  }, { passive:true });
  scroller.addEventListener('touchmove', (e) => {
    if(touchStartX === null || touchBounced) return;
    const dx = e.touches[0].clientX - touchStartX;
    if(dx > 8 && atLeft()){ triggerRailBounce('left'); touchBounced = true; }
    else if(dx < -8 && atRight()){ triggerRailBounce('right'); touchBounced = true; }
  }, { passive:true });
})();

// ---------- Événements ----------
function numericEntryValid(value){
  const normalized = String(value ?? '').replace(/\s/g, '').replace(',', '.');
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized) && Number.isFinite(Number(normalized));
}
function setNumericInputError(el, message){
  let hint = el.parentElement && el.parentElement.querySelector(':scope > .input-error');
  if(!hint && el.parentElement){
    hint = document.createElement('div');
    hint.className = 'input-error';
    hint.setAttribute('role', 'alert');
    el.insertAdjacentElement('afterend', hint);
  }
  if(hint) hint.textContent = message || '';
  el.classList.toggle('is-invalid', !!message);
  el.setAttribute('aria-invalid', message ? 'true' : 'false');
}
function validateNumericInput(el, finalCheck){
  const value = el.value.trim();
  if(!value){
    setNumericInputError(el, finalCheck ? 'Saisissez une valeur numérique.' : '');
    return false;
  }
  if(!numericEntryValid(value)){
    setNumericInputError(el, 'Saisie invalide. Utilisez un nombre, par exemple 3000 ou 12,5.');
    return false;
  }
  setNumericInputError(el, '');
  return true;
}

function communeLabel(s){
  if(s && s.codePostal && s.departement) return String(s.commune) + ' — ' + String(s.codePostal) + ' (' + String(s.departement) + ')';
  return String(s && s.commune || 'Commune') + ' — sélection requise';
}

const communeSearchTimers = new Map();
const communeSearchSequences = new Map();
async function searchCommunes(id, query){
  const input = document.getElementById('f-commune-' + id);
  const list = document.getElementById('commune-suggestions-' + id);
  if(!input || !list) return;
  if(communeSearchTimers.has(id)) clearTimeout(communeSearchTimers.get(id));
  const term = String(query || '').trim();
  if(term.length < 2){ list.hidden = true; list.innerHTML = ''; return; }
  const sequence = (communeSearchSequences.get(id) || 0) + 1;
  communeSearchSequences.set(id, sequence);
  list.hidden = false;
  list.innerHTML = '<div class="commune-search-status">Recherche des communes…</div>';
  const timer = setTimeout(async () => {
    try{
      const params = new URLSearchParams({ fields:'nom,code,codesPostaux,departement,codeDepartement', limit:'8' });
      if(/^\d{2,5}$/.test(term)) params.set('codePostal', term);
      else { params.set('nom', term); params.set('boost', 'population'); }
      const response = await fetch('https://geo.api.gouv.fr/communes?' + params.toString(), { headers:{ Accept:'application/json' } });
      if(!response.ok) throw new Error('Service géographique indisponible');
      const data = await response.json();
      if(communeSearchSequences.get(id) !== sequence) return;
      const options = [];
      for(const item of Array.isArray(data) ? data : []){
        const department = item.departement && item.departement.nom;
        const postcodes = Array.isArray(item.codesPostaux) ? item.codesPostaux : [];
        if(!item.nom || !department || !postcodes.length) continue;
        for(const codePostal of postcodes){
          options.push({ commune:item.nom, codePostal, departement:department, codeCommune:item.code, codeDepartement:item.codeDepartement });
          if(options.length >= 8) break;
        }
        if(options.length >= 8) break;
      }
      list._communeOptions = options;
      list.innerHTML = options.length ? options.map((option, index) => '<button type="button" class="commune-option" role="option" data-commune-index="' + index + '">' + esc(option.commune) + ' — ' + esc(option.codePostal) + ' (' + esc(option.departement) + ')</button>').join('') : '<div class="commune-search-status">Aucune commune trouvée. Essayez un code postal ou un nom plus précis.</div>';
      list.querySelectorAll('.commune-option').forEach(button => button.addEventListener('click', () => {
        const selected = list._communeOptions && list._communeOptions[Number(button.dataset.communeIndex)];
        const scenario = findScenario(id);
        if(!selected || !scenario) return;
        Object.assign(scenario, selected);
        scenario.locationSelectionPending = false;
        list.hidden = true;
        render();
        updateComputed();
      }));
    }catch(error){
      if(communeSearchSequences.get(id) !== sequence) return;
      list.innerHTML = '<div class="commune-search-status">Impossible de vérifier la commune. Réessayez avant de calculer.</div>';
    }
  }, 250);
  communeSearchTimers.set(id, timer);
}

function onInput(e){
  const id = parseInt(e.target.dataset.id, 10);
  const key = e.target.dataset.key;
  const s = findScenario(id);
  if(!s) return;
  if(key === 'commune'){
    if(e.target.value !== communeLabel(s)){
      s.codePostal = '';
      s.departement = '';
      s.codeCommune = '';
      s.locationSelectionPending = true;
    }
    searchCommunes(id, e.target.value);
    return;
  }
  if(key === 'name'){
    s.name = e.target.value;
    updateComputed();
    if(s.id === refId){ setText('raiseBaseName', s.name); }
    document.getElementById('refSelect').innerHTML = scenarios
      .map(x => `<option value="${x.id}" ${x.id===refId?'selected':''}>${esc(x.name)}</option>`).join('');
    return;
  }
  if(!validateNumericInput(e.target, false)) return;
  s[key] = parseNum(e.target.value);
  updateComputed();
}

function onBlurClamp(e){
  const key = e.target.dataset.key;
  if(key === 'name') return;
  const id = parseInt(e.target.dataset.id, 10);
  const s = findScenario(id);
  if(!s) return;
  if(key === 'commune'){
    if(e.relatedTarget?.classList?.contains('commune-option')) return;
    const list = document.getElementById('commune-suggestions-' + id);
    if(list) list.hidden = true;
    if(s.locationSelectionPending){
      const typed = e.target.value.trim().slice(0, 80);
      if(typed) s.commune = typed;
      s.codePostal = '';
      s.departement = '';
      s.codeCommune = '';
      s.locationSelectionPending = false;
      updateComputed();
      return;
    }
    e.target.value = communeLabel(s);
    return;
  }
  if(!validateNumericInput(e.target, true)) return;
  const min = e.target.dataset.min !== undefined ? parseFloat(e.target.dataset.min) : undefined;
  const max = e.target.dataset.max !== undefined ? parseFloat(e.target.dataset.max) : undefined;
  const v = clamp(parseNum(e.target.value), min, max);
  s[key] = v;
  e.target.value = String(v).replace('.', ',');
  updateComputed();
}

function onStructural(e){
  const id = parseInt(e.target.dataset.id, 10);
  const s = findScenario(id);
  if(!s) return;
  s[e.target.dataset.key] = e.target.value;
  render();
}

function onCheck(e){ /* aucune case à cocher dans la carte simplifiée, gardé par précaution */ }

async function addScenario(){
  const last = scenarios[scenarios.length-1];
  const answers = await showAddScenarioModal(last.brut, last.dureeType);
  if(!answers) return; // annulé
  urssafConsentGranted = true;
  disableCardSnap();
  const created = mkScenario(Object.assign({
    name:'Salaire ' + (scenarios.length+1),
    dureeType:last.dureeType,
    commune:last.commune || 'Pacé'
  }, answers));
  scenarios.push(created);
  justAddedId = created.id;
  render();
  // Attend la fin de la disparition de la modale (200ms, voir closeModal)
  // pour que le défilement vers la nouvelle carte soit visible et fluide
  // au lieu de se produire caché derrière la modale encore à l'écran.
  setTimeout(scrollToNewCard, 220);
}

async function removeScenario(id){
  if(scenarios.length <= 1) return;
  const target = findScenario(id);
  const label = target ? target.name.trim() || 'ce salaire' : 'ce salaire';
  const ok = await showConfirmModal(`Supprimer « ${label} » du comparatif ?`, { danger:true, confirmLabel:'Supprimer' });
  if(!ok) return;
  const doRemove = () => {
    scenarios = scenarios.filter(s => s.id !== id);
    openCardIds.delete(id);
    if(refId === id) refId = scenarios[0].id;
    render();
  };
  const cardEl = document.querySelector(`.card[data-card="${id}"]`);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(cardEl && !reduceMotion){
    cardEl.classList.add('card-leave');
    // setTimeout plutôt que 'animationend' : si un autre render() survient
    // dans l'intervalle (ex. modification d'un champ sur une autre carte), le
    // nœud animé est détaché du DOM et 'animationend' ne se déclenche
    // jamais — la suppression pourtant confirmée disparaissait en silence.
    setTimeout(doRemove, 200);
  } else {
    doRemove();
  }
}

document.getElementById('resetBtn').addEventListener('click', async () => {
  const ok = await showConfirmModal(
    'Effacer tous les salaires enregistrés et revenir à l\'exemple de départ ? Cette action est irréversible.',
    { danger:true, confirmLabel:'Effacer' }
  );
  if(!ok) return;
  clearPersistedState();
  location.reload();
});

// ---------- Toast (confirmation non bloquante, ex. « lien copié ») ----------
let toastTimer = null;
showToastImpl = function(msg){
  let el = document.getElementById('toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
};

// ---------- Modale maison (remplace window.confirm()/prompt(), que les
// navigateurs bloquent souvent silencieusement — aucun dialogue, aucune
// erreur — dans une iframe sandboxée sans la permission allow-modals,
// par ex. cette app intégrée en aperçu). ----------
let modalState = null;
let modalScrollY = 0;

// overflow:hidden seul ne bloque pas toujours le scroll/rubber-band en
// arrière-plan sur mobile Safari : on fige le body en position fixed à sa
// position de scroll actuelle, et on la restaure à la fermeture.
function lockBodyScroll(){
  modalScrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${modalScrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
}
function unlockBodyScroll(){
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  window.scrollTo(0, modalScrollY);
}

function onModalKeydown(e){
  if(!modalState) return;
  if(e.key === 'Escape'){
    if(modalState.dismissible){ e.preventDefault(); closeModal(false); }
    return;
  }
  if(e.key === 'Tab'){
    // Ne retenir que ce qui peut réellement recevoir le focus. Le DOM de la
    // modale contient des éléments désactivés (le bouton « Continuer » de
    // l'onboarding démarre ainsi) et des champs masqués (ceux des titres
    // restaurant tant qu'on répond « Non »). Les compter ferait porter les
    // bornes du piège sur un élément que le focus n'atteint jamais, et la
    // tabulation sortirait d'une modale volontairement non refermable.
    const focusables = [...modalState.box.querySelectorAll('button, input')]
      .filter(el => !el.disabled && el.getClientRects().length > 0);
    if(!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }
}

function closeModal(result){
  if(!modalState) return;
  const { overlay, previousFocus, resolve } = modalState;
  overlay.classList.remove('show');
  document.removeEventListener('keydown', onModalKeydown, true);
  unlockBodyScroll();
  modalState = null;
  setTimeout(() => {
    // Une nouvelle modale peut réutiliser l'overlay avant la fin de cette
    // animation de fermeture : ne jamais effacer son contenu entre-temps.
    if(modalState) return;
    overlay.hidden = true;
    overlay.innerHTML = '';
  }, 200);
  if(previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
  if(resolve) resolve(result);
}

function openModal(bodyHtml, opts){
  const o = opts || {};
  const initialFocusSelector = o.initialFocusSelector;
  const dismissible = o.dismissible !== false;
  let overlay = document.getElementById('modalOverlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'modalOverlay';
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (e) => {
      if(e.target === overlay && modalState && modalState.dismissible) closeModal(false);
    });
    document.body.appendChild(overlay);
  }
  overlay.hidden = false;
  // Aligné en haut seulement pour les modales avec un vrai champ de saisie
  // texte, où un clavier virtuel mobile risque de le couvrir. Les modales
  // de confirmation (pas de champ) restent centrées, plus naturel.
  overlay.innerHTML = `<div id="modalBox" class="modal" role="alertdialog" aria-modal="true" aria-describedby="modalMsg" tabindex="-1">${bodyHtml}</div>`;
  const box = overlay.querySelector('#modalBox');

  lockBodyScroll();
  const previousFocus = document.activeElement;
  document.addEventListener('keydown', onModalKeydown, true);

  return new Promise(resolve => {
    modalState = { overlay, box, previousFocus, resolve, dismissible };
    requestAnimationFrame(() => {
      overlay.classList.add('show');
      const target = initialFocusSelector ? box.querySelector(initialFocusSelector) : box.querySelector('button, input');
      if(target) target.focus();
      if(target && target.tagName === 'INPUT') target.select();
    });
  });
}

function showConfirmModal(message, opts){
  const o = opts || {};
  const danger = !!o.danger;
  const confirmLabel = o.confirmLabel || 'Confirmer';
  const cancelLabel = o.cancelLabel || 'Annuler';
  const confirmClass = danger ? 'btn btn-danger' : 'btn btn-primary';
  const html = `
    <p id="modalMsg" class="modal-msg">${esc(message)}</p>
    <div class="modal-actions">
      <button type="button" class="btn modal-btn-cancel" data-modal-cancel>${esc(cancelLabel)}</button>
      <button type="button" class="${confirmClass}" data-modal-confirm>${esc(confirmLabel)}</button>
    </div>`;
  const initialFocusSelector = danger ? '[data-modal-cancel]' : '[data-modal-confirm]';
  const pending = openModal(html, { initialFocusSelector });
  const overlay = document.getElementById('modalOverlay');
  overlay.querySelector('[data-modal-cancel]').addEventListener('click', () => closeModal(false));
  overlay.querySelector('[data-modal-confirm]').addEventListener('click', () => closeModal(true));
  return pending;
}

function showShareModal(url){
  const html = `
    <p id="modalMsg" class="modal-msg">Copiez ce lien pour partager ce comparatif :</p>
    <div class="modal-share-row">
      <input type="text" readonly class="modal-share-input" id="modalShareInput" value="${esc(url)}">
      <button type="button" class="btn btn-primary" id="modalCopyBtn">Copier</button>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn modal-btn-cancel" data-modal-cancel>Fermer</button>
    </div>`;
  openModal(html, { initialFocusSelector: '#modalShareInput' });
  const overlay = document.getElementById('modalOverlay');
  const input = overlay.querySelector('#modalShareInput');
  overlay.querySelector('[data-modal-cancel]').addEventListener('click', () => closeModal(false));
  overlay.querySelector('#modalCopyBtn').addEventListener('click', async () => {
    try{
      await navigator.clipboard.writeText(url);
      showToastImpl('Lien copié dans le presse-papiers !');
    }catch(e){
      input.focus(); input.select();
      showToastImpl('Copie automatique indisponible — le lien est sélectionné, utilisez Ctrl+C.');
    }
  });
}

// Bloc facultatif partagé par l'onboarding et l'ajout d'un salaire.
function renderMutuelleTrFields(idPrefix){
  return `
    <div class="onboarding-benefits">
      <div class="onboarding-mutuelle-note">
        <span class="onboarding-mutuelle-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"></path><path d="m9 12 2 2 4-4"></path></svg>
        </span>
        <span class="onboarding-mutuelle-label">Mutuelle</span>
        <strong>30 € salarié · 30 € employeur</strong>
      </div>
      <details class="onboarding-optional">
        <summary><span>Titres-restaurant</span><span class="optional-label">Facultatif</span></summary>
        <div class="onboarding-optional-body">
          <div class="field-row" style="margin-bottom:0;">
            <label>Avez-vous des titres-restaurant ?</label>
            <div class="pill-toggle" id="${idPrefix}TrToggle" role="group" aria-label="Titres-restaurant">
              <button type="button" data-tr="non" aria-pressed="true">Non</button>
              <button type="button" data-tr="oui" aria-pressed="false">Oui</button>
            </div>
          </div>
          <div id="${idPrefix}TrFields" hidden style="margin-top:14px;">
            <div class="three-col">
              <div class="field-row"><label for="${idPrefix}Jours">Jours/mois</label><input type="text" inputmode="decimal" id="${idPrefix}Jours" value="21"></div>
              <div class="field-row"><label for="${idPrefix}Valeur">Valeur faciale (€)</label><input type="text" inputmode="decimal" id="${idPrefix}Valeur" value="8" data-max="500"></div>
              <div class="field-row"><label for="${idPrefix}Part">Part salariale (%)</label><input type="text" inputmode="decimal" id="${idPrefix}Part" value="50"></div>
            </div>
          </div>
        </div>
      </details>
    </div>`;
}

// La mutuelle est un réglage par défaut simple : 30 € de part salariale
// et 30 € de part employeur. Seuls les titres-restaurant sont facultatifs.
function bindMutuelleTrFields(overlay, idPrefix){
  const trToggle = overlay.querySelector(`#${idPrefix}TrToggle`);
  const trFields = overlay.querySelector(`#${idPrefix}TrFields`);
  const joursInput = overlay.querySelector(`#${idPrefix}Jours`);
  const valeurInput = overlay.querySelector(`#${idPrefix}Valeur`);
  const partInput = overlay.querySelector(`#${idPrefix}Part`);
  let trOui = false;
  trToggle.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      trOui = b.dataset.tr === 'oui';
      trToggle.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      trFields.hidden = !trOui;
      if(trOui) setTimeout(() => trFields.scrollIntoView({ behavior:'smooth', block:'nearest' }), 50);
    });
  });
  return () => {
    const result = { mutuelle:30, mutuellePat:30, joursResto:0 };
    if(trOui){
      result.joursResto = Math.max(0, Math.min(31, parseNum(joursInput.value)));
      result.valeurResto = clamp(parseNum(valeurInput.value), 0, 500);
      result.partResto = Math.max(0, Math.min(100, parseNum(partInput.value)));
    }
    return result;
  };
}

function showOnboardingModal(){
  const html = `
    <p id="modalMsg" class="modal-msg">Renseignez votre salaire pour commencer la comparaison.</p>
    <p class="urssaf-data-notice onboarding-urssaf-notice">En renseignant puis en validant ce formulaire, vous acceptez la transmission à l’API officielle Mon-entreprise de l’Urssaf des paramètres nécessaires au calcul : salaire brut, durée du travail, commune de l’établissement, mutuelle, titres-restaurant et situation fiscale. Aucun salaire n’est transmis avant cette validation.</p>
    <div class="field-row" style="margin:0 0 14px;">
      <label>Votre salaire est indiqué en</label>
      <div class="pill-toggle" id="modalOnboardingPeriod" role="group" aria-label="Période du salaire">
        <button type="button" data-period="mois" aria-pressed="true">Mensuel</button>
        <button type="button" data-period="an" aria-pressed="false">Annuel</button>
      </div>
    </div>
    <div class="field-row" style="margin:0 0 14px;">
      <label for="modalOnboardingInput" id="modalOnboardingLabel">Salaire brut mensuel (€)</label>
      <input type="text" inputmode="decimal" id="modalOnboardingInput" placeholder="Ex. 2500" autocomplete="off">
      <small id="modalOnboardingPeriodHint" hidden>L’équivalent mensuel sera calculé en divisant le montant annuel par 12.</small>
    </div>
    <div class="field-row" style="margin:0 0 4px;">
      <label>Base horaire</label>
      <div class="pill-toggle" id="modalOnboardingDuree">
        <button type="button" data-duree="35" aria-pressed="true">35 h</button>
        <button type="button" data-duree="39" aria-pressed="false">39 h</button>
      </div>
      <div class="sub-hint" id="modalOnboarding39Hint" hidden>Calcul fondé sur le droit commun : 4 h supplémentaires rémunérées par semaine, majorées à 25 %. Les taux particuliers des conventions collectives ne sont pas pris en compte. Les RTT ne sont pas pris en compte.</div>
    </div>

    ${renderMutuelleTrFields('modalOnboarding')}

    <div class="modal-actions" style="margin-top:18px;">
      <button type="button" class="btn btn-primary" id="modalOnboardingSubmit" style="width:100%;" disabled>Continuer et lancer le calcul</button>
    </div>`;
  const pending = openModal(html, { initialFocusSelector: '#modalOnboardingInput', dismissible: false });
  const overlay = document.getElementById('modalOverlay');
  const input = overlay.querySelector('#modalOnboardingInput');
  const submitBtn = overlay.querySelector('#modalOnboardingSubmit');
  const readMutuelleTr = bindMutuelleTrFields(overlay, 'modalOnboarding');
  const periodToggle = overlay.querySelector('#modalOnboardingPeriod');
  const periodLabel = overlay.querySelector('#modalOnboardingLabel');
  const periodHint = overlay.querySelector('#modalOnboardingPeriodHint');
  let salaryPeriod = 'mois';
  periodToggle.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => {
      salaryPeriod = button.dataset.period;
      periodToggle.querySelectorAll('button').forEach(x => {
        x.setAttribute('aria-pressed', x === button ? 'true' : 'false');
      });
      const annual = salaryPeriod === 'an';
      periodLabel.textContent = annual ? 'Salaire brut annuel (€)' : 'Salaire brut mensuel (€)';
      input.placeholder = annual ? 'Ex. 30 000' : 'Ex. 2500';
      periodHint.hidden = !annual;
    });
  });

  let dureeType = '35';
  const dureeToggle = overlay.querySelector('#modalOnboardingDuree');
  const dureeHint = overlay.querySelector('#modalOnboarding39Hint');
  dureeToggle.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      dureeType = b.dataset.duree;
      dureeToggle.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      dureeHint.hidden = dureeType !== '39';
    });
  });

  const trySubmit = () => {
    const v = parseNum(input.value);
    if(!(v > 0)) return;
    const brutMensuel = salaryPeriod === 'an' ? Math.round((v / 12) * 100) / 100 : v;
    const result = Object.assign({ brut: brutMensuel, dureeType }, readMutuelleTr());
    closeModal(result);
  };
  input.addEventListener('input', () => { submitBtn.disabled = !(parseNum(input.value) > 0); });
  input.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); trySubmit(); } });
  submitBtn.addEventListener('click', trySubmit);
  return pending;
}

// Redemandé à chaque nouveau salaire — le brut et les avantages (mutuelle,
// TR) diffèrent souvent d'une offre à l'autre, impossible de les deviner
// silencieusement.
function showAddScenarioModal(brutPrefill, dureePrefill){
  const html = `
    <p id="modalMsg" class="modal-msg">Nouveau salaire à comparer.</p>
    <p class="urssaf-data-notice onboarding-urssaf-notice">En renseignant puis en validant ce salaire, vous autorisez sa transmission à l’API officielle Mon-entreprise de l’Urssaf pour calculer le résultat.</p>
    <div class="field-row" style="margin:0 0 14px;">
      <label>Votre salaire est indiqué en</label>
      <div class="pill-toggle" id="modalAddPeriod" role="group" aria-label="Période du salaire">
        <button type="button" data-period="mois" aria-pressed="true">Mensuel</button>
        <button type="button" data-period="an" aria-pressed="false">Annuel</button>
      </div>
    </div>
    <div class="field-row" style="margin:0 0 14px;">
      <label for="modalAddInput" id="modalAddLabel">Salaire brut mensuel (€)</label>
      <input type="text" inputmode="decimal" id="modalAddInput" value="${brutPrefill || ''}" placeholder="Ex. 2500" autocomplete="off">
      <small id="modalAddPeriodHint" hidden>L’équivalent mensuel sera calculé en divisant le montant annuel par 12.</small>
    </div>
    <div class="field-row" style="margin:0 0 4px;">
      <label>Base horaire</label>
      <div class="pill-toggle" id="modalAddDuree">
        <button type="button" data-duree="35" aria-pressed="${dureePrefill !== '39'}">35 h</button>
        <button type="button" data-duree="39" aria-pressed="${dureePrefill === '39'}">39 h</button>
      </div>
      <div class="sub-hint" id="modalAdd39Hint" ${dureePrefill === '39' ? '' : 'hidden'}>Calcul fondé sur le droit commun : 4 h supplémentaires rémunérées par semaine, majorées à 25 %. Les taux particuliers des conventions collectives ne sont pas pris en compte. Les RTT ne sont pas pris en compte.</div>
    </div>

    ${renderMutuelleTrFields('modalAdd')}

    <div class="modal-actions" style="margin-top:18px;">
      <button type="button" class="btn modal-btn-cancel" id="modalAddCancel">Annuler</button>
      <button type="button" class="btn btn-primary" id="modalAddSubmit" disabled>Ajouter ce salaire</button>
    </div>`;
  const pending = openModal(html, { initialFocusSelector: '#modalAddInput', dismissible: true });
  const overlay = document.getElementById('modalOverlay');
  const input = overlay.querySelector('#modalAddInput');
  const submitBtn = overlay.querySelector('#modalAddSubmit');
  const readMutuelleTr = bindMutuelleTrFields(overlay, 'modalAdd');
  const periodToggle = overlay.querySelector('#modalAddPeriod');
  const periodLabel = overlay.querySelector('#modalAddLabel');
  const periodHint = overlay.querySelector('#modalAddPeriodHint');
  let salaryPeriod = 'mois';
  periodToggle.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => {
      if(button.dataset.period === salaryPeriod) return;
      const current = parseNum(input.value);
      if(current > 0){
        const converted = salaryPeriod === 'mois' ? current * 12 : current / 12;
        input.value = String(Math.round(converted * 100) / 100).replace('.', ',');
      }
      salaryPeriod = button.dataset.period;
      periodToggle.querySelectorAll('button').forEach(x => {
        x.setAttribute('aria-pressed', x === button ? 'true' : 'false');
      });
      const annual = salaryPeriod === 'an';
      periodLabel.textContent = annual ? 'Salaire brut annuel (€)' : 'Salaire brut mensuel (€)';
      input.placeholder = annual ? 'Ex. 30 000' : 'Ex. 2500';
      periodHint.hidden = !annual;
      updateSubmitState();
    });
  });

  let dureeType = dureePrefill === '39' ? '39' : '35';
  const dureeToggle = overlay.querySelector('#modalAddDuree');
  const dureeHint = overlay.querySelector('#modalAdd39Hint');
  dureeToggle.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      dureeType = b.dataset.duree;
      dureeToggle.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      dureeHint.hidden = dureeType !== '39';
    });
  });

  const trySubmit = () => {
    const v = parseNum(input.value);
    if(!(v > 0)) return;
    const brutMensuel = salaryPeriod === 'an' ? Math.round((v / 12) * 100) / 100 : v;
    closeModal(Object.assign({ brut: brutMensuel, dureeType }, readMutuelleTr()));
  };
  const updateSubmitState = () => { submitBtn.disabled = !(parseNum(input.value) > 0); };
  updateSubmitState();
  input.addEventListener('input', updateSubmitState);
  input.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); trySubmit(); } });
  submitBtn.addEventListener('click', trySubmit);
  overlay.querySelector('#modalAddCancel').addEventListener('click', () => closeModal(false));
  return pending;
}


const headerMenu = document.getElementById('headerMenu');
document.addEventListener('click', event => {
  if(headerMenu && headerMenu.open && !headerMenu.contains(event.target)) headerMenu.open = false;
});
document.addEventListener('keydown', event => {
  if(event.key === 'Escape' && headerMenu?.open) headerMenu.open = false;
});
if(headerMenu){
  headerMenu.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => { headerMenu.open = false; });
  });
}
document.getElementById('shareBtn').addEventListener('click', shareLink);

// ---------- Champ focalisé toujours amené dans la vue ----------
// Sur mobile, le clavier virtuel peut couvrir la partie basse de l'écran ;
// délégué sur document car les champs sont recréés à chaque render(). Vaut
// aussi à l'intérieur des modales (ex. TR dépliés dans l'onboarding) : les
// aligner en haut de l'écran ne suffit pas si le champ visé est plus bas
// que ce que le clavier laisse de place visible.
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if(!el.matches || !el.matches('input, select, textarea')) return;
  setTimeout(() => {
    // Ne recentre que si le champ n'est pas déjà entièrement visible —
    // sinon un simple Tab ou clic sur un champ déjà à l'écran (le cas
    // courant sur desktop, sans clavier virtuel) déclenchait un scroll
    // recentrant inutile et perturbant à chaque focus.
    const r = el.getBoundingClientRect();
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    const fullyVisible = r.top >= 0 && r.bottom <= vh;
    if(!fullyVisible) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }, 250); // laisse le clavier virtuel finir d'apparaître avant de calculer la position
});

if(loadedFromShare){
  const banner = document.getElementById('shareBanner');
  if(banner) banner.hidden = false;
}

document.getElementById('printBtn').addEventListener('click', () => {
  const toOpen = Array.from(document.querySelectorAll('details.more, #moreMetrics'));
  const prevOpen = toOpen.map(d => d.open);
  toOpen.forEach(d => { d.open = true; });

  function restore(){
    toOpen.forEach((d, i) => { d.open = prevOpen[i]; });
    window.removeEventListener('afterprint', restore);
  }
  window.addEventListener('afterprint', restore);

  // On attend deux frames pour que les <details> tout juste ouverts et la
  // mise en page recalculée soient peints avant que l'aperçu d'impression soit pris.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
    });
  });
});
document.getElementById('refSelect').addEventListener('change', e => {
  refId = parseInt(e.target.value, 10);
  render();
});
document.querySelectorAll('.metric-toggle button').forEach(b => {
  b.addEventListener('click', () => { metric = b.dataset.metric; render(); });
});
document.querySelectorAll('#amtToggle button').forEach(b => {
  b.addEventListener('click', () => {
    if(displayAmt === b.dataset.amt) return;
    displayAmt = b.dataset.amt;
    syncDisplayToggles();
    render();
  });
});
document.querySelectorAll('#periodToggle button').forEach(b => {
  b.addEventListener('click', () => {
    if(displayPeriod === b.dataset.period) return;
    displayPeriod = b.dataset.period;
    syncDisplayToggles();
    render();
  });
});
// L'état restauré (localStorage ou lien partagé) doit se voir sur les bascules :
// sans ça, un comparatif rouvert en Brut/Annuel affiche bien des montants
// annuels bruts mais surligne « Net » et « Mensuel ».
function syncDisplayToggles(){
  document.querySelectorAll('#amtToggle button').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.amt === displayAmt ? 'true' : 'false');
  });
  document.querySelectorAll('#periodToggle button').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.period === displayPeriod ? 'true' : 'false');
  });
}
syncDisplayToggles();

// ---------- Modules (compléments activables) ----------
function bindModuleToggle(cardId, toggleId, bodyId){
  const card = document.getElementById(cardId);
  const toggle = document.getElementById(toggleId);
  const body = document.getElementById(bodyId);
  if(!card || !toggle || !body) return;
  toggle.addEventListener('click', () => {
    const willOpen = !card.classList.contains('is-open');
    toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    card.classList.toggle('is-open', willOpen);
  });
}
bindModuleToggle('foyerModule', 'foyerModuleToggle', 'foyerModuleBody');
bindFoyerModule();
bindModuleToggle('raiseModule', 'raiseModuleToggle', 'raiseModuleBody');

// ---------- Simulateur d'augmentation ----------
let raiseType = 'pct';
const RAISE_PCT_PRESETS = [2, 3, 5, 10];
const RAISE_EUR_PRESETS = [50, 100, 150, 200];

function renderRaiseChips(){
  document.getElementById('raiseChipsPct').innerHTML = RAISE_PCT_PRESETS
    .map(v => `<button type="button" class="raise-chip" data-raise-pct="${v}">+${v} %</button>`).join('');
  document.getElementById('raiseChipsEur').innerHTML = RAISE_EUR_PRESETS
    .map(v => `<button type="button" class="raise-chip eur" data-raise-eur="${v}">+${v} €</button>`).join('');
  document.querySelectorAll('[data-raise-pct]').forEach(btn => {
    btn.addEventListener('click', () => addRaiseScenario('pct', parseFloat(btn.dataset.raisePct)));
  });
  document.querySelectorAll('[data-raise-eur]').forEach(btn => {
    btn.addEventListener('click', () => addRaiseScenario('eur', parseFloat(btn.dataset.raiseEur)));
  });
}

function addRaiseScenario(type, value){
  const base = findScenario(refId);
  if(!base || !value) return;
  const newBrut = type === 'pct' ? base.brut * (1 + value/100) : base.brut + value;
  const label = type === 'pct' ? `+${value} %` : `+${fmt(value)}`;
  const clone = Object.assign({}, base);
  delete clone.id;
  disableCardSnap();
  const created = mkScenario(Object.assign(clone, {
    name: `${base.name} ${label}`, brut: Math.round(newBrut * 100) / 100
  }));
  scenarios.push(created);
  justAddedId = created.id;
  render();
  scrollToNewCard();
}

function updateRaiseBaseName(){
  const base = findScenario(refId);
  setText('raiseBaseName', base ? base.name : '');
}

document.querySelectorAll('.raise-type-toggle button').forEach(btn => {
  btn.addEventListener('click', () => {
    raiseType = btn.dataset.rtype;
    document.querySelectorAll('.raise-type-toggle button').forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
    document.getElementById('raiseAmount').value = raiseType === 'pct' ? '5' : '150';
  });
});
// Le bouton est recréé par render() : déléguer au conteneur permanent
// évite de chercher un élément inexistant au démarrage et n'attache qu'un écouteur.
document.getElementById('cardsBody').addEventListener('click', e => {
  if(e.target.closest && e.target.closest('#addScenario')) addScenario();
});
document.getElementById('addRaiseScenario').addEventListener('click', () => {
  const amountInput = document.getElementById('raiseAmount');
  if(!validateNumericInput(amountInput, true)) return;
  const val = parseNum(amountInput.value);
  addRaiseScenario(raiseType, val);
});
renderRaiseChips();

// ---------- Animation du rail de cartes ----------
// Fait défiler jusqu'à la dernière carte réelle (pas la carte fantôme
// "Ajouter un salaire" qui la suit) — scroller jusqu'à scrollWidth la
// dépassait et laissait la carte tout juste créée à peine visible.
//
// L'animation est faite à la main (au lieu de scrollIntoView/scrollTo en
// behavior:'smooth') et scroll-snap-type est coupé dès avant le re-rendu
// qui insère la nouvelle carte : sinon le navigateur "corrige" tout seul la
// position au point d'ancrage le plus proche dès que le DOM change — un
// saut instantané, avant même que l'animation n'ait eu la main.
function disableCardSnap(){
  const scroller = document.getElementById('cardsScroll');
  if(scroller.dataset.snapPrev === undefined) scroller.dataset.snapPrev = scroller.style.scrollSnapType || '';
  scroller.style.scrollSnapType = 'none';
}
function restoreCardSnap(){
  const scroller = document.getElementById('cardsScroll');
  scroller.style.scrollSnapType = scroller.dataset.snapPrev || '';
  delete scroller.dataset.snapPrev;
}

function animateScrollLeft(el, target, duration, onDone){
  const start = el.scrollLeft;
  const change = target - start;
  if(Math.abs(change) < 1){ if(onDone) onDone(); return; }
  const startTime = performance.now();
  const ease = t => t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;
  function step(now){
    const t = Math.min(1, (now - startTime) / duration);
    el.scrollLeft = start + change * ease(t);
    if(t < 1) requestAnimationFrame(step);
    else if(onDone) onDone();
  }
  requestAnimationFrame(step);
}

function scrollToNewCard(){
  requestAnimationFrame(() => {
    const cards = document.querySelectorAll('#cardsBody .card:not(.card-add)');
    const target = cards[cards.length - 1];
    if(!target){ restoreCardSnap(); return; }
    const scroller = document.getElementById('cardsScroll');
    // Un ajout lancé depuis le module d'augmentation, situé plus bas dans la page,
    // faisait défiler le rail hors de vue : on ne voyait pas
    // le salaire créé. On remonte d'abord sur la liste si elle n'est pas visible.
    const rail = scroller.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if(rail.top < 0 || rail.bottom > vh){
      const y = window.scrollY + rail.top - Math.max(16, (vh - rail.height) / 2);
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
    const targetRect = target.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const delta = (targetRect.left + targetRect.width / 2) - (scrollerRect.left + scrollerRect.width / 2);
    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    const dest = Math.max(0, Math.min(maxScroll, scroller.scrollLeft + delta));
    animateScrollLeft(scroller, dest, 380, restoreCardSnap);
  });
}

render();
// Actualisation du repère SMIC à chaque ouverture, sans transmettre les données de paie.
refreshOfficialSmic(false);
// Un hash contenant explicitement un partage mais non restauré doit être signalé.
// Le repli vers la sauvegarde locale ou l'onboarding reste inchangé.
if(!loadedFromShare && location.hash &&
   new URLSearchParams(location.hash.slice(1)).has('share')){
  showToastImpl('Lien de partage invalide ou incomplet : les données n’ont pas pu être chargées.');
}
// Les interactions V33 doivent fonctionner aussi pour les visiteurs qui ont déjà
// terminé l'onboarding : elles ne dépendent pas de l'affichage de la modale initiale.
document.querySelectorAll('[data-maquette-period]').forEach(button=>{
  button.addEventListener('click',()=>{
    maquetteComparisonPeriod=button.dataset.maquettePeriod;
    metric='netHoraire';
    render();
  });
});
document.getElementById('maquetteAddSalary')?.addEventListener('click',()=>addScenario());

if(showOnboarding){
  showOnboardingModal().then(result => {
    Object.assign(scenarios[0], result);
    urssafConsentGranted = true;
    render();
    saveState();
    scheduleUrssafCalculations(true,true);
  });
}
