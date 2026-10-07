// Convert internal decisions into a small spoken-performance contract.
// Psychology, tactic scoring and relationship memory remain in the simulation.
import {selectLengthPolicy,validateLengthOverride} from './length-policy.mjs';
export const EXPLANATION_NEEDS=['NONE','LOW','MODERATE','HIGH'];
export const JUSTIFICATION_STYLES={
 MINIMISE:'Play down the objection briefly; no polished reconciliation.',
 DENY:'Refuse the accusation without constructing a comprehensive defence.',
 EXTERNALISE_BLAME:'Attribute the immediate problem to circumstances or someone else, using only established facts.',
 SELF_EXCEPTION:'Treat this instance as an exception without resolving the inconsistency.',
 MISUNDERSTANDING_DEFENCE:'Claim the previous remark was taken differently than intended; do not change world facts.',
 BENEFICIAL_INTENT:'Offer a small claim of helpful intent, not a speech about motives.',
 RECIPROCITY:'Refer briefly to an established exchange or favour, without inventing an obligation.',
 RETALIATION:'Respond to the immediate slight; do not invent a past grievance.',
 DEFLECTION:'Sidestep the objection without inventing an answer or resolving the contradiction.'
};
export function conversationPolicy(p,speech,policy,decision,tacticRule={}){
 const config=policy.conversation??{},s=speech.scores;
 const clear=speech.confidence>=0.5;
 const repair=['REPAIR','PROBE'].includes(decision.responseMode);
 const why=clear&&(s.explanation_request??0)>=0.6;
 const contradiction=clear&&(s.contradiction_challenge??0)>=0.6;
 const information=clear&&(s.information_request??0)>=0.6;
 const authored=EXPLANATION_NEEDS.includes(tacticRule.explanationNeed)?tacticRule.explanationNeed:null;
 let explanation_need='NONE',explanation_reason=null;
 if(!repair){
  if(authored&&authored!=='NONE'){explanation_need=authored;explanation_reason='Authored communication requirement';}
  else if(tacticRule.justify===true){explanation_need='LOW';explanation_reason='Authored intention to justify the immediate response';}
  else if(why){explanation_need='MODERATE';explanation_reason='Explicit request for a reason';}
  else if(information){explanation_need='LOW';explanation_reason='Requested information needs an answer';}
  else if(contradiction){explanation_need='LOW';explanation_reason='An inconsistency was challenged; reconciliation is not required';}
 }
 let justification_style=null;
 if(!repair&&(why||contradiction||tacticRule.justify===true)){
  justification_style=Object.entries(config.justificationWeights??{}).filter(([id,w])=>JUSTIFICATION_STYLES[id]&&w>0).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]??null;
 }
 const work=repair?(decision.responseMode==='REPAIR'?'repair':'clarify'):why?'answer':contradiction?(justification_style?'justify':'disagree'):information?'answer':({REACT:s.humour>=0.5?'joke':'react',REINFORCE:'reinforce',WITHDRAW:'withdraw',PRESSURE:'pressure',REFRAME:'redirect',MINIMISE:'disagree',RECOVER:'acknowledge',HOLD:'acknowledge'}[decision.responseMode]??'react');
 const behavioural_constraints=(config.stateStyles??[]).filter(r=>(p.state[r.state]??0)>=r.above).map(r=>r.behaviour);
 const tactic_behaviour=decision.tactic?(tacticRule.behaviour??config.tacticBehaviours?.[decision.tactic]??'Use the selected response mode through observable behaviour. Do not paraphrase a tactic name or internal objective.'):null;
 const reason=explanation_reason;
 const question_reason=repair?(decision.responseMode==='PROBE'?'Clarify missing information':'Repair a misunderstanding or contradiction'):tacticRule.questionReason??null;
 const base=decision.rhythm?.maxWords??20;
 const maxWords=explanation_need==='HIGH'?90:explanation_need==='MODERATE'?55:explanation_need==='LOW'?Math.max(base,25):base;
 const lengthPolicy=selectLengthPolicy({...decision,conversational_work:work,explanation_need,explanation_reason:reason},config,tacticRule);
 return {lengthPolicy,conversational_work:work,explanation_need,explanation_reason:reason,justification_style,question_policy:{allowed:Boolean(question_reason),reason:question_reason},
  expression:{work,explanation_need,explanation_reason:reason,tactic_behaviour,justification_behaviour:justification_style?JUSTIFICATION_STYLES[justification_style]:null,behavioural_constraints,
   restraint:'Perform only this conversational work. Internal motives are not spoken rationale. Preserve uncertainty and contradictions; do not invent coherence or extra meaning. Ordinary, mundane or fragmentary speech is valid.'},
  rhythm:{id:explanation_need==='NONE'?(decision.rhythm?.id??'CONCISE'):'EXPLANATION',maxWords,guidance:reason?`Use only the explanation needed: ${reason}. The word limit is a ceiling, not a target.`:'Prefer the shortest response that makes sense, preserves voice and maintains continuity. Longer speech needs an explicit communication reason.'}};
}

