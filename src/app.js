"use strict";


// ---------- État ----------
let idCounter = 0;
// Id du scénario tout juste créé, pour lui appliquer une animation d'entrée
// une seule fois (effacé à la fin du render() qui l'utilise).
let justAddedId = null;
function mkScenario(over){
  const base = {
    id: idCounter++, name:'Salaire', brut:2800,
    mutuelle:scenarioDefaults.mutuelle,
    joursResto:scenarioDefaults.joursResto, valeurResto:scenarioDefaults.valeurResto,
    partResto:scenarioDefaults.partResto,
    dureeType:'35', nbMois:scenarioDefaults.nbMois, primes:0,
    maintienPct:90, carenceCouverte:false,
    absenceType:'none', absenceDuree:0
  };
  return Object.assign(base, over || {});
}

function defaultScenarios(){
  return [
    mkScenario({ name:'Poste actuel', brut:2300, dureeType:'39', joursResto:21, valeurResto:8 })
  ];
}

// ---------- Persistance (localStorage uniquement — rien ne quitte le navigateur) ----------
const STORAGE_KEY = 'onnet.state.v1';
const NUMERIC_KEYS = ['brut','mutuelle','joursResto','valeurResto','partResto','nbMois','primes','maintienPct','absenceDuree'];
// Métriques de la section « D'autres chiffres utiles ». Le net mensuel n'y
// figure pas : c'est déjà ce que montre le graphique juste au-dessus.
// Une métrique inconnue (état sauvegardé ou lien partagé antérieur, par exemple
// l'ancien « Coût employeur » ou l'ancien « Net ») retombe sur METRIC_DEFAUT.
const METRIC_KEYS = ['netImposable','annuelNet','netApresImpot','netHoraire','brutHoraire'];
const METRIC_DEFAUT = 'netHoraire';

function sanitizeScenario(raw){
  if(!raw || typeof raw !== 'object') return null;
  const clean = Object.assign({}, raw);
  NUMERIC_KEYS.forEach(k => {
    if(clean[k] === undefined) return;
    const n = Number(clean[k]);
    if(Number.isFinite(n)) clean[k] = n; else delete clean[k];
  });
  if(typeof clean.name !== 'string' || !clean.name.trim()) delete clean.name;
  // Statut et taux forfaitaire retirés (v2.0.0) : purger toute trace d'un
  // état enregistré par une version antérieure plutôt que la porter sans effet.
  delete clean.statut;
  delete clean.rate;
  if(clean.dureeType !== '35' && clean.dureeType !== '39') delete clean.dureeType;
  if(!['none','conges','arret'].includes(clean.absenceType)) delete clean.absenceType;
  clean.carenceCouverte = !!clean.carenceCouverte;
  if(!Number.isInteger(clean.id)) delete clean.id;
  return clean;
}

// Le foyer fiscal est un réglage global (une personne, pas un salaire) : il est
// donc stocké à part des scénarios, et normalisé de la même façon qu'eux.
// mode 'bareme' : impôt reconstitué au barème à partir de la situation du foyer.
// mode 'taux'   : le taux de prélèvement à la source réel, saisi directement,
//                 s'applique tel quel — les champs de situation n'ont alors
//                 plus de rôle dans le calcul et disparaissent de l'UI.
const FOYER_DEFAUT = { mode:'bareme', couple:false, personnesCharge:0, autresRevenus:0, pasRate:0 };
function sanitizeFoyer(raw){
  const f = (raw && typeof raw === 'object') ? raw : {};
  const nb = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const couple = !!f.couple;
  return {
    mode: f.mode === 'taux' ? 'taux' : 'bareme',
    couple,
    personnesCharge: Math.max(0, Math.min(4, Math.floor(nb(f.personnesCharge)))),
    // Les revenus du conjoint n'ont pas de sens hors couple : on les neutralise
    // pour que la valeur calculée corresponde toujours à ce qui est affiché.
    autresRevenus: couple ? Math.max(0, nb(f.autresRevenus)) : 0,
    pasRate: clamp(nb(f.pasRate), 0, 100)
  };
}

function loadPersistedState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    const data = JSON.parse(raw);
    if(!data || !Array.isArray(data.scenarios)) return null;
    const cleaned = data.scenarios.map(sanitizeScenario).filter(Boolean);
    if(!cleaned.length) return null;
    return { scenarios: cleaned, refId: data.refId, metric: data.metric,
             displayAmt: data.displayAmt, displayPeriod: data.displayPeriod,
             openCardIds: data.openCardIds, foyer: sanitizeFoyer(data.foyer) };
  } catch(e){ return null; }
}

