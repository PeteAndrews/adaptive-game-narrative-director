import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSession,command,project,validatePack} from '../engine/index.mjs';
import {adaptiveCommand} from '../engine/adaptive.mjs';
import {neutral,keywordInterpret} from '../engine/interpretation.mjs';
import {generationContext,dialogueRequest,generateReply} from '../engine/dialogue.mjs';
import {callbackMemory,relevantCallbacks} from '../engine/conversation-continuity.mjs';
const pack=JSON.parse(readFileSync(new URL('../packs/continuous-lesson.json',import.meta.url)));
const fixture=(scores={},extra={})=>({...neutral(),confidence:0.95,stance:'NEUTRAL',scores:{...neutral().scores,...scores},...extra});
const mismatch=fixture({semantic_fit:0.1,response_relevance:0.15,possible_misunderstanding:0.9,clarification_needed:0.9,agreement:0.8});
function start(line='Is Mr Macchiato a regular?'){const s=createSession(pack);s.candidate.text=line;command(s,{type:'accept'});return s;}
function harness(){let result=fixture(),calls=0;const config={interpreter:{interpret:async()=>{calls++;return structuredClone(result);},disclosures:async()=>({source:'test',proposals:[]})}};return {set:x=>result=x,calls:()=>calls,run:(s,c)=>adaptiveCommand(s,c,config,async()=>'Brief reply')};}
const worldClaim={subject:'other_driver',predicate:'pulled_over',value:'true',confidence:0.95,evidence:'he pulled over'};
test('misunderstanding selects REPAIR/null, rejects invented agreement and permits a short correction question',async()=>{
 const h=harness();h.set({...mismatch,proposals:[{subject:'other_driver',predicate:'body_shape',value:'large',kind:'claim',confidence:0.9,evidence:'Dad bod is more on the large side'}]});
 const s=await h.run(start(),{type:'turn',text:"I'd say a Dad bod is more on the large side."});const p=project(s);
 assert.equal(s.candidate.responseMode,'REPAIR');assert.equal(s.candidate.tactic,null);assert.equal(s.candidate.objectiveAdvancement,'NONE');assert.equal(p.audit.speech.scores.agreement,0);assert.ok(!p.knowledge.some(k=>k.predicate==='body_shape'));assert.equal(p.audit.playerKnowledge[0].status,'rejected');
 let calls=0;const reply=await generateReply(s,{apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>{calls++;return {status:'completed',output:[{type:'message',content:[{type:'output_text',text:'No, I meant do you see him around much?'}]}]};}})});
 assert.equal(calls,1);assert.match(reply,/around much/);
 assert.equal(s.candidate.immediateDirection.repair_context.previous_npc_utterance,'Is Mr Macchiato a regular?');
});
test('jokes, deliberate topic changes and uncertain semantic judgments do not over-trigger repair',async()=>{
 for(const change of [{humour:0.95,possible_misunderstanding:0.65},{intentional_topic_change:0.9},{possible_misunderstanding:0.2}]){
  const h=harness();h.set(fixture({...mismatch.scores,...change}));const s=await h.run(start(),{type:'turn',text:'A deliberate sideways remark.'});assert.notEqual(s.candidate.responseMode,'REPAIR');
 }
 const h=harness();h.set({...mismatch,confidence:0.2});assert.notEqual((await h.run(start(),{type:'turn',text:'Unclear remark'})).candidate.responseMode,'REPAIR');
});
test('physical compliance still updates state and model with a tiny reinforcement',async()=>{
 const h=harness();const before=project(start()),s=await h.run(start(),{type:'turn',choice:'PULL_UP_BEHIND_CAR',text:'Okay.'}),p=project(s);
 assert.equal(s.candidate.responseMode,'REINFORCE');assert.equal(s.candidate.tactic,null);assert.ok(p.state.rapport>before.state.rapport);assert.equal(p.playerModel.tendencies.physical_compliance.mean,1);assert.equal(s.candidate.rhythm.maxWords,7);
 const reply=await generateReply(s,{apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Yep.'}]}]})})});assert.equal(reply,'Yep.');
 assert.match(dialogueRequest(s,'test').instructions,/Do not verbalise an inference/);
});
test('celebration remains a claim; authority confirms, contradicts or leaves it provisional',async()=>{
 for(const [event,status,mode] of [['BMW_PULLS_OVER','CONFIRMED','REACT'],['BMW_MAINTAINS_POSITION','CONTRADICTED','REPAIR'],[null,'PROVISIONAL','REACT']]){
  const h=harness();let s=start();if(event)s=await h.run(s,{type:'world',event,autoAccept:true});h.set(fixture({}, {world_claims:[worldClaim]}));s=await h.run(s,{type:'turn',text:'You see that, he pulled over!'});const p=project(s),ctx=generationContext(s);
  assert.equal(p.audit.worldClaims[0].status,status);assert.equal(s.candidate.responseMode,mode);assert.equal(s.candidate.tactic,null);assert.equal(p.worldState.length,event?1:0);assert.equal(ctx.scene.world.player_claims[0].status,status);assert.ok(!p.knowledge.some(k=>k.predicate==='pulled_over'));
  if(event)assert.equal(p.worldState[0].value,event==='BMW_PULLS_OVER'?'true':'false');
 }
});
test('salient nickname is recalled selectively without turning every joke into memory',async()=>{
 const h=harness();h.set(fixture({humour:0.9},{callbacks:[{label:'Mr Macchiato',target:'other_driver',evidence:'Mr Macchiato',confidence:0.95,explicit_nickname:true},{label:'coffee joke',target:'other_driver',evidence:'coffee joke',confidence:0.9,explicit_nickname:false}]}));
 let s=await h.run(start(),{type:'turn',text:"Let's call him Mr Macchiato. Nice coffee joke.",autoAccept:true});assert.equal(project(s).knowledge.filter(k=>k.predicate==='conversational_callback').length,1);
 h.set(fixture({}, {world_claims:[worldClaim]}));s=await h.run(s,{type:'turn',text:'he pulled over!'});assert.equal(s.candidate.immediateDirection.callbacks[0].value,'Mr Macchiato');assert.match(s.candidate.immediateDirection.constraints.join(' '),/Callbacks are optional/);
});

test('callback normalization preserves spoken spelling, deduplicates and respects observer scope',()=>{
 const speech=fixture({}, {callbacks:[{label:'mr_macchiato',target:'other_driver',evidence:'Mr Macchiato',confidence:0.95,explicit_nickname:true}]});
 const text="Let's call him Mr Macchiato.",policy=pack.behaviour;
 const stored=callbackMemory(speech,text,policy,'test',[]);assert.equal(stored[0].value,'Mr Macchiato');
 assert.deepEqual(callbackMemory(speech,text,policy,'next',stored),[]);
 const privateMemory={...stored[0],observer:policy.playerActor,value:'Private name'};
 const projection={transcript:[{type:'input',text:'Private name and Mr Macchiato'}],knowledge:[...stored,privateMemory],audit:{}};
 assert.deepEqual(relevantCallbacks(projection,speech,policy),stored);
 assert.equal(callbackMemory(speech,text,policy,'next',[{...stored[0],observer:policy.playerActor}]).length,1);
});
test('claims, callbacks and authoritative facts survive serialization, retry, rewind and branching',async()=>{
 const h=harness();h.set(fixture({}, {world_claims:[worldClaim]}));let s=await h.run(start(),{type:'turn',text:'he pulled over!',autoAccept:true});const boundary=s.cursor;
 s=await h.run(s,{type:'world',event:'BMW_MAINTAINS_POSITION'});assert.equal(project(s).worldClaims[0].status,'CONTRADICTED');const calls=h.calls();s=await h.run(s,{type:'retry'});assert.equal(h.calls(),calls);assert.deepEqual(project(s),project(JSON.parse(JSON.stringify(s))));
 const original=structuredClone(s.branches.main);s=await h.run(s,{type:'seek',cursor:boundary});assert.equal(project(s).worldState.length,0);assert.equal(project(s).worldClaims[0].status,'PROVISIONAL');s=await h.run(s,{type:'branch'});s=await h.run(s,{type:'world',event:'BMW_PULLS_OVER'});assert.equal(project(s).worldClaims[0].status,'CONFIRMED');assert.deepEqual(s.branches.main,original);
});
test('minimal rhetorical acknowledgement is accepted without forcing a longer rewrite',async()=>{
 const h=harness();h.set(fixture({humour:0.9}));const s=await h.run(start(),{type:'turn',text:'Ha!'});let calls=0;
 const reply=await generateReply(s,{apiKey:'test',fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'See?'}]}]})};}});assert.equal(reply,'See?');assert.equal(calls,1);
});
test('world facts validate and conservative fallback records a claim without changing truth',()=>{
 assert.equal(keywordInterpret('He just pulled over!',pack.behaviour).world_claims[0].predicate,'pulled_over');const bad=structuredClone(pack);bad.worldState=[{subject:'car',predicate:'position',value:42}];assert.throws(()=>validatePack(bad));
});
test('authored explicit claim survives model omission without overwriting a contradictory fact',async()=>{
 const h=harness();let s=start();s=await h.run(s,{type:'world',event:'BMW_MAINTAINS_POSITION',autoAccept:true});s=await h.run(s,{type:'turn',text:'You see that, he pulled over!'});
 assert.equal(project(s).audit.worldClaims[0].status,'CONTRADICTED');assert.equal(project(s).worldState[0].value,'false');assert.equal(s.candidate.responseMode,'REPAIR');
});
