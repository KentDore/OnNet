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
  overlay.innerHTML = `<div id="modalBox" class="modal" role="${o.role === 'dialog' ? 'dialog' : 'alertdialog'}" aria-modal="true" tabindex="-1">${bodyHtml}</div>`;
  const box = overlay.querySelector('#modalBox');
  if(o.className) box.classList.add(o.className);
  if(o.ariaLabel) box.setAttribute('aria-label',o.ariaLabel);
  else if(box.querySelector('#modalMsg')) box.setAttribute('aria-describedby','modalMsg');

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
function renderUrssafConsentNotice(compact = false){
  if(compact){
    return `
      <div class="onboarding-consent onboarding-consent-compact">
        <span class="onboarding-consent-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg></span>
        <p>Au clic sur Enregistrer, le salaire et ses paramètres sont transmis à l’API Urssaf.</p>
      </div>`;
  }
  return `
    <div class="onboarding-consent">
      <div class="onboarding-consent-top">
        <span class="onboarding-mutuelle-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg></span>
        <span class="onboarding-consent-copy"><strong>Calcul officiel Urssaf</strong><small>Aucun salaire transmis avant validation</small></span>
      </div>
      <details class="onboarding-consent-details">
        <summary>Quelles données sont transmises ?</summary>
        <p>En validant ce formulaire, vous autorisez la transmission à l’API officielle Mon-entreprise de l’Urssaf des paramètres nécessaires au calcul : salaire brut, durée du travail, commune, mutuelle et titres-restaurant.</p>
      </details>
    </div>`;
}

