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
document.getElementById('maquetteAddSalary')?.addEventListener('click',()=>addScenario(true));

if(showOnboarding){
  showOnboardingModal().then(result => {
    Object.assign(scenarios[0], result);
    onboardingCompleted = true;
    urssafSessionState.grantConsent();
    render();
    saveState();
    scheduleUrssafCalculations(true,true);
  });
}