function saveState(){
  if(suppressAutosave) return;
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v:1, scenarios, refId, metric, displayAmt, displayPeriod, foyer,
      openCardIds:[...openCardIds]
    }));
  } catch(e){ /* stockage plein/indisponible — l'app continue de fonctionner en mémoire */ }
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
    const cleaned = data.scenarios.map(sanitizeScenario).filter(Boolean);
    if(!cleaned.length) return null;
    return { scenarios: cleaned, refId: data.refId, metric: data.metric,
             displayAmt: data.displayAmt, displayPeriod: data.displayPeriod,
             foyer: sanitizeFoyer(data.foyer) };
  } catch(e){ return null; }
}

function buildShareUrl(){
  const payload = { v:1, scenarios, refId, metric, displayAmt, displayPeriod, foyer };
  const encoded = toBase64Url(JSON.stringify(payload));
  // Pas location.origin : il vaut la chaîne « null » sur file:// (Firefox,
  // Safari), or le README documente l'ouverture directe du fichier.
  return location.href.split('#')[0] + '#share=' + encoded;
}

let showToastImpl = null;

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

async function shareLink(){
  const url = buildShareUrl();
  // Cas normal : copie directe sur ce clic (un vrai geste utilisateur récent)
  // et simple affichage du toast — pas de fenêtre en plus. La modale n'est
  // qu'un dernier repli, affiché seulement si les deux méthodes de copie
  // échouent vraiment, pour ne jamais perdre le lien pour autant.
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
  idCounter = scenarios.reduce((max, s) => Math.max(max, s.id), -1) + 1;
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
  netApresImpot: 'Le net une fois l\'impôt sur le revenu estimé au barème 2026 — ajustez le foyer fiscal sur chaque salaire pour affiner.',
  netHoraire: 'Le net ramené aux heures réellement travaillées dans le mois — pratique pour comparer un 35h et un 39h sur une base commune.',
  brutHoraire: 'Le taux horaire de base du contrat, hors majoration des heures supplémentaires — le chiffre qu\'on retrouve en général sur une offre d\'emploi.'
};

