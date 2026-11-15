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
    metric, displayAmt, displayPeriod
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
      includeDetails: overlay.querySelector('#shareIncludeDetails').checked
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
let showOnboarding = !initialSource || initialSource.onboardingCompleted === false;
let onboardingCompleted = !showOnboarding;
// Ne pas persister le brut placeholder tant que la pop-up d'onboarding n'a
// pas été validée — même logique que pour un chargement depuis un lien
// partagé, pour ne jamais écraser silencieusement un état déjà enregistré.
let suppressAutosave = loadedFromShare || showOnboarding;

if(loadedFromShare){
  // On retire les données de partage de la barre d'adresse une fois lues —
  // évite de redéclencher ceci sur un simple rechargement et garde l'URL propre.
  history.replaceState(null, '', location.pathname + location.search);
}

let scenarios, refId, metric, openCardIds, displayAmt, displayPeriod;
if(initialSource){
  scenarios = initialSource.scenarios.map(sv => mkScenario(sv));
  idCounter = scenarios.length;
  refId = scenarios.some(s => s.id === initialSource.refId) ? initialSource.refId : scenarios[0].id;
  metric = METRIC_KEYS.includes(initialSource.metric) ? initialSource.metric : METRIC_DEFAUT;
  displayAmt = initialSource.displayAmt === 'brut' ? 'brut' : 'net';
  displayPeriod = initialSource.displayPeriod === 'an' ? 'an' : 'mois';
  const validIds = new Set(scenarios.map(s => s.id));
  openCardIds = new Set(Array.isArray(initialSource.openCardIds) ? initialSource.openCardIds.filter(id => validIds.has(id)) : []);
} else {
  scenarios = defaultScenarios();
  refId = scenarios[0].id;
  metric = METRIC_DEFAUT;
  openCardIds = new Set();
  displayAmt = 'net';
  displayPeriod = 'mois';
}

const metricHints = {
  netImposable: 'La base retenue pour l\'impôt sur le revenu — utile pour anticiper votre déclaration.',
  annuelNet: 'Le total net sur l\'année, primes comprises, <em>avant</em> prélèvement à la source — pratique quand les salaires comparés n\'ont pas le même nombre de mensualités (ex. 13ᵉ mois).',
  netHoraire: 'Le net ramené aux heures réellement travaillées dans le mois — pratique pour comparer un 35h et un 39h sur une base commune.',
  brutHoraire: 'Le taux horaire de base du contrat, hors majoration des heures supplémentaires — le chiffre qu\'on retrouve en général sur une offre d\'emploi.'
};

function findScenario(id){ return scenarios.find(s => s.id === id); }
function heroValue(r){
  if(displayAmt === 'net'){
    const value = displayPeriod === 'mois' ? r.m.netApres : r.a.netApres;
    return Number.isFinite(value) ? value : null;
  }
  return displayPeriod === 'mois' ? r.m.brutTotal : r.a.brutTotal;
}
function heroLabel(){
  if(displayAmt === 'brut') return 'Brut ' + (displayPeriod === 'mois' ? 'mensuel' : 'annuel');
  return 'Net ' + (displayPeriod === 'mois' ? 'mensuel' : 'annuel');
}

