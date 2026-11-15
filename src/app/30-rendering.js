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
      <div class="result-source ${calculationError ? 'result-error' : ''}" id="c-result-state-${uid}" role="status" ${r ? 'hidden' : ''}>${esc(resultText)}</div>
      <div class="result-source" id="c-result-warnings-${uid}" ${r && r.warnings && r.warnings.length ? '' : 'hidden'}>${r && r.warnings && r.warnings.length ? `<details><summary>Avertissements du moteur (${r.warnings.length})</summary><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}</div>
    </div>

    <div class="scenario-edit-hint">
      Salaire brut et durée du travail modifiables dans « Votre situation », en haut de page.
      ${r ? `Taux effectif : <strong>${r.tauxEffectif.toFixed(1)} %</strong> du brut` : 'Taux effectif : —'}
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
    const pxCotis = Math.max(0, Math.round(cotis * scale)), pxMutuelle = Math.max(0, Math.round(mutuelle * scale));
    const pxTr = Math.max(0, Math.round(tr * scale)), pxNet = Math.max(0, Math.round(net * scale));
    const barHtml = `
      <div class="stack-bar-stage">
        <div class="stack-bar">
          <div class="stack-seg stack-seg-cotis" style="height:${pxCotis}px" title="Cotisations sociales : ${fmt(cotis)}" role="img" aria-label="Cotisations sociales : ${fmt(cotis)}"></div>
          <div class="stack-seg stack-seg-mutuelle" style="height:${pxMutuelle}px" title="Mutuelle : ${fmt(mutuelle)}" role="img" aria-label="Mutuelle : ${fmt(mutuelle)}"></div>
          <div class="stack-seg stack-seg-tr" style="height:${pxTr}px" title="Titres restaurant (part salariale) : ${fmt(tr)}" role="img" aria-label="Titres restaurant, part salariale : ${fmt(tr)}"></div>
          <div class="stack-seg stack-seg-net" style="height:${pxNet}px" title="Net : ${fmt(net)}" role="img" aria-label="Net : ${fmt(net)}"><span class="stack-net-tag">net</span></div>
        </div>
      </div>`;
    return `
    <div class="stack-col ${s.id === refId ? 'is-ref' : ''} ${s.id === justAddedId ? 'card-enter' : ''}" ${s.id !== refId ? `data-setref="${s.id}" role="button" tabindex="0" aria-label="Définir ${esc(s.name)} comme salaire de référence"` : 'aria-current="true"'}>
      <div class="stack-brut">brut ${fmt(brut)}</div>${barHtml}
      <div class="stack-ref-row"><span class="stack-ref-dot ${s.id === refId ? 'is-ref' : ''}" aria-hidden="true"></span><span class="stack-name" title="${esc(s.name)}">${esc(s.name)}</span></div>
      <div class="stack-net">${fmt(net)}</div>
      ${tr > 0.5 ? `<div class="stack-net-notr">TR salarié : ${fmt(tr)} · employeur : ${fmt(r.tr.totalEmployeur)}</div><div class="stack-net-notr">sans TR : ${fmt(netSansTR)}</div>` : ''}
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
    ? `Net avant impôt hors retenue des TR : <strong>${fmt(netSansTR)}</strong> · ${s.joursResto} jours × ${fmt(s.valeurResto)} · part salarié : <strong>${fmt(tr)}</strong> · part employeur : <strong>${fmt(r.tr.totalEmployeur)}</strong> · valeur créditée : <strong>${fmt(trValeurFaciale)}</strong>`
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
    netApresImpot:'net après impôt', netApresImpotHoraire:'net horaire après impôt', netHoraire:'net horaire',
    brutHoraire:'brut horaire'
  }[metric] || 'valeur sélectionnée';
  const format = isHourly ? fmtHoraire : fmt;
  if(Math.abs(delta) < (isHourly ? 0.01 : 1)){
    return `<div class="insight neutral">Ces salaires donnent à peu près le même ${metricLabel}.</div>`;
  }
  return `<div class="insight"><strong>${esc(best.s.name)}</strong> donne ${format(Math.abs(delta))} de ${delta > 0 ? 'plus' : 'moins'} en ${metricLabel} ${unit} que <strong>${esc(ref.s.name)}</strong>.</div>`;
}