function findScenario(id){ return scenarios.find(s => s.id === id); }
function heroValue(r){
  if(displayAmt === 'net') return displayPeriod === 'mois' ? r.m.netApres : r.a.netApres;
  return displayPeriod === 'mois' ? r.m.brutTotal : r.a.brutTotal;
}
function heroLabel(){
  return (displayAmt === 'net' ? 'Net' : 'Brut') + ' ' + (displayPeriod === 'mois' ? 'mensuel' : 'annuel');
}
function heroPasValue(r){
  return displayPeriod === 'mois' ? r.netApresImpot : r.annuelNetApresImpot;
}
function heroPasShown(){
  // L'impôt est désormais calculé, plus saisi : la ligne est toujours pertinente.
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

  const trWarn = r.tr.reintegre > 0.005;
  const trMotifs = {
    sous50: `Part patronale sous 50 % : la totalité de la participation employeur redevient soumise aux cotisations.`,
    sur60: `Part patronale au-delà de 60 % : la fraction excédentaire redevient soumise aux cotisations.`,
    plafond: `Part patronale au-delà du plafond par titre : la fraction excédentaire redevient soumise aux cotisations.`
  };

  return `
  <div class="card ${isRef ? 'is-ref' : ''} ${s.id === justAddedId ? 'card-enter' : ''}" data-card="${uid}">
    <div class="card-top">
      <button type="button" class="drag-handle" draggable="true" data-drag-handle="${uid}" aria-label="Déplacer la tuile ${esc(s.name)}" title="Cliquer et glisser pour réorganiser">⠿</button>
      <label class="sr-only" for="f-name-${uid}">Nom du salaire</label>
      <input class="name-input" id="f-name-${uid}" value="${esc(s.name)}" data-id="${uid}" data-key="name">
      ${isRef ? '<span class="ref-badge">référence</span>' : ''}
      ${showRemove ? `<button class="remove-btn" data-remove="${uid}" aria-label="Supprimer le salaire ${esc(s.name)}">✕</button>` : ''}
    </div>

    <div class="hero">
      <div class="hero-value" id="c-hero-${uid}" aria-live="polite">${fmt(heroValue(r))}</div>
      <div class="hero-label" id="c-herolabel-${uid}">${heroLabel()}</div>
      <div class="hero-pas" id="c-heropas-${uid}" style="${heroPasShown() ? '' : 'display:none;'}">Après impôt : <strong>${fmt(heroPasValue(r))}</strong></div>
    </div>
    ${s.absenceType === 'arret' ? `<div class="alert alert-info" style="margin:-6px 0 14px;"><span>${ICON.info}</span><span>${s.absenceDuree} j d'arrêt sur 30, ${s.maintienPct}% maintenus, ${s.carenceCouverte ? 'carence de 3 j couverte' : 'délai de carence de 3 j inclus'}. Ancienneté et convention collective non prises en compte.</span></div>` : ''}
    ${s.absenceType === 'conges' ? `<div class="alert alert-info" style="margin:-6px 0 14px;"><span>${ICON.info}</span><span>${s.absenceDuree} j de congés payés sur 30 : salaire de base maintenu, sans titres restaurant sur ces jours.</span></div>` : ''}

    <div class="field-row">
      <label for="f-brut-${uid}">Salaire brut mensuel (€)</label>
      ${num(`f-brut-${uid}`,'brut',uid,s.brut,{min:0})}
    </div>

    <div class="sub-hint" id="rate-hint-${uid}" style="margin:-6px 0 14px;">Taux effectif : <strong>${r.tauxEffectif.toFixed(1)} %</strong> du brut</div>

    <div class="field-row">
      <label>Base horaire</label>
      <div class="pill-toggle" data-durree-group="${uid}">
        <button type="button" data-duree="35" data-id="${uid}" aria-pressed="${s.dureeType==='35'}">35 h</button>
        <button type="button" data-duree="39" data-id="${uid}" aria-pressed="${s.dureeType==='39'}">39 h</button>
      </div>
    </div>

    <details class="more">
      <summary>Détails avancés</summary>
      <div class="more-body">
        <div class="section-tag">Mutuelle</div>
        <div class="field-row">
          <label for="f-mutuelle-${uid}">Mutuelle (€ / mois)</label>
          ${num(`f-mutuelle-${uid}`,'mutuelle',uid,s.mutuelle,{min:0})}
        </div>
        <div class="section-tag">Titres restaurant</div>
        <div class="three-col">
          <div class="field-row"><label for="f-jours-${uid}">Jours/mois</label>${num(`f-jours-${uid}`,'joursResto',uid,s.joursResto,{min:0,max:31})}</div>
          <div class="field-row"><label for="f-valeur-${uid}">Valeur (€)</label>${num(`f-valeur-${uid}`,'valeurResto',uid,s.valeurResto,{min:0})}</div>
          <div class="field-row"><label for="f-part-${uid}">Part (%)</label>${num(`f-part-${uid}`,'partResto',uid,s.partResto,{min:0,max:100})}</div>
        </div>
        <div class="alert alert-warn" id="c-trwarn-${uid}" style="${trWarn ? '' : 'display:none;'}">
          <span>${ICON.warn}</span><span id="c-trwarn-text-${uid}">${trWarn ? trMotifs[r.tr.motif] : ''}</span>
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
        <div class="sub-hint">Utilisés uniquement pour le <strong>net annuel</strong> : 12 pour un salaire classique, 13 ou 14 pour un 13ᵉ/14ᵉ mois. Les primes s'ajoutent une seule fois sur l'année, hors mensualités.</div>
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
    const cotis = m.cotisNettes;
    const mutuelle = s.mutuelle;
    const tr = r.tr.totalSalarie;
    const net = m.netApres;
    const netSansTR = m.netSocial;
    const brut = m.brutTotal;
    const scale = maxPx / maxBrut;

    const delta = net - ref.r.m.netApres;
    const cls = delta > 0 ? 'pos' : (delta < 0 ? 'neg' : '');

    let barHtml, brutLabel;
    if(s.absenceType !== 'none'){
      const pxNet = Math.max(22, Math.round(net * scale));
      barHtml = `
      <div class="stack-bar">
        <div class="stack-seg stack-seg-net" style="height:${pxNet}px" title="Estimation nette : ${fmt(net)}" role="img" aria-label="Net estimé : ${fmt(net)}">
          <span class="stack-net-tag">net</span>
        </div>
      </div>`;
      brutLabel = s.absenceType === 'arret'
        ? `${s.absenceDuree} j arrêt, ${s.maintienPct}%`
        : `${s.absenceDuree} j congés`;
    } else {
      const pxCotis = Math.round(cotis * scale);
      const pxMutuelle = Math.round(mutuelle * scale);
      const pxTr = Math.round(tr * scale);
      const pxNet = Math.max(22, Math.round(net * scale));
      barHtml = `
      <div class="stack-bar">
        <div class="stack-seg stack-seg-cotis" style="height:${pxCotis}px" title="Cotisations sociales : ${fmt(cotis)}" role="img" aria-label="Cotisations sociales : ${fmt(cotis)}"></div>
        <div class="stack-seg stack-seg-mutuelle" style="height:${pxMutuelle}px" title="Mutuelle : ${fmt(mutuelle)}" role="img" aria-label="Mutuelle : ${fmt(mutuelle)}"></div>
        <div class="stack-seg stack-seg-tr" style="height:${pxTr}px" title="Titres restaurant (part salariale) : ${fmt(tr)}" role="img" aria-label="Titres restaurant, part salariale : ${fmt(tr)}"></div>
        <div class="stack-seg stack-seg-net" style="height:${pxNet}px" title="Net : ${fmt(net)}" role="img" aria-label="Net : ${fmt(net)}">
          <span class="stack-net-tag">net</span>
        </div>
      </div>`;
      brutLabel = `brut ${fmt(brut)}`;
    }

    const isRef = s.id === refId;
    return `
    <div class="stack-col ${isRef?'is-ref':''} ${s.id === justAddedId ? 'card-enter' : ''}" ${!isRef ? `data-setref="${s.id}" role="button" tabindex="0" aria-label="Définir ${esc(s.name)} comme salaire de référence"` : 'aria-current="true"'}>
      <div class="stack-brut">${brutLabel}</div>
      ${barHtml}
      <div class="stack-ref-row">
        <span class="stack-ref-dot ${isRef?'is-ref':''}" aria-hidden="true"></span>
        <span class="stack-name" title="${esc(s.name)}">${esc(s.name)}</span>
      </div>
      <div class="stack-net">${fmt(net)}</div>
      ${(s.absenceType === 'none' && tr > 0.5) ? `<div class="stack-net-notr">sans TR : ${fmt(netSansTR)}</div>` : ''}
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

const WF_MIN_INSIDE = 15; // largeur (%) en dessous de laquelle le libellé sort de la barre

function wfSeg(cls, dotStyle, label, val, pctVal, note){
  const inside = pctVal >= WF_MIN_INSIDE;
  return `
  <div class="wf-row${cls === 'wf-bar-total' ? ' wf-total' : ''}">
    <div class="wf-label"><span class="wf-dot" style="${dotStyle}"></span>${label}</div>
    <div class="wf-track">
      <div class="wf-bar ${cls}" style="width:${Math.min(100, Math.max(pctVal, 1.5))}%">
        <span class="wf-val${inside ? '' : ' wf-val-out'}">${val}</span>
      </div>
    </div>
  </div>
  ${note ? `<div class="wf-note">${note}</div>` : ''}`;
}

// Le choix libellé-dedans/dehors dans wfSeg() est fait sur un seuil en % de
// la piste totale — insuffisant : sur un petit écran, ou quand une seule
// catégorie (ex. titres restaurant) dépasse le brut, un % au-dessus du
// seuil peut quand même correspondre à trop peu de pixels pour contenir le
// texte, qui déborde alors de la barre. On corrige après coup en mesurant
// la largeur réellement disponible.
function fixWaterfallLabelFit(){
  document.querySelectorAll('.wf-bar').forEach(bar => {
    const val = bar.querySelector('.wf-val');
    if(!val) return;
    val.classList.remove('wf-val-out');
    const fits = val.getBoundingClientRect().width + 20 <= bar.getBoundingClientRect().width;
    if(!fits) val.classList.add('wf-val-out');
  });
}

function renderWaterfall(computed){
  const { s, r } = computed[0];
  const m = r.m;
  const brut = m.brutTotal;
  const pct = v => brut > 0 ? (v/brut)*100 : 0;

  if(s.absenceType !== 'none'){
    const net = m.netApres;
    return `
    <div class="waterfall" role="img" aria-label="Brut habituel ${fmt(brut)}, net estimé pendant l'absence : ${fmt(net)}">
      ${wfSeg('wf-bar-total', 'background:var(--surface); border:1.5px solid var(--line);', 'Brut habituel', fmt(brut), 100)}
      ${wfSeg('wf-bar-net', `background:${STACK_COLORS.net}`, 'Net estimé (absence)', fmt(net), pct(net))}
    </div>`;
  }

  const cotis = m.cotisNettes;
  const mutuelle = s.mutuelle;
  const tr = r.tr.totalSalarie;
  const net = m.netApres;
  const netSansTR = m.netSocial;
  const trValeurFaciale = r.tr.totalSalarie + r.tr.totalEmployeur;
  // Deux lignes chiffrées plutôt qu'une phrase : l'information est la même,
  // mais elle se lit d'un coup d'œil au lieu de se déchiffrer.
  // Une seule ligne compacte plutôt que deux rangées : même information,
  // moitié moins de place sous une barre qui a déjà son propre libellé.
  const trNote = tr > 0.5
    ? `Sans TR : <strong>${fmt(netSansTR)}</strong> · TR perçus : <strong>${fmt(trValeurFaciale)}</strong>`
    : '';

  return `
  <div class="waterfall" role="img" aria-label="Répartition du salaire brut de ${fmt(brut)} : ${fmt(cotis)} de cotisations sociales, ${fmt(mutuelle)} de mutuelle, ${fmt(tr)} de titres restaurant, ${fmt(net)} de net">
    ${wfSeg('wf-bar-total', 'background:var(--surface); border:1.5px solid var(--line);', 'Brut', fmt(brut), 100)}
    ${wfSeg('wf-bar-cotis', `background:${STACK_COLORS.cotis}`, '− Cotisations sociales', '−' + fmt(cotis), pct(cotis))}
    ${wfSeg('wf-bar-mutuelle', `background:${STACK_COLORS.mutuelle}`, '− Mutuelle', '−' + fmt(mutuelle), pct(mutuelle))}
    ${tr > 0.5 ? wfSeg('wf-bar-tr', `background:${STACK_COLORS.tr}`, '− Titres restaurant', '−' + fmt(tr), pct(tr)) : ''}
    ${wfSeg('wf-bar-net', `background:${STACK_COLORS.net}`, '= Net', fmt(net), pct(net), trNote)}
  </div>`;
}

function renderInsight(computed){
  if(computed.length < 2) return '';
  const ref = computed.find(x => x.s.id === refId) || computed[0];
  const others = computed.filter(x => x.s.id !== refId);
  if(!others.length) return '';
  const best = others.reduce((a,b) => b.r.m.netApres > a.r.m.netApres ? b : a);
  const delta = best.r.m.netApres - ref.r.m.netApres;
  if(Math.abs(delta) < 1){
    return `<div class="insight neutral">Ces salaires donnent à peu près le même net.</div>`;
  }
  const diffBrut = best.r.m.brutTotal - ref.r.m.brutTotal;
  let convNote = '';
  if(diffBrut > 1 && delta > 0){
    const convPct = (delta/diffBrut)*100;
    convNote = ` — vous gardez ${convPct.toFixed(0)} % de l'augmentation en net`;
  }
  const verb = delta > 0 ? 'donne' : 'donne';
  const sign = delta > 0 ? 'de plus' : 'de moins';
  return `<div class="insight"><strong>${esc(best.s.name)}</strong> ${verb} ${fmt(Math.abs(delta))} ${sign} par mois que <strong>${esc(ref.s.name)}</strong>${convNote}.</div>`;
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