export function validateConversation(config={},tactics={}){
 if(!config||typeof config!=='object'||Array.isArray(config))throw Error('Invalid conversation configuration');
 if(config.lengthDefaults){
  if(typeof config.lengthDefaults!=='object'||Array.isArray(config.lengthDefaults))throw Error('Invalid length defaults');
  for(const value of Object.values(config.lengthDefaults)){validateLengthOverride(value);if(value==='AUTO')throw Error('Length default must be a concrete policy');}
 }
 for(const r of Object.values(tactics)){
  if(r.lengthPolicy!==undefined){validateLengthOverride(r.lengthPolicy);if(r.lengthPolicy==='AUTO')throw Error('Tactic length must be a concrete policy');}
  if(r.lengthReason!==undefined&&(typeof r.lengthReason!=='string'||!r.lengthReason.trim()))throw Error('Invalid length reason');
 }
 if(config.justificationWeights&&Object.entries(config.justificationWeights).some(([k,w])=>!JUSTIFICATION_STYLES[k]||!Number.isFinite(w)||w<0))throw Error('Invalid justification weights');
 if(config.stateStyles&&(!Array.isArray(config.stateStyles)||config.stateStyles.some(r=>!r||typeof r.state!=='string'||!Number.isFinite(r.above)||r.above<0||r.above>1||typeof r.behaviour!=='string')))throw Error('Invalid state style');
 if(config.tacticBehaviours&&Object.values(config.tacticBehaviours).some(v=>typeof v!=='string'))throw Error('Invalid tactic behaviour');
 for(const key of ['modeFacades','facadeBehaviours'])if(config[key]&&Object.values(config[key]).some(v=>typeof v!=='string'))throw Error('Invalid facade configuration');
 if(config.modeTactics&&Object.values(config.modeTactics).some(t=>typeof t!=='string'||(!tactics[t]&&t!=='MINIMISE_PREVIOUS_PRESSURE')))throw Error('Invalid mode tactic');
 if(config.callbackWindowTurns!==undefined&&(!Number.isInteger(config.callbackWindowTurns)||config.callbackWindowTurns<1))throw Error('Invalid callback window');
 if(config.disclosureDelayTurns!==undefined&&(!Number.isInteger(config.disclosureDelayTurns)||config.disclosureDelayTurns<0))throw Error('Invalid disclosure delay');
 for(const r of Object.values(tactics))if((r.explanationNeed!==undefined&&!EXPLANATION_NEEDS.includes(r.explanationNeed))||(r.behaviour!==undefined&&typeof r.behaviour!=='string')||(r.justify!==undefined&&typeof r.justify!=='boolean')||(r.questionReason!==undefined&&(typeof r.questionReason!=='string'||!r.questionReason.trim())))throw Error('Invalid tactic expression configuration');
}
