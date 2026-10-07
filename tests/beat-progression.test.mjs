import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSession,command,project,validatePack} from '../engine/index.mjs';
import {adaptiveCommand} from '../engine/adaptive.mjs';
import {neutral} from '../engine/interpretation.mjs';
import {resolveActionSpeech} from '../engine/interpretation.mjs';
import {dialogueRequest,generationContext} from '../engine/dialogue.mjs';
import {upgradeResponsePolicy} from '../engine/policy-upgrade.mjs';
const pack=JSON.parse(readFileSync(new URL('../packs/continuous-lesson.json',import.meta.url)));
const speech=(scores={},extra={})=>({...neutral(),confidence:0.95,topic:'other driver',scores:{...neutral().scores,...scores},...extra});
function start(custom=pack){const s=createSession(custom);s.candidate.text='That driver again.';command(s,{type:'accept'});return s;}
function harness(){let x=speech(),calls=0;const config={interpreter:{interpret:async()=>{calls++;return structuredClone(x);},disclosures:async()=>({source:'fixture',proposals:[]})}};return {set:y=>x=y,calls:()=>calls,run:(s,cmd)=>adaptiveCommand(s,cmd,config,async()=>'An ordinary reaction.')};}

test('authored progression holds without evidence and advances at most one beat with sufficient evidence',async()=>{
 const h=harness();let s=start();s=await h.run(s,{type:'turn',text:'How would you deal with that?',autoAccept:true});assert.equal(project(s).beatProgression.stage,'shared_irritation');assert.equal(project(s).beatProgression.transition,'HOLD');
 h.set(speech({alignment_with_npc:0.8}));s=await h.run(s,{type:'turn',text:'That driver is annoying.'});assert.equal(s.candidate.beatProgression.stage,'discourage_submission');assert.equal(s.candidate.beatProgression.transition,'ADVANCE');assert.equal(s.candidate.tactic,null);
 command(s,{type:'accept'});s=await h.run(s,{type:'turn',text:'I agree about that driver.'});assert.equal(s.candidate.beatProgression.stage,'discourage_submission');
});

test('an early-middle question stays within the local non-submission envelope, not the final manoeuvre',async()=>{
 const h=harness();h.set(speech({alignment_with_npc:0.8}));let s=start();for(let i=0;i<2;i++)s=await h.run(s,{type:'turn',text:'That driver again.',autoAccept:true});
 h.set(speech({information_request:0.9}));s=await h.run(s,{type:'turn',text:'How would you deal with that?'});
 assert.equal(s.candidate.beatProgression.stage,'discourage_submission');assert.match(generationContext(s).director.local_objective,/short wait/);assert.match(generationContext(s).constraints.local_beat_constraints.join(' '),/Do not prescribe a concrete/);
 const request=JSON.stringify(dialogueRequest(s,'fixture'));assert.ok(!request.includes('finalDesiredAction'));assert.ok(!request.includes('tailgating'));assert.ok(!request.includes('normalise_retaliation'));assert.ok(!request.includes(pack.behaviour.beatProgression.direction));
});

test('future objectives and final targets stay private for a completely different authored scenario',async()=>{
 const custom=structuredClone(pack);custom.behaviour.npcActor='curator';custom.behaviour.beatProgression={id:'negotiation',direction:'DIRECTOR_ONLY_DIRECTION',finalDesiredAction:'SECRET_FINAL_ACTION',initiallyActive:true,start:'rapport',topics:['exhibit'],beats:[{id:'rapport',objective:'Discuss the exhibit casually.',minTurns:1,advance:{to:'ask',anyScores:{agreement:0.8}}},{id:'ask',objective:'PRIVATE_FUTURE_OBJECTIVE'}]};
 const h=harness();h.set(speech({}, {topic:'exhibit'}));let s=start(custom);s=await h.run(s,{type:'turn',text:'About the exhibit...'});const request=JSON.stringify(dialogueRequest(s,'fixture'));
 assert.ok(request.includes('Discuss the exhibit casually.'));for(const secret of ['DIRECTOR_ONLY_DIRECTION','SECRET_FINAL_ACTION','PRIVATE_FUTURE_OBJECTIVE','negotiation'])assert.ok(!request.includes(secret));
});

test('resistance retreats; clarification, conflict and deliberate topic changes suspend progression',async()=>{
 const h=harness();h.set(speech({alignment_with_npc:0.8}));let s=start();for(let i=0;i<2;i++)s=await h.run(s,{type:'turn',text:'That driver again.',autoAccept:true});const mid=structuredClone(s);
 h.set(speech({resistance:0.8,safety_concern:0.8}));s=await h.run(s,{type:'turn',text:'That is unsafe.'});assert.equal(s.candidate.beatProgression.stage,'shared_irritation');assert.equal(s.candidate.beatProgression.transition,'RETREAT');
 for(const x of [speech({alignment_with_npc:0.9}, {completion_status:'INCOMPLETE'}),speech({alignment_with_npc:0.9,intentional_topic_change:0.9},{topic:'weekend'}),speech({insult:0.99,relationship_attack:0.99,npc_disrespect:0.99})]){h.set(x);const held=await h.run(mid,{type:'turn',text:'A different reaction.'});assert.equal(held.candidate.beatProgression.stage,'discourage_submission');assert.equal(held.candidate.localObjective,null);}
});

