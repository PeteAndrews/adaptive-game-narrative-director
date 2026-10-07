import {SCORES} from './interpretation.mjs';
export function initialBeat(config){
 return config?{active:config.initiallyActive===true,completed:false,stage:config.start,turnsAtStage:0,lastInputId:null,transition:'HOLD',reason:'Authored starting beat'}:null;
}
function matches(rule,p,speech){
 if(rule.events?.includes(p.audit.worldEvent))return true;
 if(rule.actions?.includes(p.audit.action?.id))return true;
 if(rule.outcomes?.includes(p.audit.action?.outcome))return true;
 if(speech.confidence<0.5)return false;
 return Object.entries(rule.anyScores??{}).some(([key,value])=>(speech.scores[key]??0)>=value);
}
function topical(config,p,speech){
 const recent=p.transcript.filter(e=>e.type==='input'||e.type==='utterance').slice(-4).map(e=>e.text).join(' ');
 return (config.topics??[]).some(t=>(speech.topic??'').toLowerCase().includes(t.toLowerCase()))||(config.patterns??[]).some(pattern=>new RegExp(pattern,'i').test(recent));
}
export function progressBeat(p,speech,policy,mode){
 const config=policy.beatProgression;if(!config)return {beatProgression:null,localObjective:null,localConstraints:[]};
 const state=structuredClone(p.beatProgression??initialBeat(config));
 const input=p.transcript.findLast(e=>e.type==='input'),fresh=Boolean(input&&input.id!==state.lastInputId);
 const engaged=topical(config,p,speech);
 const event=p.audit.worldEvent;
 const activate=(config.activationEvents??[]).includes(event);
 if(!state.active&&(activate||(!state.completed&&engaged))){state.active=true;if(state.completed){state.stage=config.start;state.turnsAtStage=0;}state.completed=false;state.reason='Authored scenario context became active';}
 state.transition='HOLD';
 let suspended=['REPAIR','PROBE'].includes(mode.responseMode)||p.reaction?.teachingPaused||speech.scores.intentional_topic_change>=0.6;
 if(state.active){
  const beat=config.beats.find(b=>b.id===state.stage);
  if(!beat)throw Error('Unknown current beat');
  if((config.deactivationEvents??[]).includes(event)){state.active=false;state.completed=true;state.reason='Authored scenario ended';}
  else if(!suspended&&matches(config.decision??{},p,speech)&&((fresh&&config.decision?.actions?.includes(p.audit.action?.id))||(engaged&&(beat.acceptDecision===true||event)&&!(beat.retreat&&matches(beat.retreat,p,speech))))) {
   state.stage=config.decision.stage;state.turnsAtStage=0;state.transition='DECISION';state.reason='Observed player decision or authored world outcome';
  }else if(fresh){
   state.lastInputId=input.id;
   if(suspended||!engaged){state.reason='Hold while clarification, conflict or another topic takes priority';}
   else if(beat.retreat&&matches(beat.retreat,p,speech)){state.stage=beat.retreat.to;state.turnsAtStage=0;state.transition='RETREAT';state.reason='Player resistance supports an authored retreat';}
   else if(beat.advance&&state.turnsAtStage>=(beat.minTurns??1)&&matches(beat.advance,p,speech)){state.stage=beat.advance.to;state.turnsAtStage=0;state.transition='ADVANCE';state.reason='Player evidence supports the next authored beat';}
   else{state.turnsAtStage++;state.reason='Stay at the current beat; no justified transition';}
  }
 }
 if(fresh)state.lastInputId=input.id;
 const beat=config.beats.find(b=>b.id===state.stage);
 const usable=state.active&&!suspended&&engaged;
 const actionResponse=usable?beat.actionResponses?.[p.audit.action?.id]:null;
 return {beatProgression:state,localObjective:usable?(actionResponse?.objective??beat.objective):null,localConstraints:usable?[...(beat.constraints??[]),...(actionResponse?.constraints??[])]:[]};
}
export function validateBeats(config){
 if(config===undefined)return;
 if(!config||!Array.isArray(config.beats)||!config.beats.length||typeof config.direction!=='string')throw Error('Beat progression needs a dramatic direction and authored beats');
 if(config.initiallyActive!==undefined&&typeof config.initiallyActive!=='boolean')throw Error('Invalid initial beat activation');
 const ids=new Set(config.beats.map(b=>b.id));
 if(ids.size!==config.beats.length||!ids.has(config.start))throw Error('Invalid beat IDs or starting beat');
 for(const list of [config.activationEvents,config.deactivationEvents,config.topics,config.patterns])if(list!==undefined&&(!Array.isArray(list)||list.some(v=>typeof v!=='string')))throw Error('Invalid beat activation/context');
 for(const pattern of config.patterns??[])new RegExp(pattern,'i');
 const rules=[config.decision];
 if(config.decision&&!ids.has(config.decision.stage))throw Error('Invalid decision beat');
 for(const b of config.beats){
  for(const response of Object.values(b.actionResponses??{}))if(!response||typeof response.objective!=='string'||!response.objective.trim()||(response.constraints!==undefined&&(!Array.isArray(response.constraints)||response.constraints.some(v=>typeof v!=='string'))))throw Error('Invalid beat action response');
  if(typeof b.id!=='string'||!b.id||typeof b.objective!=='string'||!b.objective.trim()||(b.minTurns!==undefined&&(!Number.isInteger(b.minTurns)||b.minTurns<0))||(b.constraints!==undefined&&(!Array.isArray(b.constraints)||b.constraints.some(v=>typeof v!=='string'))))throw Error('Invalid authored beat');
  for(const r of [b.advance,b.retreat])if(r){if(!ids.has(r.to)||r.to===b.id)throw Error('Invalid beat transition target');rules.push(r);}
 }
 for(const r of rules.filter(Boolean)){
  if(r.anyScores&&Object.entries(r.anyScores).some(([key,value])=>!SCORES.includes(key)||!Number.isFinite(value)||value<0||value>1))throw Error('Invalid beat evidence threshold');
  for(const key of ['events','actions','outcomes'])if(r[key]!==undefined&&(!Array.isArray(r[key])||r[key].some(v=>typeof v!=='string')))throw Error('Invalid beat decision rule');
 }
}
