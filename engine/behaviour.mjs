import {chooseResponseMode,RESPONSE_TACTICS} from './response-mode.mjs';
import {responseRhythm} from './reaction.mjs';
import {conversationPolicy} from './conversation-policy.mjs';
import {usableKnowledge} from './disclosure-policy.mjs';
import {progressBeat} from './beat-progression.mjs';
export const clamp=x=>Math.max(0,Math.min(1,x));
export const stateKey=k=>({charm:'charm_mask',control:'control_need'}[k]??k);
export function canonicalState(state){const result={};for(const [k,v] of Object.entries(state))if(!(k==='charm'&&'charm_mask'in state)&&!(k==='control'&&'control_need'in state))result[stateKey(k)]=v;return result;}
export function actionInterpretation(choice,policy){return {id:choice?.id??null,label:choice?.label??null,outcome:choice?(choice.outcome??policy.actions?.[choice.id]??({compliant:'COMPLY',resistant:'REFUSE'}[choice.stance])??'NO_RELEVANT_ACTION'):'NO_RELEVANT_ACTION',source:'authored action'};}
export function evaluate(speech,action){
  const scores=speech.scores,verbal=speech.confidence<0.5?'UNKNOWN':scores.resistance>=0.6?'REFUSE':scores.compliance>=0.6?'COMPLY':'UNKNOWN';
  return {verbal,physical:action.outcome,contradiction:(verbal==='REFUSE'&&action.outcome==='COMPLY')||(verbal==='COMPLY'&&action.outcome==='REFUSE'),social:speech.confidence<0.5?'unknown':scores.praise>=0.6?'praises':scores.authority_challenge>=0.6?'challenges':scores.disagreement>=0.6?'disagrees':scores.agreement>=0.6?'agrees':speech.stance==='AFFILIATIVE'?'warmer':scores.hostility>=0.6?'colder':'unknown'};
}
export function stateChanges(state,speech,action,policy,phase){
  const next={...state},s=Object.fromEntries(Object.entries(speech.scores).map(([k,v])=>[k,v*speech.confidence]));
  for(const [k,factor] of Object.entries(policy.decay??{}))next[k]=(next[k]??0)*factor;
  for(const [signal,weights] of Object.entries(policy.effects??{}))for(const [k,w] of Object.entries(weights)){if(k==='perceived_disrespect'&&signal!=='npc_disrespect')continue;next[k]=(next[k]??0)+(s[signal]??0)*w;}
  for(const [k,w] of Object.entries(policy.actionEffects?.[action.outcome]??{}))next[k]=(next[k]??0)+w;
  const limits=policy.phases[phase].limits??{};
  for(const k of Object.keys(next)){next[k]=clamp(next[k]);if(limits[k])next[k]=Math.max(limits[k][0],Math.min(limits[k][1],next[k]));}
  return Object.fromEntries(Object.keys(next).map(k=>[k,{previous:state[k]??0,delta:next[k]-(state[k]??0),value:next[k]}]));
}
export function playerModelUpdate(model,speech,action,evaluation,previous,policy){
  const next=structuredClone(model), observations={};const s=speech.scores;
  if(speech.confidence>=0.5){observations.resistance=s.resistance;observations.assertiveness=Math.max(s.boundary_setting,s.authority_challenge);if(s.compliance>0.3||s.resistance>0.3)observations.verbal_compliance=s.compliance;if(s.evasion>0.5)observations.confrontation_avoidance=s.evasion;else if(s.boundary_setting>0.5||s.authority_challenge>0.5)observations.confrontation_avoidance=0;}
  if(action.outcome!=='NO_RELEVANT_ACTION')observations.physical_compliance=action.outcome==='COMPLY'?1:action.outcome==='PARTIAL'?0.5:0;
  next.tendencies??={};next.signals??={};next.tactics??={};next.responses??={};
  for(const [k,v] of Object.entries(observations)){const old=next.tendencies[k]??{count:0,mean:0};next.tendencies[k]={count:old.count+1,mean:(old.mean*old.count+v)/(old.count+1)};}
  for(const signal of speech.social_signals)next.signals[signal]=(next.signals[signal]??0)+1;
  let evidence=null;
  if(previous?.tactic){
    const tactic=previous.tactic.toUpperCase(), social=['praises','agrees','warmer'].includes(evaluation.social)?'positive':['challenges','disagrees','colder'].includes(evaluation.social)?'negative':'unknown';
    const physical=action.outcome==='COMPLY'?'positive':action.outcome==='REFUSE'?'negative':action.outcome==='PARTIAL'?'partial':'unknown';
    evidence={utteranceId:previous.id,tactic,social,physical};
    for(const [bucket,key] of [[next.tactics,tactic],[next.responses,policy.responseGroups?.[tactic]]])if(key){bucket[key]??={social:{positive:0,negative:0,unknown:0},physical:{positive:0,negative:0,partial:0,unknown:0}};bucket[key].social[social]++;bucket[key].physical[physical]++;}
  }
  return {next,observations,evidence};
}
export function selectDirection(p,speech,policy){
  let mode=chooseResponseMode(p,speech,policy),disclosureDeferred=false;
  const phase=p.phase,phaseConfig=policy.phases[phase],level=policy.reaction?.levels.find(l=>l.id===p.reaction?.mode),rules={...RESPONSE_TACTICS,...policy.tactics,...policy.reaction?.tactics};
  const pool=mode.tacticPreference?[mode.tacticPreference]:(level?.tactics??phaseConfig.tactics);
  const eligible=(mode.tacticRequired?pool:[]).filter(t=>{const rule=rules[t];if(!rule)return false;for(const [k,v] of Object.entries(rule.min??{}))if((p.state[k]??0)<v)return false;for(const [k,v] of Object.entries(rule.max??{}))if((p.state[k]??0)>v)return false;if(rule.requiresPredicate){const matching=p.knowledge.filter(k=>k.observer===policy.npcActor&&k.predicate===rule.requiresPredicate);if(!matching.some(k=>usableKnowledge(k,p,policy,speech))){disclosureDeferred||=matching.length>0;return false;}}return true;});
  const scores=eligible.map(t=>{const rule=rules[t];let score=rule.base??0;
    for(const [k,w] of Object.entries(rule.speech??{}))score+=(speech.scores[k]??0)*speech.confidence*w;
    for(const [k,w] of Object.entries(rule.state??{}))score+=(p.state[k]??0)*w;
    for(const [k,w] of Object.entries(rule.player??{}))score+=(p.playerModel.tendencies?.[k]?.mean??0)*w;
    const evidence=p.playerModel.tactics?.[t]?.social;if(evidence)score+=0.2*(evidence.positive-evidence.negative)/(evidence.positive+evidence.negative+2);
    const last=p.transcript.filter(e=>e.type==='utterance').slice(-2);score-=last.filter(e=>e.tactic?.toUpperCase()===t).length*0.18;
    return {tactic:t,score};}).sort((a,b)=>b.score-a.score||a.tactic.localeCompare(b.tactic));
  if(mode.tacticRequired&&!scores.length){
    if(!disclosureDeferred)throw Error('No eligible response tactic configured');
    mode={...mode,responseMode:'HOLD',objectiveAdvancement:'NONE',pressureLevel:0,tacticRequired:false,tacticPreference:null,rhythm:{id:'QUICK',maxWords:20},reason:'Personal disclosure is unavailable for this turn; hold without personal leverage',immediateDirection:{...mode.immediateDirection,response_mode:'HOLD',objective_advancement:'NONE',pressure_level:0,direction:'Respond plainly to the immediate interaction. Do not exploit or repeat a deferred or irrelevant personal disclosure.'}};
  }
  const tactic=scores[0]?.tactic??null;
  const conversation=conversationPolicy(p,speech,policy,{...mode,tactic,rhythm:mode.rhythm??responseRhythm(p,speech,policy)},rules[tactic]??{});
  const beat=progressBeat(p,speech,policy,mode);
  return {...mode,...conversation,...beat,phase,tactic,objective:beat.localObjective??(tactic?rules[tactic].objective:'Respond naturally without advancing the scene objective.'),immediateDirection:{...mode.immediateDirection,tactic,player_interpretation:speech,expression:conversation.expression},reaction:p.reaction,eligible,scores,reason:mode.reason+(tactic?`; selected ${tactic} after response mode and facade`:'; no tactic needed'),context:{scenario:p.scenario,node:p.node,state:p.state,signals:speech.social_signals,knowledgeIds:p.knowledge.filter(k=>k.observer===policy.npcActor).map(k=>k.id??k.provenance)},presentation:level?.presentation??phaseConfig.presentation};
}