function renderMutuelleTrFields(idPrefix){
  return `
    <div class="onboarding-benefits">
      <div class="onboarding-mutuelle-note">
        <span class="onboarding-mutuelle-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"></path><path d="m9 12 2 2 4-4"></path></svg>
        </span>
        <strong class="onboarding-mutuelle-label">Mutuelle</strong>
        <strong>30 € salarié</strong>
      </div>
      <div class="onboarding-tr">
        <div class="onboarding-tr-heading">
          <span class="onboarding-mutuelle-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M8 15h3"/></svg></span>
          <strong>Titres-restaurant</strong>
        </div>
        <div class="pill-toggle onboarding-tr-toggle" id="${idPrefix}TrToggle" role="group" aria-label="Avez-vous des titres-restaurant ?">
          <button type="button" data-tr="non" aria-pressed="true">Non</button>
          <button type="button" data-tr="oui" aria-pressed="false">Oui</button>
        </div>
        <div id="${idPrefix}TrFields" class="onboarding-tr-fields" hidden>
          <div class="three-col">
            <div class="field-row"><label for="${idPrefix}Jours">Jours/mois</label><input type="number" inputmode="numeric" min="0" max="31" step="1" id="${idPrefix}Jours" value="21"></div>
            <div class="field-row"><label for="${idPrefix}Valeur">Valeur faciale (€)</label><input type="number" inputmode="decimal" min="0" max="500" step="0.01" id="${idPrefix}Valeur" value="8"></div>
            <div class="field-row"><span class="field-label">Part salariale</span><div class="pill-toggle meal-share-toggle" id="${idPrefix}Part" role="group" aria-label="Part salariale des titres-restaurant"><button type="button" data-share="50" aria-pressed="true">50 %</button><button type="button" data-share="40" aria-pressed="false">40 %</button></div></div>
          </div>
        </div>
      </div>
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
  let partResto = 50;
  let trOui = false;
  partInput.querySelectorAll('button[data-share]').forEach(button=>button.addEventListener('click',()=>{
    partResto=Number(button.dataset.share);
    partInput.querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  }));
  trToggle.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      trOui = b.dataset.tr === 'oui';
      trToggle.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      trFields.hidden = !trOui;
      
    });
  });
  const read = () => {
    const result = { mutuelle:30, mutuellePat:30, joursResto:0 };
    if(trOui){
      result.joursResto = Math.round(clamp(parseNum(joursInput.value), 0, 31));
      result.valeurResto = clamp(parseNum(valeurInput.value), 0, 500);
      result.partResto = partResto;
    }
    return result;
  };
  read.isValid = () => !trOui || [joursInput, valeurInput].every(input =>
    input.value.trim() !== '' && input.checkValidity()
  );
  return read;
}

function formatSalaryInput(input){
  const value = parseNum(input.value);
  if(!(value > 0)) return;
  input.value = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
}

function showOnboardingModal(){
  const html = `
    <p id="modalMsg" class="modal-msg"></p>
        ${renderUrssafConsentNotice()}
    <div class="field-row" style="margin:0 0 14px;">
      <label>Votre salaire est indiqué en</label>
      <div class="pill-toggle" id="modalOnboardingPeriod" role="group" aria-label="Période du salaire">
        <button type="button" data-period="mois" aria-pressed="true">Mensuel</button>
        <button type="button" data-period="an" aria-pressed="false">Annuel</button>
      </div>
    </div>
    <div class="field-row" style="margin:0 0 14px;">
      <label for="modalOnboardingInput" id="modalOnboardingLabel">Salaire brut mensuel (€)</label>
      <input type="text" inputmode="decimal" id="modalOnboardingInput" placeholder="Ex. 2 500" autocomplete="off">
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
      <button type="button" class="btn btn-primary" id="modalOnboardingSubmit" style="width:100%;" disabled>Continuer et lancer le calcul</button>
    </div>`;
  const pending = openModal(html, { initialFocusSelector: '#modalOnboardingPeriod button', dismissible: false, className: 'modal-onboarding' });
  const overlay = document.getElementById('modalOverlay');
  const input = overlay.querySelector('#modalOnboardingInput');
  const submitBtn = overlay.querySelector('#modalOnboardingSubmit');
  const readMutuelleTr = bindMutuelleTrFields(overlay, 'modalOnboarding');
  const periodToggle = overlay.querySelector('#modalOnboardingPeriod');
  const periodLabel = overlay.querySelector('#modalOnboardingLabel');
  let salaryPeriod = 'mois';
  periodToggle.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => {
      salaryPeriod = button.dataset.period;
      periodToggle.querySelectorAll('button').forEach(x => {
        x.setAttribute('aria-pressed', x === button ? 'true' : 'false');
      });
      const annual = salaryPeriod === 'an';
      periodLabel.textContent = annual ? 'Salaire brut annuel (€)' : 'Salaire brut mensuel (€)';
      input.placeholder = annual ? 'Ex. 30 000' : 'Ex. 2 500';
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
    if(!readMutuelleTr.isValid()){
      setText('modalMsg', 'Vérifiez les titres-restaurant : 0 à 31 jours entiers, 0 à 500 € par titre et une part salariale de 40 à 50 %.');
      return;
    }
    const brutMensuel = salaryPeriod === 'an' ? v / 12 : v;
    const result = Object.assign({ brut: brutMensuel, dureeType, salaireSaisi: v, salaireSaisiPeriode: salaryPeriod }, readMutuelleTr());
    closeModal(result);
  };
  input.addEventListener('input', () => { submitBtn.disabled = !(parseNum(input.value) > 0); });
  input.addEventListener('blur', () => formatSalaryInput(input));
  input.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); trySubmit(); } });
  submitBtn.addEventListener('click', trySubmit);
  return pending;
}

// Redemandé à chaque nouveau salaire — le brut et les avantages (mutuelle,
// TR) diffèrent souvent d'une offre à l'autre, impossible de les deviner
// silencieusement.

function showAddScenarioModal(brutPrefill, dureePrefill, namePrefill){
  const initialSalary = Number.isFinite(Number(brutPrefill)) && Number(brutPrefill) > 0
    ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, useGrouping: false }).format(Number(brutPrefill))
    : '';
  const html = `
    <p id="modalMsg" class="modal-msg"></p>
    <div class="field-row" style="margin:0 0 14px;">
      <label for="modalAddName">Nom de l’offre <span class="field-optional">(facultatif)</span></label>
      <input type="text" id="modalAddName" maxlength="60" value="${esc(namePrefill || 'Nouvelle offre')}" autocomplete="off">
    </div>
        ${renderUrssafConsentNotice()}
    <div class="field-row" style="margin:0 0 14px;">
      <label>Votre salaire est indiqué en</label>
      <div class="pill-toggle" id="modalAddPeriod" role="group" aria-label="Période du salaire">
        <button type="button" data-period="mois" aria-pressed="true">Mensuel</button>
        <button type="button" data-period="an" aria-pressed="false">Annuel</button>
      </div>
    </div>
    <div class="field-row" style="margin:0 0 14px;">
      <label for="modalAddInput" id="modalAddLabel">Salaire brut mensuel (€)</label>
      <input type="text" inputmode="decimal" id="modalAddInput" value="${initialSalary}" placeholder="Ex. 2 500" autocomplete="off">
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
  const nameInput = overlay.querySelector('#modalAddName');
  const submitBtn = overlay.querySelector('#modalAddSubmit');
  const readMutuelleTr = bindMutuelleTrFields(overlay, 'modalAdd');
  const periodToggle = overlay.querySelector('#modalAddPeriod');
  const periodLabel = overlay.querySelector('#modalAddLabel');
  let salaryPeriod = 'mois';
  let exactSalaryValue = parseNum(brutPrefill);
  periodToggle.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => {
      if(button.dataset.period === salaryPeriod) return;
      const current = exactSalaryValue || parseNum(input.value);
      if(current > 0){
        exactSalaryValue = salaryPeriod === 'mois' ? current * 12 : current / 12;
        input.value = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, useGrouping: false }).format(exactSalaryValue);
      }
      salaryPeriod = button.dataset.period;
      periodToggle.querySelectorAll('button').forEach(x => {
        x.setAttribute('aria-pressed', x === button ? 'true' : 'false');
      });
      const annual = salaryPeriod === 'an';
      periodLabel.textContent = annual ? 'Salaire brut annuel (€)' : 'Salaire brut mensuel (€)';
      input.placeholder = annual ? 'Ex. 30 000' : 'Ex. 2 500';
      updateSubmitState();
    });
  });

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
    if(!readMutuelleTr.isValid()){
      setText('modalMsg', 'Vérifiez les titres-restaurant : 0 à 31 jours entiers, 0 à 500 € par titre et une part salariale de 40 à 50 %.');
      return;
    }
    const brutMensuel = salaryPeriod === 'an' ? v / 12 : v;
    const defaultName = String(namePrefill || 'Nouvelle offre').trim() || 'Nouvelle offre';
    const name = nameInput.value.trim().slice(0, 60) || defaultName;
    closeModal(Object.assign({ brut: brutMensuel, dureeType, name, salaireSaisi: v, salaireSaisiPeriode: salaryPeriod }, readMutuelleTr()));
  };
  const updateSubmitState = () => { submitBtn.disabled = !(parseNum(input.value) > 0); };
  updateSubmitState();
  input.addEventListener('input', () => {
    exactSalaryValue = parseNum(input.value);
    updateSubmitState();
  });
  input.addEventListener('blur', () => formatSalaryInput(input));
  input.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); trySubmit(); } });
  submitBtn.addEventListener('click', trySubmit);
  overlay.querySelector('#modalAddCancel').addEventListener('click', () => closeModal(false));
  return pending;
}