test('explicit player decision selects the reaction beat without inventing success',async()=>{
 const h=harness();let s=start();s=await h.run(s,{type:'turn',text:'Okay.',choice:'PULL_UP_BEHIND_CAR'});assert.equal(s.candidate.beatProgression.stage,'player_decision');assert.equal(s.candidate.responseMode,'REINFORCE');assert.equal(project(s).worldState.length,0);assert.match(s.candidate.localConstraints.join(' '),/No new escalation/);
});

test('an authored end event stays ended until an explicit activation event restarts it',async()=>{
 const h=harness();let s=start();s=await h.run(s,{type:'world',event:'LESSON_ENCOUNTER_ENDS',autoAccept:true});assert.equal(project(s).beatProgression.active,false);
 s=await h.run(s,{type:'turn',text:'That driver again.',autoAccept:true});assert.equal(project(s).beatProgression.active,false);assert.equal(project(s).direction.localObjective,null);
 s=await h.run(s,{type:'world',event:'DRIVER_HONKS'});assert.equal(s.candidate.beatProgression.active,true);assert.equal(s.candidate.beatProgression.stage,'shared_irritation');
});

test('retry, replay, rewind and branches preserve beat history without repeating progression',async()=>{
 const h=harness();h.set(speech({alignment_with_npc:0.9}));let s=start();s=await h.run(s,{type:'turn',text:'That driver again.',autoAccept:true});const boundary=s.cursor;s=await h.run(s,{type:'turn',text:'Quite right about that driver.'});assert.equal(s.candidate.beatProgression.stage,'discourage_submission');
 const calls=h.calls(),decision=structuredClone(s.candidate.beatProgression);s=await h.run(s,{type:'retry'});assert.equal(h.calls(),calls);assert.deepEqual(s.candidate.beatProgression,decision);assert.deepEqual(project(s),project(JSON.parse(JSON.stringify(s))));
 const original=structuredClone(s.branches.main);s=await h.run(s,{type:'seek',cursor:boundary});assert.equal(project(s).beatProgression.stage,'shared_irritation');s=await h.run(s,{type:'branch'});h.set(speech());s=await h.run(s,{type:'turn',text:'That driver.'});assert.equal(s.candidate.beatProgression.stage,'shared_irritation');assert.deepEqual(s.branches.main,original);
});

test('invalid progression fails validation; migration adds only missing instructor progression',()=>{
 for(const mutate of [p=>p.behaviour.beatProgression.start='missing',p=>p.behaviour.beatProgression.beats[0].advance.to='missing',p=>p.behaviour.beatProgression.beats[0].advance.anyScores={invented_score:0.5}]){const p=structuredClone(pack);mutate(p);assert.throws(()=>validatePack(p));}
 const old=structuredClone(pack);delete old.behaviour.beatProgression;const upgraded=upgradeResponsePolicy(old,pack.behaviour);assert.deepEqual(upgraded.behaviour.beatProgression,pack.behaviour.beatProgression);
 const custom=structuredClone(pack);custom.behaviour.beatProgression.direction='Author direction';assert.equal(upgradeResponsePolicy(custom,pack.behaviour).behaviour.beatProgression.direction,'Author direction');
});

test('a matching safe-distance action resolves ambiguous speech and gets a small authored disagreement without advancement',async()=>{
 const h=harness();h.set(speech({}, {completion_status:'AMBIGUOUS',topic:'other driver behavior'}));let s=start();
 s=await h.run(s,{type:'turn',text:'Gonna ease off a bit',choice:'distance'});const p=project(s);
 assert.equal(p.audit.speech.completion_status,'COMPLETE');assert.equal(p.audit.speech.actionCompletionCorrection.previous,'AMBIGUOUS');assert.equal(s.candidate.responseMode,'HOLD');assert.equal(s.candidate.beatProgression.stage,'shared_irritation');assert.equal(s.candidate.beatProgression.transition,'HOLD');assert.equal(p.audit.action.outcome,'NO_RELEVANT_ACTION');assert.equal(s.candidate.question_policy.allowed,false);
 assert.match(s.candidate.localObjective,/small disagreement/);assert.match(s.candidate.localConstraints.join(' '),/Do not praise or endorse backing off/);assert.ok(!JSON.stringify(dialogueRequest(s,'fixture')).includes('finalDesiredAction'));
});

test('action disambiguation does not override unfinished disclosures, unrelated ambiguity or genuine misunderstanding',()=>{
 for(const x of [speech({}, {completion_status:'INCOMPLETE'}),speech({possible_misunderstanding:0.9},{completion_status:'AMBIGUOUS'})])assert.equal(resolveActionSpeech(x,'Gonna ease off a bit','distance',pack.behaviour).completion_status,x.completion_status);
 assert.equal(resolveActionSpeech(speech({}, {completion_status:'AMBIGUOUS'}),'My partner meant something else','distance',pack.behaviour).completion_status,'AMBIGUOUS');
 assert.equal(resolveActionSpeech(speech({}, {completion_status:'AMBIGUOUS'}),'Gonna ease off a bit',null,pack.behaviour).completion_status,'AMBIGUOUS');
});