// ---------- Rendu ----------
function render(){
  const computed = scenarios.map(s => ({ s, r: compute(s, foyer) }));
  if(!scenarios.some(s => s.id === refId)) refId = scenarios[0].id;

  updateRaiseBaseName();
  const isSingle = computed.length === 1;
  document.getElementById('stackHint').textContent = isSingle
    ? 'Du brut au net, étape par étape.'
    : 'Cliquez sur une carte pour la définir comme référence.';
  document.getElementById('insightBox').innerHTML = renderInsight(computed);
  const stackChartEl = document.getElementById('stackChart');
  stackChartEl.className = isSingle ? '' : 'stack-chart';
  stackChartEl.innerHTML = isSingle ? renderWaterfall(computed) : renderStack(computed);
  if(isSingle) fixWaterfallLabelFit();
  bindRefPickers();
  document.getElementById('stackLegend').innerHTML = isSingle ? '' : renderStackLegend();
  document.getElementById('barsBody').innerHTML = renderBars(computed);
  document.getElementById('barsAlerts').innerHTML = renderAlerts(computed);
  updateFoyerImpot(computed);
  syncFoyerUI();
  document.getElementById('refSelect').innerHTML = scenarios
    .map(s => `<option value="${s.id}" ${s.id===refId?'selected':''}>${esc(s.name)}</option>`).join('');
  document.getElementById('cardsBody').innerHTML =
    computed.map(({s,r}) => renderCard(s, r, scenarios.length > 1)).join('') + renderAddCard();
  bindCardDragAndDrop();
  document.getElementById('addScenario').addEventListener('click', addScenario);
  // Nettoie la classe d'animation une fois jouée : les mises à jour légères
  // (updateComputed, sur chaque frappe) ne reconstruisent pas ces cartes,
  // la classe resterait donc collée indéfiniment sur un nœud DOM inerte sinon.
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
  justAddedId = null; // l'animation d'entrée ne doit jouer qu'une fois
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
      s.dureeType = btn.dataset.duree;
      document.querySelectorAll(`[data-durree-group="${id}"] button`).forEach(b => {
        b.setAttribute('aria-pressed', b.dataset.duree === s.dureeType ? 'true' : 'false');
      });
      updateComputed();
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
  const bouts = [foyer.couple ? 'En couple' : 'Seul(e)'];
  bouts.push(n === 0 ? 'sans personne à charge'
                     : (n === 1 ? '1 personne à charge' : `${n} personnes à charge`));
  if(foyer.couple && foyer.autresRevenus > 0) bouts.push(`conjoint ${fmt(foyer.autresRevenus)}/an`);
  return bouts.join(', ');
}

