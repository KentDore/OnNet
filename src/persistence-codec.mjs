import {
  sanitizeScenario,
  normalizeScenarioIds
} from './state-normalizers.mjs';

/**
 * Decodes a persisted snapshot without touching browser storage.
 * Invalid or obsolete payloads safely return null, matching the existing
 * localStorage adapter contract.
 */
export function deserializePersistedState(raw){
  try{
    if(!raw) return null;
    const data = JSON.parse(raw);
    if(!data || !Array.isArray(data.scenarios)) return null;
    const restored = normalizeScenarioIds(
      data.scenarios.map(sanitizeScenario).filter(Boolean),
      data.refId,
      data.openCardIds
    );
    if(!restored.scenarios.length) return null;

    const legacyPristine = data.onboardingCompleted !== true && restored.scenarios.length === 1 &&
      Number(restored.scenarios[0].brut) === 2300 && String(restored.scenarios[0].dureeType) === '39' &&
      Number(restored.scenarios[0].mutuelle) === 30 && Number(restored.scenarios[0].mutuellePat) === 30 &&
      Number(restored.scenarios[0].joursResto) === 21 && Number(restored.scenarios[0].valeurResto) === 8 &&
      Number(restored.scenarios[0].partResto) === 50;

    return {
      scenarios:restored.scenarios,
      refId:restored.refId,
      metric:data.metric,
      displayAmt:data.displayAmt,
      displayPeriod:data.displayPeriod,
      openCardIds:restored.openCardIds,
      onboardingCompleted:data.onboardingCompleted === true ||
        (data.onboardingCompleted !== false && !legacyPristine)
    };
  }catch{
    return null;
  }
}

/**
 * Encodes only application data. The localStorage adapter owns when and where
 * this string is written and can handle quota/privacy errors independently.
 */
export function serializePersistedState(state){
  return JSON.stringify({
    v:1,
    scenarios:state.scenarios,
    refId:state.refId,
    metric:state.metric,
    displayAmt:state.displayAmt,
    displayPeriod:state.displayPeriod,
    onboardingCompleted:state.onboardingCompleted,
    openCardIds:[...state.openCardIds]
  });
}
