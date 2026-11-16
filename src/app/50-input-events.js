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

let addScenarioPending = false;
async function addScenario(){
  if(addScenarioPending || modalState) return;
  addScenarioPending = true;
  const trigger = document.getElementById('maquetteAddSalary');
  if(trigger) trigger.disabled = true;
  try{
    const last = scenarios[scenarios.length-1];
    const answers = await showAddScenarioModal(last.brut, last.dureeType, 'Offre ' + (scenarios.length + 1));
    if(!answers) return;
    grantUrssafConsent();
    disableCardSnap();
    const created = mkScenario(Object.assign({
      name:'Salaire ' + (scenarios.length+1),
      dureeType:last.dureeType,
      commune:last.commune || 'Pacé'
    }, answers));
    scenarios.push(created);
    justAddedId = created.id;
    render();
    setTimeout(()=>{
      scrollToNewCard();
    }, 220);
  } finally {
    addScenarioPending = false;
    if(trigger) trigger.disabled = false;
  }
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

document.getElementById('urssafConsentGrant')?.addEventListener('click', () => {
  grantUrssafConsent();
  scheduleUrssafCalculations(true, false);
});

document.getElementById('urssafConsentRevoke')?.addEventListener('click', () => {
  revokeUrssafConsent();
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  const ok = await showConfirmModal(
    'Effacer tous les salaires enregistrés et revenir à l\'exemple de départ ? Cette action est irréversible.',
    { danger:true, confirmLabel:'Effacer' }
  );
  if(!ok) return;
  clearPersistedState();
  location.reload();
});

