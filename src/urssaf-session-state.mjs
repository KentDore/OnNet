const SMIC_STATUSES = new Set(['idle','loading','ready','error']);

function createInitialSmicState(){
  return {
    status:'idle',
    amount:null,
    checkedAt:null,
    missingVariables:[],
    warnings:[],
    error:null
  };
}

function copySmicState(state){
  return {
    status:state.status,
    amount:state.amount ?? null,
    checkedAt:state.checkedAt ?? null,
    missingVariables:Array.isArray(state.missingVariables) ? [...state.missingVariables] : [],
    warnings:Array.isArray(state.warnings) ? [...state.warnings] : [],
    error:state.error ?? null
  };
}

/**
 * Owns the small part of Urssaf state intentionally shared by app fragments.
 * The app persists explicit consent separately; this module only exposes the
 * current runtime decision. SMIC snapshots prevent mutation through references.
 */
export function createUrssafSessionState(){
  let consentGranted = false;
  let officialSmicState = createInitialSmicState();

  return Object.freeze({
    isConsentGranted(){
      return consentGranted;
    },
    grantConsent(){
      consentGranted = true;
    },
    revokeConsent(){
      consentGranted = false;
    },
    getOfficialSmicState(){
      return copySmicState(officialSmicState);
    },
    setOfficialSmicState(nextState){
      if(!nextState || typeof nextState !== 'object' || Array.isArray(nextState)){
        throw new TypeError('L’état du SMIC doit être un objet.');
      }
      if(!SMIC_STATUSES.has(nextState.status)){
        throw new RangeError('Statut du SMIC invalide.');
      }
      officialSmicState = copySmicState(nextState);
      return copySmicState(officialSmicState);
    }
  });
}
