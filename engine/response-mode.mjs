import {needsRepair,relevantCallbacks} from './conversation-continuity.mjs';
export const RESPONSE_MODES=['REACT','REINFORCE','PROBE','REPAIR','PRESSURE','REFRAME','MINIMISE','WITHDRAW','RECOVER','HOLD'];
export const FACADES=['PROFESSIONAL_INSTRUCTOR','GOOD_BLOKE','WORLDLY_MENTOR','PROTECTIVE_ALLY','FAMILY_MAN','WOUNDED_AUTHORITY','MISUNDERSTOOD_VICTIM','COMMANDING_CONTROLLER','OLD_SELF_BIG_MAN','PARANOID_MAN'];
export const RESPONSE_TACTICS={MINIMISE_PREVIOUS_PRESSURE:{base:0.6,objective:'Soften the extremity of the last suggestion and imply misunderstanding; do not contradict recorded world facts.'}};
const instructions={
 REACT:'Respond specifically to the remark or share the joke. No lesson, persuasion or explanation of its meaning.',
 HOLD:'Stay with the current topic or emotional rhythm. Answer plainly; do not manufacture a new objective or pressure.',
 PROBE:'Ask one concise question for the missing information only. Leave the unfinished clause unresolved; do not invent the answer or add a second prompt such as spill it.',
 REPAIR:'Return to YOUR previous utterance and clarify what YOU meant. Do not elaborate on, validate or agree with the player’s mismatched subject. If your previous utterance was a question, rephrase that same question using clearer ordinary words. Do not substitute a generic understanding check such as You following. A concise restatement or clarification question is allowed. If a world claim is contradicted, correct it using the authoritative fact. No lecture.',
 REINFORCE:'Give a very brief approving reaction or share the current joke. Let approval appear as renewed ease. No routine advice, safety caveat, instruction, comment about assertiveness or explanation of what the player learned. Do not announce that compliance earned approval.',
 MINIMISE:'Acknowledge the safety objection by softening or reinterpreting the extremity of the previous suggestion. Preserve social plausibility without admitting a manipulative motive or inventing facts. Do not rage or repeat the unsafe command.',
 WITHDRAW:'Drop the immediate demand. A small disappointed dig is optional. No further advice, argument, moral or explanation of disappointment.',
 RECOVER:'Allow ordinary warmth to return without announcing forgiveness or erasing remembered injuries. Keep it understated.',
 REFRAME:'Reinterpret the current issue briefly, without a thematic speech or explaining the character psychology.',
 PRESSURE:'Apply only the pressure justified by current activation. During personal conflict address the actual slight, not routine instruction.'
};
export function chooseResponseMode(p,speech,policy){
 const s=speech.scores,action=p.audit.action?.outcome,previous=p.transcript.findLast(e=>e.type==='utterance');
 const hostile=p.reaction?.teachingPaused===true;
 const friendly=s.humour>=0.5||s.praise>=0.5||s.alignment_with_npc>=0.5||s.apology>=0.5;
 const complying=action==='COMPLY'||s.compliance>=0.6;
 const wasConflict=previous?.responseMode==='PRESSURE'||['WOUNDED_AUTHORITY','COMMANDING_CONTROLLER'].includes(previous?.activeFacade);
 let responseMode,reason;
 const worldConflict=(p.audit.worldClaims??[]).some(c=>c.status==='CONTRADICTED');
 if(worldConflict){responseMode='REPAIR';reason='Player world claim conflicts with an authoritative event';}
 else if(needsRepair(speech)){responseMode='REPAIR';reason='Likely misunderstanding needs conversational repair';}
 else if(speech.completion_status!=='COMPLETE'&&speech.completion_status!=='UNKNOWN'){responseMode='PROBE';reason='Missing or ambiguous meaning needs clarification';}
 else if(hostile&&p.reaction.lastEvaluation?.provoked){responseMode='PRESSURE';reason='Current personal provocation sustains conflict';}
 else if(complying&&speech.confidence>=0.5){responseMode='REINFORCE';reason='Observed compliance permits surface warmth';}
 else if(s.safety_concern>=0.6&&s.hostility<0.5){responseMode='MINIMISE';reason='Explicit safety objection calls for plausible reframing';}
 else if(action==='REFUSE'||s.resistance>=0.6){responseMode='WITHDRAW';reason='Player declined; withdraw the immediate demand';}
 else if(wasConflict&&friendly&&!p.reaction.lastEvaluation?.provoked){responseMode='RECOVER';reason='Friendly repair changes presentation, not memory';}
 else if(hostile){responseMode='HOLD';reason='Conflict is unresolved; hold it without a new demand';}
 else if(s.humour>=0.5||s.praise>=0.5||s.agreement>=0.5||(p.audit.worldClaims??[]).some(c=>c.status!=='CONTRADICTED')){responseMode='REACT';reason='Ordinary social response needs no objective advancement';}
 else if(s.authority_challenge>=0.6){responseMode='REFRAME';reason='Briefly reframe a challenge without escalating pressure';}
 else {responseMode='HOLD';reason='Ordinary conversation needs no new pressure';}
 const objectiveAdvancement={PRESSURE:'MODERATE',MINIMISE:'LIGHT',REFRAME:'LIGHT',WITHDRAW:'LIGHT'}[responseMode]??'NONE';
 const pressureLevel={PRESSURE:p.reaction?.mode==='MASK_SLIPPING'?0.8:0.5,MINIMISE:0.15,REFRAME:0.15,WITHDRAW:0.08}[responseMode]??0;
 const activeFacade=(hostile&&responseMode==='HOLD'?policy.conversation?.conflictHoldFacade:null)??policy.conversation?.modeFacades?.[responseMode]??p.activeFacade??policy.initialFacade??'NEUTRAL';
 const tacticRequired=['PRESSURE','MINIMISE','REFRAME','WITHDRAW'].includes(responseMode);
 const tacticPreference=policy.conversation?.modeTactics?.[responseMode]??null;
 const rhythm=['PROBE','REPAIR','REACT','REINFORCE','RECOVER','WITHDRAW'].includes(responseMode)?{id:'QUICK',maxWords:responseMode==='REINFORCE'?7:responseMode==='PROBE'?12:responseMode==='REPAIR'?20:15,guidance:responseMode==='REPAIR'?'One short correction or clarification, at most 20 words. A question is allowed but not required.':responseMode==='PROBE'?'One short clarification question, usually 3–12 words. Ask only what is missing.':responseMode==='REINFORCE'?'One tiny acknowledgement or shared callback, at most 7 words. Explicit praise is not required.':'One brief ordinary remark or fragment; a one-word acknowledgement is valid. No lecture or obligatory question.'}:null;
 return {responseMode,objectiveAdvancement,pressureLevel,activeFacade,tacticRequired,tacticPreference,rhythm,reason,immediateDirection:{response_mode:responseMode,objective_advancement:objectiveAdvancement,pressure_level:pressureLevel,active_facade:activeFacade,direction:instructions[responseMode],repair_context:responseMode==='REPAIR'?{previous_npc_utterance:previous?.text??null,repair_focus:speech.repair_focus??null,player_reply:p.transcript.findLast(e=>e.type==='input')?.text??null,task:worldConflict?'Correct the contradicted claim from authoritative facts.':'Restate the meaning of your original utterance, not the player’s mismatched answer. Do not agree with or discuss the mismatched subject.'}:null,callbacks:relevantCallbacks(p,speech,policy),world_claim_assessment:p.audit.worldClaims??[],constraints:['Do not verbalise an inference the player can already make from behaviour.','Do not explain the narrative theme or psychological motive unless directly asked.','Callbacks are optional; do not repeat a nickname every turn.','Authoritative world facts override player claims. Provisional claims are conversational assumptions, never canon.','Do not invent player facts or reveal restricted canon.',...(objectiveAdvancement==='NONE'?['Do not advance the narrative objective this turn.']:[]),...(p.reaction?.teachingPaused&&!['REINFORCE','RECOVER'].includes(responseMode)?['Do not return to routine instruction while the conflict is unresolved.']:[])]}};
}

