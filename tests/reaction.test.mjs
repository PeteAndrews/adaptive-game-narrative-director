import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSession,command,project} from '../engine/index.mjs';
import {adaptiveCommand} from '../engine/adaptive.mjs';
import {dialogueRequest,generateReply} from '../engine/dialogue.mjs';
import {updateReaction,initialReaction} from '../engine/reaction.mjs';
import {neutral,keywordInterpret} from '../engine/interpretation.mjs';
import {JevInterpreter,jevRequest} from '../engine/jev.mjs';
const pack=JSON.parse(readFileSync(new URL('../packs/continuous-lesson.json',import.meta.url)));
const config={interpreter:{interpret:async t=>keywordInterpret(t,pack.behaviour),disclosures:async()=>({proposals:[],source:'test'})}};
const generate=async()=> 'Reply';
function start(){const s=createSession(pack);command(s,{type:'accept'});return s;}
const turn=(s,text,autoAccept=true)=>adaptiveCommand(s,{type:'turn',text,autoAccept},config,generate);
test('cumulative insults change behavior, pause teaching and survive replay and retry',async()=>{
 let s=start();const modes=[];
 for(let i=0;i<4;i++){s=await turn(s,"You're an idiot.");modes.push(project(s).reaction.mode);}
 assert.deepEqual(modes,['DEFENSIVE','EGO_THREATENED','HOSTILE_RETALIATORY','MASK_SLIPPING']);
 assert.equal(project(s).reaction.incidents,4);assert.equal(project(s).reaction.teachingPaused,true);
 assert.ok(project(s).state.charm_mask<0.65);assert.equal(project(s).phase,'PLEASANT_FACADE');
 s=await turn(s,'What about roundabouts?',false);const p=project(s);
 assert.equal(p.reaction.teachingPaused,true);assert.ok(!s.candidate.eligible.includes('PATERNAL_ADVICE'));
 assert.match(dialogueRequest(s,'test').instructions,/paused: stay with the conflict/);
 const retried=await adaptiveCommand(s,{type:'retry'},config,generate);
 assert.deepEqual(project(retried).reaction,p.reaction);assert.deepEqual(retried.candidate.rhythm,s.candidate.rhythm);
 assert.deepEqual(project(JSON.parse(JSON.stringify(retried))),project(retried));
});
test('relationship insult jumps levels; neutral wife questions stay calm',async()=>{
 const mild=project(await turn(start(),"You're an idiot."));
 const severe=project(await turn(start(),'Your wife is ugly.'));
 assert.equal(mild.reaction.mode,'DEFENSIVE');assert.equal(severe.reaction.mode,'EGO_THREATENED');
 assert.equal(severe.reaction.lastTrigger.matches[0].sensitive,true);
 assert.equal(project(await turn(start(),'How is your wife?')).reaction.mode,'CALM');
});
test('recovery requires sustained calmer turns; response rhythms vary',async()=>{
 let s=await turn(start(),'Your wife is ugly.');s=await turn(s,'How do I drive?');assert.equal(project(s).reaction.teachingPaused,true);
 for(let i=0;i<20;i++)s=await turn(s,'An ordinary question.');
 assert.equal(project(s).reaction.mode,'CALM');assert.equal(project(s).reaction.teachingPaused,false);
 const rhythms=project(s).transcript.filter(e=>e.type==='utterance').map(e=>e.rhythm?.id).filter(Boolean);
 assert.ok(new Set(rhythms).size>=3);for(let i=1;i<rhythms.length;i++)assert.notEqual(rhythms[i],rhythms[i-1]);
});
const fallback={interpret:async()=>({...neutral('mock'),confidence:0.8}),disclosures:async()=>({proposals:[]})};
test('quoted or questioned insults do not override confident non-hostile interpretation',()=>{
 const r=pack.behaviour.reaction;
 const speech={...neutral('LLM'),confidence:0.95,stance:'QUESTION'};
 assert.equal(updateReaction(initialReaction(r),speech,'Why did you call your wife ugly?',r).mode,'CALM');
});
test('short rhythm correction is bounded and leaves reaction state intact',async()=>{
 const s=await turn(start(),'Your wife is ugly.',false);s.candidate.rhythm={id:'ABRUPT',guidance:'One brief reaction'};
 const before=JSON.stringify(project(s));let calls=0;
 const reply=await generateReply(s,{apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:++calls===1?'Are you quite finished?':'Leave my wife out of this.'}]}]})})});
 assert.equal(reply,'Leave my wife out of this.');assert.equal(calls,2);assert.equal(JSON.stringify(project(s)),before);
});
test('Jev without key never calls transport and logs honest fallback',async()=>{
 const logs=[];let called=false;
 const interpreter=new JevInterpreter({jevEnabled:true,jevLogger:x=>logs.push(x),jevFetchImpl:async()=>{called=true;}},fallback);
 const result=await interpreter.interpret('Hello',[],pack.behaviour);
 assert.equal(called,false);assert.equal(result.jev.liveAPI,false);assert.equal(result.jev.fallbackUsed,true);assert.equal(logs.length,4);assert.match(logs.join('\n'),/No key/);
});
test('Jev controls bounded scores and falls back on malformed responses',async()=>{
 const request=jevRequest('You fool',[]),answers=Object.fromEntries(Object.entries(request.questions).map(([k,q])=>[k,q.type==='choice'?{type:'choice',choice:k==='stance'?'ASSERTIVE':k==='completion_status'?'COMPLETE':'instructor',confidence:0.9}:{type:'noul',noul:k==='insult'?0.95:0}]));
 let body={answers};let calls=0;
 const interpreter=new JevInterpreter({jevEnabled:true,jevApiKey:'secret-test',jevLogger:()=>{},jevFetchImpl:async(url,options)=>{calls++;assert.equal(url,'https://jevtypesafeai.com/api/v1/decide');assert.equal(JSON.parse(options.body).questions.insult.type,'noul');return {ok:true,json:async()=>body};}},fallback);
 let result=await interpreter.interpret('You fool',[],pack.behaviour);assert.equal(result.scores.insult,0.95);assert.equal(result.jev.liveAPI,true);assert.equal(result.jev.fallbackUsed,false);
 body.answers.insult.noul=2;result=await interpreter.interpret('You fool',[],pack.behaviour);assert.equal(result.jev.liveAPI,false);assert.equal(result.jev.fallbackUsed,true);assert.equal(result.scores.insult,0);assert.equal(calls,2);
});