// L'impôt affiché dans le module suit le salaire de référence.
function updateFoyerImpot(computed){
  const ref = computed.find(x => x.s.id === refId) || computed[0];
  if(ref) setText('foyerImpot', `${fmt(ref.r.impotAnnuel/12)} / mois (${ref.r.tauxImpot.toFixed(1)} %)`);
}

function syncFoyerUI(){
  document.querySelectorAll('#foyerMode button').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.mode === foyer.mode ? 'true' : 'false');
  });
  setShown('foyerBaremeFields', foyer.mode !== 'taux');
  setShown('foyerTauxFields', foyer.mode === 'taux');

  document.querySelectorAll('#foyerSituation button').forEach(b => {
    b.setAttribute('aria-pressed', (b.dataset.foyer === 'couple') === foyer.couple ? 'true' : 'false');
  });
  // Les revenus du conjoint n'existent qu'en couple : le champ disparaît ET la
  // valeur est remise à zéro, pour que rien d'invisible n'entre dans le calcul.
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
      : 'En couple — revenus du conjoint à renseigner';
  }
  setText('foyerModuleDesc', resume);
  const desc = document.getElementById('foyerModuleDesc');
  if(desc) desc.classList.toggle('is-warn', alerte);

  setHTML('foyerImpotHint', foyer.mode === 'taux'
    ? `Le taux saisi s'applique tel quel au net imposable annuel du salaire de référence, sans recalcul ni progressivité.`
    : `Barème 2026 : abattement de 10 %, quotient familial (plafonné), décote. Le montant est le <em>supplément</em> d'impôt dû au salaire, pas l'impôt du foyer entier. Ne sont pas pris en compte : crédits et réductions d'impôt, revenus fonciers ou de capitaux, pensions, taux neutre ou individualisé.`);
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
      foyer.couple = btn.dataset.foyer === 'couple';
      if(!foyer.couple){
        foyer.autresRevenus = 0;
        const champ = document.getElementById('foyerConjoint');
        if(champ) champ.value = '0';
      }
      syncFoyerUI();
      updateComputed();
    });
  });
  const charges = document.getElementById('foyerCharges');
  if(charges) charges.addEventListener('change', () => {
    foyer.personnesCharge = Math.max(0, Math.min(4, Math.floor(parseNum(charges.value))));
    syncFoyerUI();
    updateComputed();
  });
  const conjoint = document.getElementById('foyerConjoint');
  if(conjoint) conjoint.addEventListener('input', () => {
    foyer.autresRevenus = Math.max(0, parseNum(conjoint.value));
    syncFoyerUI();
    updateComputed();
  });
  const pasRate = document.getElementById('foyerPasRate');
  if(pasRate) pasRate.addEventListener('input', () => {
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

function updateComputed(){
  const computed = scenarios.map(s => ({ s, r: compute(s, foyer) }));
  const isSingle = computed.length === 1;
  document.getElementById('insightBox').innerHTML = renderInsight(computed);
  const stackChartEl = document.getElementById('stackChart');
  stackChartEl.className = isSingle ? '' : 'stack-chart';
  stackChartEl.innerHTML = isSingle ? renderWaterfall(computed) : renderStack(computed);
  if(isSingle) fixWaterfallLabelFit();
  bindRefPickers();
  document.getElementById('barsBody').innerHTML = renderBars(computed);
  document.getElementById('barsAlerts').innerHTML = renderAlerts(computed);
  updateFoyerImpot(computed);
  syncFoyerUI();

  computed.forEach(({s, r}) => {
    const u = s.id;
    setText(`c-hero-${u}`, fmt(heroValue(r)));
    setText(`c-herolabel-${u}`, heroLabel());
    setHTML(`c-heropas-${u}`, `Après impôt : <strong>${fmt(heroPasValue(r))}</strong>`);
    setShown(`c-heropas-${u}`, heroPasShown());

    const hint = document.getElementById(`rate-hint-${u}`);
    if(hint) hint.innerHTML = `Taux effectif : <strong>${r.tauxEffectif.toFixed(1)} %</strong> du brut`;

    const trWarn = r.tr.reintegre > 0.005;
    setShown(`c-trwarn-${u}`, trWarn);
    if(trWarn){
      const motifs = {
        sous50: `Part patronale sous 50 % : la totalité de la participation employeur redevient soumise aux cotisations.`,
        sur60: `Part patronale au-delà de 60 % : la fraction excédentaire redevient soumise aux cotisations.`,
        plafond: `Part patronale au-delà du plafond par titre : la fraction excédentaire redevient soumise aux cotisations.`
      };
      setHTML(`c-trwarn-text-${u}`, motifs[r.tr.motif] || '');
    }
  });
  saveState();
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
function onInput(e){
  const id = parseInt(e.target.dataset.id, 10);
  const key = e.target.dataset.key;
  const s = findScenario(id);
  if(!s) return;
  if(key === 'name'){
    s.name = e.target.value;
    updateComputed();
    if(s.id === refId){ setText('raiseBaseName', s.name); setText('absenceBaseName', s.name); }
    document.getElementById('refSelect').innerHTML = scenarios
      .map(x => `<option value="${x.id}" ${x.id===refId?'selected':''}>${esc(x.name)}</option>`).join('');
    return;
  }
  s[key] = parseNum(e.target.value);
  updateComputed();
}

function onBlurClamp(e){
  const key = e.target.dataset.key;
  if(key === 'name') return;
  const id = parseInt(e.target.dataset.id, 10);
  const s = findScenario(id);
  if(!s) return;
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
  disableCardSnap();
  const created = mkScenario(Object.assign({
    name:'Salaire ' + (scenarios.length+1),
    dureeType:last.dureeType
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
  setTimeout(() => { overlay.hidden = true; overlay.innerHTML = ''; }, 200);
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

const ONBOARDING_MUTUELLE_DEFAUT = 30;

// Bloc mutuelle/TR réutilisé par la pop-up d'onboarding et par l'ajout d'un
// nouveau salaire, pour ne jamais deviner silencieusement ces montants.
function renderMutuelleTrFields(idPrefix){
  return `
        <div class="field-row">
          <label for="${idPrefix}Mutuelle">Mutuelle (€ / mois)</label>
          <input type="text" inputmode="decimal" id="${idPrefix}Mutuelle" placeholder="${ONBOARDING_MUTUELLE_DEFAUT}" autocomplete="off">
          <div class="sub-hint">Par défaut : ${ONBOARDING_MUTUELLE_DEFAUT} €/mois.</div>
        </div>
        <div class="field-row" style="margin-bottom:0;">
          <label>Avez-vous des titres restaurant ?</label>
          <div class="pill-toggle" id="${idPrefix}TrToggle" role="group" aria-label="Titres restaurant">
            <button type="button" data-tr="non" aria-pressed="true">Non</button>
            <button type="button" data-tr="oui" aria-pressed="false">Oui</button>
          </div>
        </div>
        <div id="${idPrefix}TrFields" hidden style="margin-top:14px;">
          <div class="three-col">
            <div class="field-row"><label for="${idPrefix}Jours">Jours/mois</label><input type="text" inputmode="decimal" id="${idPrefix}Jours" value="21"></div>
            <div class="field-row"><label for="${idPrefix}Valeur">Valeur (€)</label><input type="text" inputmode="decimal" id="${idPrefix}Valeur" value="8"></div>
            <div class="field-row"><label for="${idPrefix}Part">Part salariale (%)</label><input type="text" inputmode="decimal" id="${idPrefix}Part" value="50"></div>
          </div>
        </div>`;
}

// Branche les interactions du bloc ci-dessus et renvoie une fonction de
// lecture : { mutuelle, joursResto, [valeurResto, partResto] }.
function bindMutuelleTrFields(overlay, idPrefix){
  const mutuelleInput = overlay.querySelector(`#${idPrefix}Mutuelle`);
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
      // Les nouveaux champs révélés peuvent tomber hors de la zone visible
      // (surtout modale + clavier) sans qu'aucun focus ne les y ramène.
      if(trOui) setTimeout(() => trFields.scrollIntoView({ behavior:'smooth', block:'nearest' }), 50);
    });
  });

  return () => {
    const mutuelleRaw = mutuelleInput.value.trim();
    const mutuelle = mutuelleRaw === '' ? ONBOARDING_MUTUELLE_DEFAUT : Math.max(0, parseNum(mutuelleRaw));
    const result = { mutuelle, joursResto: 0 };
    if(trOui){
      result.joursResto = Math.max(0, Math.min(31, parseNum(joursInput.value)));
      result.valeurResto = Math.max(0, parseNum(valeurInput.value));
      result.partResto = Math.max(0, Math.min(100, parseNum(partInput.value)));
    }
    return result;
  };
}

function showOnboardingModal(){
  const html = `
    <p id="modalMsg" class="modal-msg">Commencez par votre salaire actuel — vous pourrez en ajouter d'autres à comparer ensuite.</p>
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
    </div>

    ${renderMutuelleTrFields('modalOnboarding')}

    <div class="modal-actions" style="margin-top:18px;">
      <button type="button" class="btn btn-primary" id="modalOnboardingSubmit" style="width:100%;" disabled>Continuer</button>
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
  dureeToggle.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      dureeType = b.dataset.duree;
      dureeToggle.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
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
    <div class="field-row" style="margin:0 0 14px;">
      <label for="modalAddInput">Salaire brut mensuel (€)</label>
      <input type="text" inputmode="decimal" id="modalAddInput" value="${brutPrefill || ''}" autocomplete="off">
    </div>
    <div class="field-row" style="margin:0 0 4px;">
      <label>Base horaire</label>
      <div class="pill-toggle" id="modalAddDuree">
        <button type="button" data-duree="35" aria-pressed="${dureePrefill !== '39'}">35 h</button>
        <button type="button" data-duree="39" aria-pressed="${dureePrefill === '39'}">39 h</button>
      </div>
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

  let dureeType = dureePrefill === '39' ? '39' : '35';
  const dureeToggle = overlay.querySelector('#modalAddDuree');
  dureeToggle.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      dureeType = b.dataset.duree;
      dureeToggle.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    });
  });

  const trySubmit = () => {
    const v = parseNum(input.value);
    if(!(v > 0)) return;
    closeModal(Object.assign({ brut: v, dureeType }, readMutuelleTr()));
  };
  const updateSubmitState = () => { submitBtn.disabled = !(parseNum(input.value) > 0); };
  updateSubmitState();
  input.addEventListener('input', updateSubmitState);
  input.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); trySubmit(); } });
  submitBtn.addEventListener('click', trySubmit);
  overlay.querySelector('#modalAddCancel').addEventListener('click', () => closeModal(false));
  return pending;
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
    displayAmt = b.dataset.amt;
    document.querySelectorAll('#amtToggle button').forEach(x => x.setAttribute('aria-pressed', x===b?'true':'false'));
    updateComputed();
  });
});
document.querySelectorAll('#periodToggle button').forEach(b => {
  b.addEventListener('click', () => {
    displayPeriod = b.dataset.period;
    document.querySelectorAll('#periodToggle button').forEach(x => x.setAttribute('aria-pressed', x===b?'true':'false'));
    updateComputed();
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
bindModuleToggle('absenceModule', 'absenceModuleToggle', 'absenceModuleBody');

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
  setText('absenceBaseName', base ? base.name : '');
}

document.querySelectorAll('.raise-type-toggle button').forEach(btn => {
  btn.addEventListener('click', () => {
    raiseType = btn.dataset.rtype;
    document.querySelectorAll('.raise-type-toggle button').forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
    document.getElementById('raiseAmount').value = raiseType === 'pct' ? '5' : '150';
  });
});
document.getElementById('addRaiseScenario').addEventListener('click', () => {
  const val = parseNum(document.getElementById('raiseAmount').value);
  addRaiseScenario(raiseType, val);
});
renderRaiseChips();

// ---------- Simulateur d'absence (congés payés / arrêt de travail) ----------
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
    // Un ajout lancé depuis les modules d'augmentation ou d'absence, situés plus
    // bas dans la page, faisait défiler le rail hors de vue : on ne voyait pas
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

let absenceType = 'conges';
let carenceCouverte = false;

function updateAbsenceUI(){
  document.querySelectorAll('#absenceTypeToggle button').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.atype === absenceType ? 'true' : 'false');
  });
  document.getElementById('arretExtraFields').style.display = absenceType === 'arret' ? '' : 'none';
  document.getElementById('addAbsenceScenario').textContent =
    absenceType === 'arret' ? 'Ajouter ce salaire en arrêt de travail' : 'Ajouter ce salaire en congés payés';
  const duree = parseNum(document.getElementById('absenceDuree').value) || 0;
  const pct = parseNum(document.getElementById('arretPct').value) || 90;
  setText('absenceHint', absenceType === 'arret'
    ? `Sur ${duree} j d'arrêt, le reste du mois (${Math.max(0,30-duree)} j) est payé normalement. Sur les jours d'arrêt : ${carenceCouverte ? 'la carence est payée, donc tous les jours sont indemnisés' : 'les 3 premiers jours (carence) ne sont pas payés'}, le reste à ${pct} %.`
    : `Sur ${duree} j de congés, le salaire de base reste maintenu ; le reste du mois (${Math.max(0,30-duree)} j) est payé normalement. Aucun titre restaurant sur les jours de congés.`);
}

document.querySelectorAll('#absenceTypeToggle button').forEach(btn => {
  btn.addEventListener('click', () => { absenceType = btn.dataset.atype; updateAbsenceUI(); });
});
document.getElementById('absenceDuree').addEventListener('input', updateAbsenceUI);

document.getElementById('ancienneteSelect').addEventListener('change', (e) => {
  const v = e.target.value;
  const pctRow = document.getElementById('arretPctRow');
  if(v === 'custom'){
    pctRow.style.display = '';
  } else {
    pctRow.style.display = 'none';
    document.getElementById('arretPct').value = v;
  }
  updateAbsenceUI();
});
document.getElementById('arretPct').addEventListener('input', updateAbsenceUI);

document.querySelectorAll('#carenceToggle button').forEach(btn => {
  btn.addEventListener('click', () => {
    carenceCouverte = btn.dataset.carence === 'oui';
    document.querySelectorAll('#carenceToggle button').forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
    updateAbsenceUI();
  });
});

function addAbsenceScenario(){
  const base = findScenario(refId);
  if(!base) return;
  const duree = clamp(parseNum(document.getElementById('absenceDuree').value) || 0, 0, 30);
  const clone = Object.assign({}, base);
  delete clone.id;
  disableCardSnap();

  let created;
  if(absenceType === 'arret'){
    const pct = clamp(parseNum(document.getElementById('arretPct').value) || 90, 0, 100);
    created = mkScenario(Object.assign(clone, {
      name: `${base.name} (arrêt ${duree}j, ${pct}%)`,
      absenceType: 'arret', absenceDuree: duree, maintienPct: pct, carenceCouverte
    }));
    scenarios.push(created);
  } else {
    created = mkScenario(Object.assign(clone, {
      name: `${base.name} (congés ${duree}j)`,
      absenceType: 'conges', absenceDuree: duree
    }));
    scenarios.push(created);
  }
  justAddedId = created.id;
  render();
  scrollToNewCard();
}

document.getElementById('addAbsenceScenario').addEventListener('click', addAbsenceScenario);
updateAbsenceUI();

render();
if(showOnboarding){
  showOnboardingModal().then(result => {
    Object.assign(scenarios[0], result);
    render();
  });
}
