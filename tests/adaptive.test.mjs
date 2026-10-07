import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSession,command,project} from '../engine/index.mjs';
import {adaptiveCommand} from '../engine/adaptive.mjs';
import {neutral,keywordInterpret,adjudicate,LLMInteractionInterpreter} from '../engine/interpretation.mjs';
import {selectDirection} from '../engine/behaviour.mjs';
const pack=JSON.parse(readFileSync(new URL('../packs/continuous-lesson.json',import.meta.url)));
const fixture=(scores={},stance='NEUTRAL',proposals=[])=>({...neutral(),confidence:0.95,stance,scores:{...neutral().scores,...scores},social_signals:scores.praise?['PRAISES_INSTRUCTOR']:[],proposals});
const praise=fixture({praise:0.95,agreement:0.6},'AFFILIATIVE');
const polite=fixture({resistance:0.8,disagreement:0.8,boundary_setting:0.8,authority_challenge:0.1},'REFUSE');
const challenge=fixture({resistance:0.7,authority_challenge:0.95,hostility:0.5},'ASSERTIVE');
function harness(initial=praise){let speech=initial,calls={speech:0,npc:0,generation:0};const config={interpreter:{interpret:async()=>{calls.speech++;return structuredClone(speech);},disclosures:async text=>{calls.npc++;return {source:'fixture/mock',proposals:text.includes('wife')?[{subject:'instructor',predicate:'relationship_with_wife',value:text.includes('perfect')?'perfect':'strained',kind:'claim',confidence:0.95,evidence:text}]:[]};}}};const gen=async()=>{calls.generation++;return 'Well, you did listen. That helps.';};return {config,gen,calls,set:x=>speech=x,run:(s,c)=>adaptiveCommand(s,c,config,gen)};}
function start(){const s=createSession(pack);command(s,{type:'accept'});return s;}