const HOURLY_METRICS = new Set(['netHoraire', 'netApresImpotHoraire', 'brutHoraire']);

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
  const smicState = urssafSessionState.getOfficialSmicState();
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
  const smicStatus=smicState.status==='error'
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
          <p>${weeklyHours===39?`Brut mensuel de référence à 35 h : ${fmt(smicGross)}. Brut total estimé à 39 h : ${fmt(smicGrossTarget)}, avec 4 h supplémentaires hebdomadaires majorées à 25 %.`:`Brut mensuel de référence : ${fmt(smicGross)}.`} Taux horaire brut de base : ${fmtHoraire(smicHourlyGross)}. Règle consultée le ${smicState.checkedAt?new Date(smicState.checkedAt).toLocaleDateString('fr-FR'):'—'}.</p>
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
let mainSalaryInputPeriod='month';
function applyDeclaredSalaryFromForm(){
  const scenario=findScenario(refId)||scenarios[0];
  const gross=document.getElementById('mainSalaryGross');
  const period=document.getElementById('mainSalaryPeriod');
  const hours=document.getElementById('mainSalaryHours');
  const raw=Number(gross?.value);
  if(!scenario||!Number.isFinite(raw)||raw<=0||raw>1200000) return;
  scenario.brut=mainSalaryInputPeriod==='year'?Math.round(raw/12*100)/100:raw;
  scenario.dureeType=hours?.value==='39'?'39':'35';
  scenario.joursResto=Number(document.getElementById('mainMealDays')?.value)||0;
  scenario.valeurResto=Number(document.getElementById('mainMealValue')?.value)||0;
  scenario.partResto=Number(document.querySelector('#mainMealShare [aria-pressed="true"]')?.dataset.share)||50;
  // La saisie du formulaire matérialise l'accord annoncé à proximité des champs.
  urssafSessionState.grantConsent();
  saveState();
  render();
  scheduleUrssafCalculations(false,false);
}

