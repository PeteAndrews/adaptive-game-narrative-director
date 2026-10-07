import { randomUUID } from 'node:crypto';
import {canonicalState,stateKey,selectDirection} from './behaviour.mjs';
import {initialReaction} from './reaction.mjs';
import {applyWorldFacts,assessWorldClaims} from './conversation-continuity.mjs';
import {neutral} from './interpretation.mjs';
import {validateLengthOverride} from './length-policy.mjs';
import {validateConversation} from './conversation-policy.mjs';
import {initialBeat,validateBeats} from './beat-progression.mjs';
const clone = x => structuredClone(x);
function validateKnowledge(items) {
  if(!Array.isArray(items)) throw Error('Knowledge must be an array');
  for(const k of items) if(!k || !['claim','belief','suspicion','relationship','fact','contradiction','memory'].includes(k.kind) || !['subject','predicate','value','observer'].every(key=>typeof k[key]==='string') || !Number.isFinite(k.confidence) || k.confidence<0 || k.confidence>1) throw Error('Knowledge needs kind, subject, predicate, value, observer and confidence (0–1)');
}
function validateEffects(e) {
  if(e && (typeof e!=='object'||Array.isArray(e)||Object.values(e).some(v=>!Number.isFinite(v)))) throw Error('State effects must be finite numeric values');
}
export function validatePack(p,{allowEmpty=false}={}) {
  if (!p || typeof p.id !== 'string' || (!p.nodes?.[p.start]&&!(allowEmpty&&p.nodes&&Object.keys(p.nodes).length===0&&p.start==='')) || !p.initialState || !Array.isArray(p.knowledge)) throw Error('Pack needs id, start node, initialState and knowledge.');
  if(!Array.isArray(p.canon)||!Array.isArray(p.speechRules)||!p.worldEvents) throw Error('Pack needs canon, speechRules and worldEvents');
  validateKnowledge(p.knowledge);validateEffects(p.initialState);
  for(const facts of [p.worldState??[],...Object.values(p.worldFacts??{})])if(!Array.isArray(facts)||facts.some(f=>!f||!['subject','predicate','value'].every(k=>typeof f[k]==='string'&&f[k].length>0)))throw Error('World facts need subject, predicate and value');
  for(const modifiers of [p.temporary_modifiers??{},...Object.values(p.worldModifiers??{})]){validateEffects(modifiers);if(Object.values(modifiers).some(v=>v<0||v>1))throw Error('Temporary modifiers must be authored values from 0 to 1');}
  for (const [id,n] of Object.entries(p.nodes)) {
    if(n.characterPrompt!==undefined&&typeof n.characterPrompt!=='string')throw Error('Invalid session direction');
    if(n.initialPhase!==undefined&&(!p.behaviour?.phases||!Object.hasOwn(p.behaviour.phases,n.initialPhase)))throw Error('Invalid session starting phase');
    if (typeof n.text !== 'string' || typeof n.title!=='string' || typeof n.tactic!=='string' || !Array.isArray(n.choices)) throw Error(`Invalid node ${id}`);
    if(n.fallback&&!p.nodes[n.fallback]) throw Error(`Invalid fallback in ${id}`);
    validateKnowledge(n.knowledge??[]);
    const ids=new Set();
    for (const c of n.choices) {if (!p.nodes[c.target] || !c.label || !c.id || ids.has(c.id)) throw Error(`Invalid or duplicate choice in ${id}`);ids.add(c.id);validateEffects(c.effects);}
  }
  for(const r of p.speechRules){new RegExp(r.pattern,'i');if(!p.nodes[r.target])throw Error('Invalid speech-rule target');validateEffects(r.effects);}
  for(const r of p.disclosures??[]){new RegExp(r.pattern,'i');validateKnowledge([r.knowledge]);}
  for (const target of Object.values(p.worldEvents ?? {})) if (!p.nodes[target]) throw Error('Invalid world event target');
  if(p.behaviour){
    const b=p.behaviour;
    for(const rule of b.actionSpeechRules??[]){if(typeof rule.actionId!=='string'||typeof rule.pattern!=='string')throw Error('Invalid authored action speech rule');new RegExp(rule.pattern,'i');}
    validateBeats(b.beatProgression);
    validateConversation(b.conversation??{},{...b.tactics,...b.reaction?.tactics});
    if(!b.phases?.[b.initialPhase]||!b.tactics||!b.npcActor||!b.playerActor)throw Error('Behaviour needs actors, tactics and a valid initial phase');
    for(const phase of Object.values(b.phases))if(!Array.isArray(phase.tactics)||!phase.tactics.length||phase.tactics.some(t=>!b.tactics[t]||typeof b.tactics[t].objective!=='string'))throw Error('Each phase needs valid eligible tactics');
    validateEffects(b.defaults);validateEffects(b.decay);
    for(const weights of Object.values(b.effects??{}))validateEffects(weights);
    if(b.reaction){
      const r=b.reaction,rules={...b.tactics,...r.tactics};
      if(!Array.isArray(r.levels)||!r.levels.length||!r.weights||!r.decay||!Number.isInteger(r.pauseAtLevel)||r.pauseAtLevel<0||r.pauseAtLevel>=r.levels.length)throw Error('Reaction needs levels, weights, decay and a valid teaching pause level');
      validateEffects(r.weights);validateEffects(r.decay);validateEffects(r.stateEffects);
      const ids=new Set();let previous=-1;
      for(const l of r.levels){if(!l.id||ids.has(l.id)||!Number.isFinite(l.enter)||l.enter<previous||l.enter>1||!Number.isFinite(l.exit)||l.exit<0||l.exit>l.enter||l.tactics?.some(t=>!rules[t]?.objective))throw Error('Invalid reaction level or tactic');ids.add(l.id);previous=l.enter;}
      for(const trigger of r.triggers??[]){new RegExp(trigger.pattern,'i');if(!Number.isFinite(trigger.minimum)||trigger.minimum<0||trigger.minimum>1)throw Error('Invalid reaction trigger severity');}
      for(const k of ['incidentThreshold','repeatBonus','egoGain','focusGain','calmTurnsToRelease'])if(!Number.isFinite(r[k])||r[k]<0)throw Error('Invalid reaction tuning');
    }
  }
  return p;
}
export function createSession(pack,{node=pack.start}={}) {
  validatePack(pack);
  if(!Object.hasOwn(pack.nodes,node))throw Error('Unknown authored session');
  pack=clone(pack);pack.start=node;
  const section=pack.nodes[node];
  if(section.characterPrompt!==undefined){if(typeof section.characterPrompt!=='string')throw Error('Invalid session direction');pack.characterPrompt=section.characterPrompt;}
  if(section.initialPhase!==undefined&&pack.behaviour){if(!Object.hasOwn(pack.behaviour.phases,section.initialPhase))throw Error('Invalid session starting phase');pack.behaviour.initialPhase=section.initialPhase;}
  const s = {id:randomUUID(),pack:clone(pack),active:'main',cursor:0,branches:{main:{name:'First take',events:[]}},candidate:null};
  propose(s,pack.start);
  if(pack.behaviour){const direction=selectDirection(project(s),neutral(),pack.behaviour);Object.assign(s.candidate,direction,{turnId:randomUUID()});append(s,{type:'candidate',turnId:s.candidate.turnId,candidate:clone(s.candidate)});}
  return s;
}
export function project(s) {
  const p = {state:{...(s.pack.behaviour?.defaults??{}),...canonicalState(s.pack.initialState)},knowledge:clone(s.pack.knowledge),node:s.pack.start,scenario:s.pack.scenario,phase:s.pack.behaviour?.initialPhase??'PLEASANT_FACADE',transcript:[],tactics:{},tendency:{compliant:0,resistant:0},playerModel:{tendencies:{},signals:{},tactics:{},responses:{}},reaction:initialReaction(s.pack.behaviour?.reaction),activeFacade:s.pack.behaviour?.initialFacade??'PROFESSIONAL_INSTRUCTOR',temporaryModifiers:clone(s.pack.temporary_modifiers??{}),worldState:applyWorldFacts([],s.pack.worldState??[],'authored opening'),worldClaims:[],beatProgression:initialBeat(s.pack.behaviour?.beatProgression),audit:{},direction:null,pendingCandidate:null};
  for (const e of s.branches[s.active].events.slice(0,s.cursor)) {
    if (e.type === 'input') {
      p.transcript.push(e);
      for (const [oldKey,v] of Object.entries(e.effects ?? {})) {const k=stateKey(oldKey);p.state[k] = Math.max(0,Math.min(1,(p.state[k]??0)+v));}
      if (e.stance in p.tendency) p.tendency[e.stance]++;
      if(e.tactic && e.stance !== 'neutral') { const t = p.tactics[e.tactic] ?? {success:0,total:0}; t.total++; t.success += Number(e.stance==='compliant'); p.tactics[e.tactic]=t; }
    }
    if(e.type === 'utterance') { p.node=e.node; p.transcript.push(e); p.pendingCandidate=null; }
    if(e.type === 'world'){p.audit={worldEvent:e.text};p.transcript.push(e);Object.assign(p.temporaryModifiers,e.temporaryModifiers??{});p.worldState=applyWorldFacts(p.worldState,e.facts??[],e.id);p.worldClaims=assessWorldClaims(p.worldClaims,p.worldState);}
    if(e.type==='speech_interpretation')p.audit={turnId:e.turnId,speech:e.result};
    if(e.type==='player_world_claims'){p.audit.worldClaims=clone(e.assessments);p.worldClaims.push(...clone(e.assessments));}
    if(e.type==='action_interpretation')p.audit.action=e.result;
    if(e.type==='interaction_evaluated')p.audit.evaluation=e.result;
    if(e.type==='reaction_updated'){p.reaction=clone(e.reaction);p.audit.reaction=e.reaction.lastEvaluation;}
    if(e.type==='state_delta'){for(const [k,v] of Object.entries(e.changes))p.state[k]=v.value;p.audit.stateChanges=e.changes;}
    if(e.type==='player_model_delta'){p.playerModel=clone(e.next);p.audit.playerModel=e;}
    if(e.type==='knowledge_proposed'){p.audit[e.channel==='player'?'playerKnowledge':'npcKnowledge']=e.decisions;}
    if(e.type==='memory_committed')p.audit.memory=e.knowledge;
    if(e.type==='npc_interpretation')p.audit.npcInterpreter=e.result;
    if(e.type==='director_decision'){p.direction=clone(e.decision);if(e.decision.beatProgression)p.beatProgression=clone(e.decision.beatProgression);p.phase=e.decision.phase;p.activeFacade=e.decision.activeFacade??p.activeFacade;}
    if(e.type==='candidate'){p.pendingCandidate=clone(e.candidate);if(e.candidate.beatProgression)p.beatProgression=clone(e.candidate.beatProgression);}
    for(const k of e.knowledge ?? []) p.knowledge.push({...k,id:k.id??randomStable(e.id,k),provenance:k.provenance??e.id});
  }
  return p;
}
function randomStable(id,k) { return `${id}:${k.subject}:${k.predicate}`; }
export function append(s,e) {
  if(s.cursor !== s.branches[s.active].events.length) throw Error('Create a branch before changing the past.');
  const event={id:randomUUID(),...e};s.branches[s.active].events.push(event); s.cursor++;return event;
}
function propose(s,node) {
  const n=s.pack.nodes[node];
  s.candidate={node,text:n.text,tactic:n.tactic??'friendly_bonding',objective:n.objective??s.pack.objective,direction:'',locked:false,knowledge:clone(n.knowledge??[])};
}
export function command(s,cmd) {
  if(cmd.type==='seek') { const n=Number(cmd.cursor); if(!Number.isInteger(n)||n<0||n>s.branches[s.active].events.length) throw Error('Invalid timeline position'); s.cursor=n;s.candidate=null; return; }
  if(cmd.type==='branch') { const id=randomUUID(); s.branches[id]={name:String(cmd.name||'Alternate take').slice(0,80),events:clone(s.branches[s.active].events.slice(0,s.cursor))}; s.active=id; return; }
  if(cmd.type==='checkout') { if(!s.branches[cmd.id]) throw Error('Unknown branch'); s.active=cmd.id;s.cursor=s.branches[cmd.id].events.length;s.candidate=null;return; }
  if(cmd.type==='checkpoint') { append(s,{type:'checkpoint',label:String(cmd.name||'Checkpoint')});return; }
  if(cmd.type==='draft') { if(s.candidate?.locked) throw Error('Unlock this draft before editing'); if(!s.candidate) throw Error('No draft'); validateKnowledge(cmd.knowledge??[]);validateLengthOverride(cmd.lengthOverride??s.candidate.lengthOverride??'AUTO');s.candidate.lengthOverride=cmd.lengthOverride??s.candidate.lengthOverride??'AUTO';s.candidate.text=String(cmd.text);s.candidate.direction=String(cmd.direction??'');s.candidate.knowledge=clone(cmd.knowledge??[]);return; }
  if(cmd.type==='lock') { if(s.candidate) s.candidate.locked=!s.candidate.locked;return; }
  if(cmd.type==='accept') { if(!s.candidate?.text.trim()) throw Error('Draft cannot be empty'); const c=s.candidate; append(s,{type:'utterance',...clone(c)});s.candidate=null;return; }
  if(cmd.type==='retry') { if(s.candidate?.locked) throw Error('Draft is locked'); propose(s,s.candidate?.node??project(s).node);return; }
  if(s.candidate) throw Error('Commit the current draft first.');
  const p=project(s);
  if(cmd.type==='world') { const node=s.pack.worldEvents[cmd.event];if(!node) throw Error('Unknown event');append(s,{type:'world',text:cmd.event});propose(s,node);return; }
  if(cmd.type==='turn') {
    validateLengthOverride(cmd.lengthOverride??'AUTO');
    const n=s.pack.nodes[p.node], choice=n.choices.find(c=>c.id===cmd.choice);
    if(cmd.choice && !choice) throw Error('This action is not available here');
    const text=String(cmd.text??'').trim();if(!text&&!choice) throw Error('Write a response or choose an action');
    const rule=s.pack.speechRules.find(r=>new RegExp(r.pattern,'i').test(text));
    const stance=choice?.stance??rule?.stance??'neutral';
    const knowledge=(s.pack.disclosures??[]).filter(r=>new RegExp(r.pattern,'i').test(text)).map(r=>clone(r.knowledge));
    append(s,{type:'input',text,action:choice?.label??null,stance,effects:choice?.effects??rule?.effects??{},tactic:n.tactic,knowledge});
    propose(s,s.pack.dialogueMode==='continuous'?p.node:(choice?.target??rule?.target??n.fallback??p.node));s.candidate.lengthOverride=cmd.lengthOverride??'AUTO';return;
  }
  throw Error('Unknown command');
}