test('A/B/C fixtures create different state, player models and phase-legal tactics',async()=>{
  const results=[];
  for(const f of [praise,polite,challenge]){const h=harness(f);let s=start();const tactics=[];for(let i=0;i<8;i++){s=await h.run(s,{type:'turn',text:'Fixture speech',autoAccept:true});tactics.push(project(s).direction.tactic);}results.push({s,p:project(s),tactics});}
  const [a,b,c]=results;assert.ok(a.p.state.rapport>b.p.state.rapport);assert.ok(a.p.state.charm_mask>=0.85);assert.equal(a.p.playerModel.signals.PRAISES_INSTRUCTOR,8);
  assert.equal(a.p.playerModel.tendencies.physical_compliance,undefined);
  assert.ok(b.p.state.authority_threat<c.p.state.authority_threat);assert.ok(b.p.state.control_need<c.p.state.control_need);assert.ok(b.p.state.charm_mask>=0.8);assert.ok(c.p.state.charm_mask<0.65);assert.equal(b.p.reaction.mode,'CALM');assert.equal(c.p.reaction.mode,'MASK_SLIPPING');
  assert.ok(a.tactics.every(t=>t===null));assert.ok(b.tactics.includes('SUBTLE_DIG'));assert.ok(c.tactics.some(t=>t==='RETALIATE'||t==='SET_LIMIT'));
  for(const result of results){assert.equal(result.p.phase,'PLEASANT_FACADE');for(const tactic of result.tactics)if(tactic!==null)assert.ok({...pack.behaviour.tactics,...pack.behaviour.reaction.tactics}[tactic]);}
  const h=harness(fixture());let s=b.s;const anger=b.p.state.anger,threat=b.p.state.authority_threat;for(let i=0;i<5;i++)s=await h.run(s,{type:'turn',text:'An ordinary question?',autoAccept:true});assert.ok(project(s).state.anger<anger);assert.ok(project(s).state.authority_threat<threat);
});
test('verbal refusal and physical compliance remain independent and contradictory',async()=>{
  const h=harness(polite),s=start();s.pack.nodes.lesson.choices.push({id:'tailgate',label:'Tailgate',target:'lesson'},{id:'stay_back',label:'Stay back',target:'lesson'});
  const a=project(await h.run(s,{type:'turn',text:"No, I'm not tailgating him.",choice:'tailgate'}));
  const b=project(await h.run(s,{type:'turn',text:"No, I'm not tailgating him.",choice:'stay_back'}));
  assert.equal(a.audit.evaluation.verbal,'REFUSE');assert.equal(a.audit.evaluation.physical,'COMPLY');assert.equal(a.audit.evaluation.contradiction,true);assert.equal(b.audit.evaluation.contradiction,false);assert.equal(b.audit.evaluation.physical,'REFUSE');
});
test('regeneration, editing, duplicate requests and replay do not repeat effects',async()=>{
  const h=harness();let s=await h.run(start(),{type:'turn',requestId:'turn-1',text:'Thank you!'});const before=project(s),speechCalls=h.calls.speech;
  s=await h.run(s,{type:'retry',requestId:'regen-1'});assert.equal(h.calls.speech,speechCalls);assert.deepEqual(project(s).state,before.state);assert.deepEqual(project(s).playerModel,before.playerModel);
  const count=s.cursor;s=await h.run(s,{type:'retry',requestId:'regen-1'});assert.equal(s.cursor,count);
  s=await h.run(s,{type:'draft',text:'Edited reply',direction:'More understated',knowledge:[]});assert.deepEqual(project(s).state,before.state);
  const calls=structuredClone(h.calls);assert.deepEqual(project(s),project(JSON.parse(JSON.stringify(s))));assert.deepEqual(h.calls,calls);
});
test('only final edited NPC claims update player knowledge; contradictions preserve canon',async()=>{
  const h=harness();let s=await h.run(start(),{type:'turn',text:'How is your wife?'});const canon=structuredClone(s.pack.canon);
  s=await h.run(s,{type:'draft',text:'My wife and I have a perfect marriage.',knowledge:[]});assert.equal(project(s).knowledge.length,2);s=await h.run(s,{type:'retry'});assert.equal(project(s).knowledge.length,2);
  s=await h.run(s,{type:'draft',text:'My wife and I have a perfect marriage.',knowledge:[]});s=await h.run(s,{type:'accept',requestId:'accept-1'});const first=project(s).knowledge.at(-1);assert.equal(first.observer,'player');assert.equal(first.source_actor,'instructor');assert.equal(first.kind,'claim');
  s=await h.run(s,{type:'turn',text:'Really?'});s=await h.run(s,{type:'draft',text:"My wife hasn't spoken to me properly in months.",knowledge:[]});s=await h.run(s,{type:'accept'});
  assert.ok(project(s).knowledge.some(k=>k.kind==='contradiction'));assert.deepEqual(s.pack.canon,canon);
});
test('independence disclosure is evidence-backed, remembered and observer-scoped',async()=>{
  const text='I think the freedom. Now I can go anywhere at anytime without relying on others.';
  const proposal={subject:'player',predicate:'values',value:'independence',kind:'belief',confidence:0.85,evidence:'without relying on others'};
  const h=harness(fixture({self_disclosure:0.9},'NEUTRAL',[proposal]));const s=await h.run(start(),{type:'turn',text});const k=project(s).knowledge.at(-1);assert.equal(k.value,'independence');assert.equal(k.observer,'instructor');assert.equal(k.source_actor,'player');assert.ok(k.provenance);
  const rejected=adjudicate([{...proposal,evidence:'not in message'},{...proposal,confidence:0.4},{...proposal,kind:'fact'}],text,'player','instructor','test',[]);assert.equal(rejected.committed.length,0);
});
test('tactic evidence belongs to actual last committed reply; absence is unknown',async()=>{
  const h=harness();let s=start();s=await h.run(s,{type:'turn',text:'Thanks!',autoAccept:true});const prior=project(s).transcript.at(-1);h.set(fixture());s=await h.run(s,{type:'turn',text:'What time is it?'});
  const e=project(s).audit.playerModel.evidence;assert.equal(prior.tactic,null);assert.equal(e,null);assert.deepEqual(project(s).playerModel.tactics,{});
});
test('branching restores pending drafts and isolates adaptive futures without model calls',async()=>{
  const h=harness();let s=await h.run(start(),{type:'turn',text:'Thanks!'});const cursor=s.cursor;const draft=s.candidate.text;s=await h.run(s,{type:'accept'});const original=structuredClone(s.branches.main);const calls=structuredClone(h.calls);
  s=await h.run(s,{type:'seek',cursor});assert.equal(s.candidate.text,draft);s=await h.run(s,{type:'branch',name:'Other'});assert.deepEqual(h.calls,calls);s=await h.run(s,{type:'draft',text:'Another answer',knowledge:[]});assert.deepEqual(s.branches.main,original);
});
test('fallback does not misclassify neutral questions containing not; malformed LLM output is marked',async()=>{
  assert.equal(keywordInterpret('Is it not easier to turn here?',pack.behaviour).stance,'UNCERTAIN');
  const interpreter=new LLMInteractionInterpreter({apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{}'}]}]})})});
  const result=await interpreter.interpret('Feels great and all thanks to you!',[],pack.behaviour);assert.equal(result.source,'keyword fallback');assert.ok(result.fallbackReason);assert.ok(result.scores.praise>0.8);
});
test('canonical state names migrate old aliases and old effects without duplicate state',()=>{
  const s=start();s.pack.initialState={charm:0.8,control:0.4,anger:0.1};s.branches.main.events.push({id:'legacy',type:'input',effects:{charm:-0.1,control:0.1},text:'Old turn'});s.cursor++;
  const state=project(s).state;assert.ok(Math.abs(state.charm_mask-0.7)<1e-8);assert.equal(state.control_need,0.5);assert.equal(state.charm,undefined);assert.equal(state.control,undefined);
});
test('high charm and opening phase bar late tactics regardless of threat',()=>{
  const p=project(start());Object.assign(p.state,{anger:1,authority_threat:1,charm_mask:0.9});const d=selectDirection(p,challenge,pack.behaviour);assert.ok(!d.eligible.includes('ANGER'));assert.ok(!d.eligible.includes('DIRECT_COMMAND'));
});
test('timeline seeking cannot expose a half-applied turn as a continuation point',async()=>{
  const h=harness();let s=start();s=await h.run(s,{type:'turn',text:'Hello',autoAccept:true});const effectsIndex=s.branches.main.events.findIndex(e=>e.type==='state_delta');s=await h.run(s,{type:'seek',cursor:effectsIndex+1});assert.ok(s.cursor<effectsIndex);assert.equal(project(s).audit.stateChanges,undefined);
});
test('failed generation rolls back interpretation effects and knowledge; retry applies once',async()=>{
  const h=harness(),s=start(),before=structuredClone(s);await assert.rejects(adaptiveCommand(s,{type:'turn',text:'Thanks'},h.config,async()=>{throw Error('offline');}));assert.deepEqual(s,before);const next=await h.run(s,{type:'turn',text:'Thanks'});assert.equal(project(next).playerModel.signals.PRAISES_INSTRUCTOR,1);
});
test('author direction survives regeneration and edited words alone are extracted',async()=>{
  const h=harness();let s=await h.run(start(),{type:'turn',text:'Hello'});s=await h.run(s,{type:'draft',text:'Temporary draft',direction:'Quieter and shorter',knowledge:[]});s=await h.run(s,{type:'retry'});assert.equal(s.candidate.direction,'Quieter and shorter');assert.equal(h.calls.speech,1);assert.equal(h.calls.npc,0);
});