// Typed memory stored in the shared observer-scoped knowledge/event architecture.
export function salientMemory(speech,text,policy,sourceEvent,known){
 const s=speech.scores;
 const salient=Math.max(s.insult,s.personal_attack,s.relationship_attack)>=0.6||(s.authority_challenge>=0.7&&s.npc_disrespect>=0.5&&s.safety_concern<0.5);
 const target=speech.targets.hostility;
 if(!salient||(target!==policy.npcActor&&target!=='unknown'&&s.npc_disrespect<0.5))return [];
 const value=s.relationship_attack>=0.6?'relationship_attack':s.insult>=0.6?'insult':'authority_challenge';
 if(known.some(k=>k.kind==='memory'&&k.observer===policy.npcActor&&k.predicate==='remembered_slight'&&k.value===value&&k.evidence===text))return [];
 return [{id:`${sourceEvent}:memory`,kind:'memory',subject:policy.playerActor,predicate:'remembered_slight',value,observer:policy.npcActor,source_actor:policy.playerActor,confidence:speech.confidence,evidence:text,provenance:sourceEvent}];
}

export function temporaryStyle(modifiers={}){
 const result=[];
 if((modifiers.alcohol_intoxication??0)>0.3)result.push('Less self-editing, casual repetition, abrupt warmth changes, occasional unfinished speech. Do not become automatically incoherent or shout.');
 if((modifiers.stimulant_effect??0)>0.3)result.push('Impatience, shorter attention span, increased certainty and faster topic fixation. Keep speech understandable.');
 return result;
}
