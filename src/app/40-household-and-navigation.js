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
  if(charges){
    charges.addEventListener('change', () => {
      foyer.personnesCharge = Math.max(0, Math.min(4, Math.floor(parseNum(charges.value))));
      if(foyer.personnesCharge === 0) foyer.parentIsole = false;
      syncFoyerUI();
      updateComputed();
    });
  }
  const parentIsole = document.getElementById('foyerParentIsole');
  if(parentIsole){
    parentIsole.addEventListener('change', () => {
      foyer.parentIsole = parentIsole.checked;
      syncFoyerUI();
      updateComputed();
    });
  }
  const conjoint = document.getElementById('foyerConjoint');
  if(conjoint){
    conjoint.addEventListener('input', () => {
    if(!validateNumericInput(conjoint, false)) return;
    foyer.autresRevenus = Math.max(0, parseNum(conjoint.value));
    syncFoyerUI();
    updateComputed();
      });
  }
  const pasRate = document.getElementById('foyerPasRate');
  if(pasRate){
    pasRate.addEventListener('input', () => {
    if(!validateNumericInput(pasRate, false)) return;
    foyer.pasRate = clamp(parseNum(pasRate.value), 0, 100);
    syncFoyerUI();
    updateComputed();
      });
  }
  // Refléter l'état restauré (localStorage ou lien partagé) dans les champs.
  if(charges){
    charges.value = String(Math.min(4, foyer.personnesCharge));
  }
  if(conjoint){
    conjoint.value = String(foyer.autresRevenus);
  }
  if(pasRate){
    pasRate.value = String(foyer.pasRate);
  }
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
    if(basisRow){
      basisRow.style.display = s.dureeType === '39' && s.nbMois > 12 ? '' : 'none';
    }
    setText(`c-hero-${u}`, r && heroValue(r) !== null ? fmt(heroValue(r)) : '—');
    setText(`c-herolabel-${u}`, heroLabel());

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