function renderMaquetteControls(computedOverride){
  const benchmarkPanel=document.querySelector('#comparePanel .benchmark-panel');
  const benchmarkMount=document.getElementById('benchmarkMount');
  if(benchmarkPanel && benchmarkMount && benchmarkPanel.parentElement!==benchmarkMount) benchmarkMount.appendChild(benchmarkPanel);
  const tabs=document.getElementById('maquetteOfferTabs');
  if(!tabs) return;
  tabs.replaceChildren();
  scenarios.forEach((scenario,index)=>{
    const item=document.createElement('div');
    item.className='offer-tab-item';
    const button=document.createElement('button');
    button.type='button';button.className='offer-tab'+(scenario.id===refId?' active':'');
    button.setAttribute('aria-pressed',String(scenario.id===refId));
    const name=document.createElement('span');name.className='offer-tab-name';name.textContent=scenario.name;button.append(name);
    const small=document.createElement('small');small.textContent=index===0?'Actuelle':'Proposition';button.append(small);
    button.addEventListener('click',()=>{refId=scenario.id;render();});
    item.append(button);
    const actions=document.createElement('div');actions.className='offer-tab-actions';
    const rename=document.createElement('button');rename.type='button';rename.className='offer-tab-action';rename.textContent='Modifier';rename.setAttribute('aria-label','Renommer '+scenario.name);rename.title='Renommer ce poste';
    rename.addEventListener('click',event=>{
      event.stopPropagation();
      const input=document.createElement('input');input.type='text';input.className='offer-tab-rename-input';input.value=scenario.name;input.maxLength=60;input.setAttribute('aria-label','Nouveau nom du poste');
      name.replaceWith(input);rename.hidden=true;input.focus();input.select();
      let finished=false;
      const finish=save=>{
        if(finished) return;finished=true;
        const value=input.value.trim().slice(0,60);
        if(save && value) scenario.name=value;
        render();
      };
      input.addEventListener('keydown',keyEvent=>{
        if(keyEvent.key==='Enter'){keyEvent.preventDefault();finish(true);}
        if(keyEvent.key==='Escape'){keyEvent.preventDefault();finish(false);}
      });
      input.addEventListener('blur',()=>finish(true));
    });
    actions.append(rename);
    if(scenarios.length>1){
      const remove=document.createElement('button');remove.type='button';remove.className='offer-tab-action is-danger';remove.textContent='×';remove.setAttribute('aria-label','Supprimer '+scenario.name);remove.title='Supprimer ce poste';
      remove.addEventListener('click',event=>{event.stopPropagation();removeScenario(scenario.id);});
      actions.append(remove);
    }
    item.append(actions);tabs.append(item);
  });
  const selected=findScenario(refId)||scenarios[0];
  document.querySelectorAll('[data-maquette-period]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.maquettePeriod===maquetteComparisonPeriod)));
  const period=document.getElementById('mainSalaryPeriod');
  const gross=document.getElementById('mainSalaryGross');
  const hours=document.getElementById('mainSalaryHours');
  const mealDays=document.getElementById('mainMealDays');
  const mealValue=document.getElementById('mainMealValue');
  const mealShare=document.getElementById('mainMealShare');
  const mainFields=[period,gross,hours,mealDays,mealValue,mealShare].filter(Boolean);
  if(selected && period && gross && hours && !mainFields.includes(document.activeElement)){
    period.querySelectorAll('button[data-period]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.period===mainSalaryInputPeriod)));gross.value=String(Math.round(Number(selected.brut)*(mainSalaryInputPeriod==='year'?12:1)*100)/100);hours.value=selected.dureeType;
    if(mealDays) mealDays.value=String(selected.joursResto||0);
    if(mealValue) mealValue.value=String(selected.valeurResto||0);
    if(mealShare) mealShare.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.share)===(Number(selected.partResto)||50))));
  }
  const selectedId=(findScenario(refId)||scenarios[0])?.id;
  const computed=(computedOverride||getCurrentComputed()).find(x=>x.s.id===selectedId);
  const mutuelleText=document.getElementById('mainSalaryMutuelleText');
  if(mutuelleText && selected) mutuelleText.textContent=fmt(selected.mutuelle||0)+' / mois déduits de votre net (part salarié).';
  // Un seul raccordement durable : les rerendus ne doivent ni remplacer ni perdre
  // les événements de saisie du formulaire.
  if(gross){
    gross.oninput=null;
    gross.onchange=null;
    if(gross.dataset.onnetSalaryBound!=='true'){
      gross.addEventListener('input',applyDeclaredSalaryFromForm);
      gross.addEventListener('change',applyDeclaredSalaryFromForm);
      gross.dataset.onnetSalaryBound='true';
    }
  }
  if(period && period.dataset.onnetSalaryBound!=='true'){
    period.addEventListener('click',event=>{
      const button=event.target.closest('button[data-period]');
      if(!button) return;
      mainSalaryInputPeriod=button.dataset.period;
      period.querySelectorAll('button[data-period]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
      const selected=findScenario(refId)||scenarios[0];
      if(selected && gross) gross.value=String(Math.round(Number(selected.brut)*(mainSalaryInputPeriod==='year'?12:1)*100)/100);
      applyDeclaredSalaryFromForm();
    });
    period.dataset.onnetSalaryBound='true';
  }
  if(hours && hours.dataset.onnetSalaryBound!=='true'){
    hours.addEventListener('change',applyDeclaredSalaryFromForm);
    hours.dataset.onnetSalaryBound='true';
  }
  [mealDays,mealValue].forEach(field=>{
    if(field && field.dataset.onnetSalaryBound!=='true'){
      field.addEventListener('change',applyDeclaredSalaryFromForm);
      field.addEventListener('input',applyDeclaredSalaryFromForm);
      field.dataset.onnetSalaryBound='true';
    }
  });
  if(mealShare && mealShare.dataset.onnetSalaryBound!=='true'){
    mealShare.addEventListener('click',event=>{
      const button=event.target.closest('button[data-share]');
      if(!button) return;
      mealShare.querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
      applyDeclaredSalaryFromForm();
    });
    mealShare.dataset.onnetSalaryBound='true';
  }
  const summary=document.getElementById('maquetteYourSalary');
  if(summary){
    if(!computed || !computed.r){summary.innerHTML='<div class="benchmark-your-salary"><span><b>VOUS</b><span>Votre salaire</span></span><strong>À calculer<small>Net avant impôt</small></strong><div class="benchmark-meta benchmark-comparison-base">Le résultat apparaîtra après le calcul de votre salaire.</div></div>';}
    else{
      const weekly=Number(selected.dureeType), hoursMonth=weekly*52/12;
      const hourly=hoursMonth>0 && Number.isFinite(computed.r.netHoraire)?computed.r.netHoraire:0;
      const factor=maquetteComparisonPeriod==='hour'?1:maquetteComparisonPeriod==='year'?weekly*52:hoursMonth;
      const value=hourly*factor, unit=maquetteComparisonPeriod==='hour'?'heure':maquetteComparisonPeriod==='year'?'an':'mois';
      const amount=maquetteComparisonPeriod==='hour'?fmtHoraire(value):fmt(value);
      const mealEmployee=Number(computed.r.tr?.totalSalarie||0);
      const mealEmployer=Number(computed.r.tr?.totalEmployeur||0);
      const mealTotal=mealEmployee+mealEmployer;
      const periodScale=maquetteComparisonPeriod==='hour'?(hoursMonth>0?1/hoursMonth:0):maquetteComparisonPeriod==='year'?12:1;
      const periodFmt=n=>maquetteComparisonPeriod==='hour'?fmtHoraire(n):fmt(n);
      const netWithoutMeal=Number(computed.r.m?.netSocial||0)*periodScale;
      const netWithMeal=(Number(computed.r.m?.netApres||0)+mealTotal)*periodScale;
      const mealBenefit=mealTotal>0.5
        ? '<div class="salary-meal-benefit"><div><span>Net sans TR</span><strong>'+periodFmt(netWithoutMeal)+'</strong></div><div><span>TR</span><strong>'+periodFmt(mealTotal*periodScale)+'</strong></div><div><span>Net avec TR</span><strong>'+periodFmt(netWithMeal)+'</strong></div></div>'
        : '';
      summary.innerHTML='<div class="benchmark-your-salary"><span><b>VOUS</b><span>'+esc(selected.name)+'</span></span><strong>'+amount+' <small>Net avant impôt / '+unit+'</small></strong><div class="benchmark-meta benchmark-comparison-base">'+fmt(selected.brut)+' brut / mois · '+weekly+' h</div>'+mealBenefit+'</div>';
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