// Édition compacte d'une offre dans une fenêtre flottante.
// Les paramètres historiques masqués restent dans l'objet d'origine et ne sont
// ni écrasés ni ajoutés artificiellement au calcul net.
function showEditScenarioModal(scenario){
  const initialPeriod = scenario.salaireSaisiPeriode === 'an' ? 'an' : 'mois';
  const initialSalary = Number.isFinite(Number(scenario.salaireSaisi)) && Number(scenario.salaireSaisi) > 0
    ? Number(scenario.salaireSaisi)
    : Number(scenario.brut) * (initialPeriod === 'an' ? 12 : 1);
  const initialMutuelle = scenario.mutuelle != null && Number.isFinite(Number(scenario.mutuelle)) ? Number(scenario.mutuelle) : 30;
  const trEnabled = Number(scenario.joursResto)>0 || Number(scenario.valeurResto)>0;
  const initialShare = Number(scenario.partResto)===40 ? 40 : 50;
  const html = `
    <div class="edit-offer-modal">
      <div class="field-row">
        <label for="editOfferName">Nom de l’offre <span class="field-optional">(facultatif)</span></label>
        <input type="text" id="editOfferName" maxlength="80" value="${esc(scenario.name)}" autocomplete="off">
      </div>
      ${renderUrssafConsentNotice(true)}
      <div class="field-row edit-offer-inline-row">
        <span class="field-label">Votre salaire est indiqué en</span>
        <div class="pill-toggle" id="editOfferPeriod" role="group" aria-label="Période du salaire brut">
          <button type="button" data-period="mois" aria-pressed="${initialPeriod==='mois'}">Mensuel</button>
          <button type="button" data-period="an" aria-pressed="${initialPeriod==='an'}">Annuel</button>
        </div>
      </div>
      <div class="field-row">
        <label for="editOfferGross" id="editOfferGrossLabel">Salaire brut ${initialPeriod==='an'?'annuel':'mensuel'} (€)</label>
        <input type="text" inputmode="decimal" id="editOfferGross" value="${String(initialSalary).replace('.', ',')}" autocomplete="off">
      </div>
      <div class="field-row edit-offer-inline-row">
        <span class="field-label">Base horaire</span>
        <div class="pill-toggle" id="editOfferHours" role="group" aria-label="Base horaire">
          <button type="button" data-hours="35" aria-pressed="${scenario.dureeType!=='39'}">35 h</button>
          <button type="button" data-hours="39" aria-pressed="${scenario.dureeType==='39'}">39 h</button>
        </div>
      </div>
      <div class="onboarding-benefits edit-offer-benefits">
        <div class="onboarding-mutuelle-note">
          <span class="onboarding-mutuelle-icon" aria-hidden="true">✓</span>
          <strong class="onboarding-mutuelle-label">Mutuelle</strong>
          <button type="button" id="editOfferMutuelleToggle" class="edit-offer-mutuelle-value" aria-expanded="false">${new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(initialMutuelle)} € / mois</button>
        </div>
        <div id="editOfferMutuelleEditor" class="edit-offer-mutuelle-editor" hidden>
          <label for="editOfferMutuelle">Votre part mensuelle (€)</label>
          <input type="text" inputmode="decimal" id="editOfferMutuelle" value="${String(initialMutuelle).replace('.', ',')}" autocomplete="off">
        </div>
        <div class="onboarding-tr edit-offer-tr">
          <div class="onboarding-tr-heading"><strong>Titres-restaurant</strong></div>
          <div class="pill-toggle onboarding-tr-toggle" id="editOfferTrToggle" role="group" aria-label="Titres-restaurant">
            <button type="button" data-tr="non" aria-pressed="${!trEnabled}">Non</button>
            <button type="button" data-tr="oui" aria-pressed="${trEnabled}">Oui</button>
          </div>
          <div id="editOfferTrFields" class="onboarding-tr-fields" ${trEnabled?'':'hidden'}>
            <div class="three-col">
              <div class="field-row"><label for="editOfferMealDays">Jours/mois</label><input type="number" id="editOfferMealDays" min="0" max="31" step="1" value="${Number(scenario.joursResto)||0}"></div>
              <div class="field-row"><label for="editOfferMealValue">Valeur faciale (€)</label><input type="text" inputmode="decimal" id="editOfferMealValue" value="${String(scenario.valeurResto||0).replace('.', ',')}"></div>
              <div class="field-row"><span class="field-label">Part salariale</span><div class="pill-toggle meal-share-toggle" id="editOfferMealShare"><button type="button" data-share="50" aria-pressed="${initialShare===50}">50 %</button><button type="button" data-share="40" aria-pressed="${initialShare===40}">40 %</button></div></div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn modal-btn-cancel" id="editOfferCancel">Annuler</button>
        <button type="button" class="btn btn-primary" id="editOfferSave">Enregistrer</button>
      </div>
    </div>`;
  const pending = openModal(html, { initialFocusSelector:'#editOfferPeriod button', className:'modal-edit-offer', dismissible:true, role:'dialog', ariaLabel:'Modifier une offre salariale' });
  const overlay = document.getElementById('modalOverlay');
  const input = id => overlay.querySelector('#'+id);
  let period = initialPeriod;
  let hours = scenario.dureeType==='39'?'39':'35';
  let trEnabledNow = trEnabled;
  let mealShare = initialShare;
  const initialMealDays = Number(scenario.joursResto)||0;
  const initialMealValue = Number(scenario.valeurResto)||0;
  const periodToggle = input('editOfferPeriod');
  const grossInput = input('editOfferGross');
  periodToggle.querySelectorAll('button[data-period]').forEach(button=>button.addEventListener('click',()=>{
    if(button.dataset.period===period) return;
    const amount=parseNum(grossInput.value);
    if(!(amount>0)) return;
    grossInput.value=String(period==='mois'?amount*12:amount/12).replace('.', ',');
    period=button.dataset.period;
    periodToggle.querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
    input('editOfferGrossLabel').textContent='Salaire brut '+(period==='an'?'annuel':'mensuel')+' (€)';
  }));
  input('editOfferHours').querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{
    hours=button.dataset.hours;
    input('editOfferHours').querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  }));
  input('editOfferMutuelleToggle').addEventListener('click',()=>{
    const editor=input('editOfferMutuelleEditor');
    const expanded=editor.hidden;
    editor.hidden=!expanded;
    input('editOfferMutuelleToggle').setAttribute('aria-expanded',String(expanded));
    if(expanded) input('editOfferMutuelle').focus();
  });
  input('editOfferTrToggle').querySelectorAll('button[data-tr]').forEach(button=>button.addEventListener('click',()=>{
    trEnabledNow=button.dataset.tr==='oui';
    input('editOfferTrToggle').querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
    input('editOfferTrFields').hidden=!trEnabledNow;
    updateSaveState();
  }));
  input('editOfferMealShare').querySelectorAll('button[data-share]').forEach(button=>button.addEventListener('click',()=>{
    mealShare=Number(button.dataset.share);
    input('editOfferMealShare').querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  }));
  const validNumber=id=>input(id).value.trim()!==''&&numericEntryValid(input(id).value)&&Number.isFinite(parseNum(input(id).value));
  const updateSaveState=()=>{
    const gross=parseNum(grossInput.value);
    const mutuelle= input('editOfferMutuelle').value;
    const mealDays=Number(input('editOfferMealDays').value);
    const mealValue=parseNum(input('editOfferMealValue').value);
    const mealConfigUnchanged=trEnabledNow===trEnabled&&mealDays===initialMealDays&&mealValue===initialMealValue&&mealShare===initialShare;
    const mealConfigValid=Number.isInteger(mealDays)&&mealDays>=1&&mealDays<=31&&validNumber('editOfferMealValue')&&mealValue>0&&mealValue<=500;
    const valid=gross>0&&gross<=1200000&&validNumber('editOfferMutuelle')&&parseNum(mutuelle)>=0&&parseNum(mutuelle)<=100000&&
      (!trEnabledNow||mealConfigValid||mealConfigUnchanged);
    input('editOfferSave').disabled=!valid;
  };
  ['editOfferGross','editOfferMutuelle','editOfferMealDays','editOfferMealValue'].forEach(id=>input(id).addEventListener('input',updateSaveState));
  updateSaveState();
  input('editOfferSave').addEventListener('click',()=>{
    const gross=parseNum(grossInput.value);
    const result={
      name:input('editOfferName').value.trim().slice(0,80)||'Offre',
      brut:period==='an'?gross/12:gross,
      salaireSaisi:gross,salaireSaisiPeriode:period,
      dureeType:hours,
      commune:scenario.commune||'Pacé',codePostal:scenario.codePostal||'',departement:scenario.departement||'',
      codeCommune:scenario.codeCommune||'',codeDepartement:scenario.codeDepartement||'',
      mutuelle:parseNum(input('editOfferMutuelle').value),
      mutuellePat:Number.isFinite(Number(scenario.mutuellePat))?Number(scenario.mutuellePat):30,
      joursResto:trEnabledNow?Number(input('editOfferMealDays').value):0,
      valeurResto:trEnabledNow?parseNum(input('editOfferMealValue').value):0,
      partResto:trEnabledNow?mealShare:50,
      nbMois:Number(scenario.nbMois)||12,primes:Number(scenario.primes)||0,
      treiziemeMoisBase:scenario.treiziemeMoisBase==='ensemble'?'ensemble':'base'
    };
    closeModal(result);
  });
  input('editOfferCancel').addEventListener('click',()=>closeModal(false));
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
  const toOpen = Array.from(document.querySelectorAll('details.more, #moreMetrics, #legacySalaryCards'));
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

// ---------- Retour haptique progressif sur les appareils compatibles ----------
// Safari iOS ne fournit pas l'API Vibration : les animations CSS restent
// le retour tactile universel, sans simuler une vibration inexistante.
const ONNET_HAPTIC_TARGETS = [
  '#shareBtn', '#maquetteAddSalary', '#addRaiseScenario', '#headerMenu summary',
  '.comparison-period-tabs button', '.pill-toggle button', '.raise-chip',
  '.module-toggle-head', '#modalOnboardingSubmit', '#modalAddSubmit',
  '#editOfferSave', '[data-modal-confirm]', '.offer-reference-select',
  '.comparison-set-reference', '.offer-comparison-edit',
  '.offer-comparison-remove', '.nav-btn'
].join(',');

document.addEventListener('pointerup', event => {
  if(event.pointerType !== 'touch' || typeof navigator.vibrate !== 'function') return;
  const target = event.target instanceof Element
    ? event.target.closest(ONNET_HAPTIC_TARGETS)
    : null;
  if(!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return;
  try{
    navigator.vibrate(8);
  }catch(error){
    // Le navigateur ou les réglages système peuvent refuser la vibration.
  }
}, true);

