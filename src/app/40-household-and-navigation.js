// ---------- Mise à jour ciblée (ne touche jamais aux champs en cours de saisie) ----------
function setText(id, txt){ const el = document.getElementById(id); if(el) el.textContent = txt; }
function setHTML(id, html){ const el = document.getElementById(id); if(el) el.innerHTML = html; }
function setShown(id, shown){ const el = document.getElementById(id); if(el) el.style.display = shown ? '' : 'none'; }

function updateComputed(options = {}){
  const computed = getCurrentComputed();
  renderComparisonChart(computed);
  bindRefPickers();
  document.getElementById('benchmarkBody').innerHTML = renderBenchmarks(computed);
  renderMaquetteControls(computed);

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
    const error = getCalculationError(s);
    if(state) state.textContent = r
      ? 'Calculé via l’API officielle Mon-entreprise (Urssaf).'
      : (error || 'Calcul en attente de validation par l’API Urssaf.');
    if(card) card.dataset.resultState = r ? 'ready' : (error ? 'error' : 'pending');
    const warnings = document.getElementById(`c-result-warnings-${u}`);
    if(warnings){
      warnings.hidden = !(r && r.warnings && r.warnings.length);
      warnings.innerHTML = r && r.warnings && r.warnings.length
        ? `<details><summary>Voir les messages (${r.warnings.length})</summary><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>`
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

