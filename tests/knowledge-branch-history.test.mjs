import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSession,command,project} from '../engine/index.mjs';
import {adaptiveCommand} from '../engine/adaptive.mjs';
import {neutral} from '../engine/interpretation.mjs';
import {exportCurrentTake} from '../public/dialogue-history.js';
const pack=JSON.parse(readFileSync(new URL('../packs/continuous-lesson.json',import.meta.url)));
const shared='I have a girlfriend.',oldLine="My girlfriend thinks I'm a pushover.",newLine="My girlfriend thinks I'm too aggressive.";
function harness(){
 const calls={speech:0,npc:0,generation:0};
 const config={interpreter:{
  interpret:async text=>{calls.speech++;const value=text===shared?'girlfriend':text===oldLine?'pushover':text===newLine?'too_aggressive':null;
   return {...neutral('branch fixture'),confidence:0.95,proposals:value?[{subject:'player',predicate:text===shared?'has_partner':'partner_opinion',value,kind:'claim',confidence:0.95,evidence:text}]:[]};},
  disclosures:async text=>{calls.npc++;return {source:'branch fixture',proposals:text.startsWith('My secret is ')?[{subject:'instructor',predicate:'secret',value:text.slice(13),kind:'claim',confidence:0.95,evidence:text}]:[]};}
 }};
 const run=(s,c,text='Alright.')=>adaptiveCommand(s,c,config,async()=>{calls.generation++;return text;});
 const start=()=>{const s=createSession(pack,{sceneId:'branch-scene'});command(s,{type:'accept'});return s;};
 return {calls,config,run,start};
}
const learned=s=>project(s).knowledge.filter(k=>k.observer==='instructor'&&['has_partner','partner_opinion'].includes(k.predicate));
const values=s=>learned(s).map(k=>k.value).sort();

test('shared disclosure retains identity while post-fork knowledge is isolated across branches, deterministic checkout and exports',async()=>{
 const h=harness();let s=await h.run(h.start(),{type:'turn',text:shared,autoAccept:true});const fork=s.cursor,sharedKnowledge=structuredClone(learned(s)[0]);
 s=await h.run(s,{type:'turn',text:oldLine,autoAccept:true});const branchA=structuredClone(s.branches.main),aKnowledge=structuredClone(learned(s));assert.deepEqual(values(s),['girlfriend','pushover']);
 s=await h.run(s,{type:'seek',cursor:fork});assert.deepEqual(values(s),['girlfriend']);assert.deepEqual(learned(s)[0],sharedKnowledge);
 s=await h.run(s,{type:'branch',name:'B without the disclosure'});const branchB=s.active;
 s=await h.run(s,{type:'turn',text:'What next?',autoAccept:true});assert.deepEqual(values(s),['girlfriend']);assert.deepEqual(s.branches.main,branchA);
 const calls=structuredClone(h.calls),bExport=exportCurrentTake(s,project(s));assert.equal(bExport.knowledge.records.filter(k=>k.id===sharedKnowledge.id).length,1);assert.ok(!JSON.stringify(bExport).includes('pushover'));
 for(let i=0;i<3;i++){
  s=await h.run(s,{type:'checkout',id:'main'});assert.deepEqual(learned(s),aKnowledge);assert.deepEqual(values(s),['girlfriend','pushover']);assert.deepEqual(project(JSON.parse(JSON.stringify(s))),project(s));
  const aExport=exportCurrentTake(s,project(s));assert.ok(aExport.knowledge.records.some(k=>k.value==='pushover'));assert.deepEqual(aExport.knowledge.records.find(k=>k.id===sharedKnowledge.id),sharedKnowledge);
  s=await h.run(s,{type:'checkout',id:branchB});assert.deepEqual(values(s),['girlfriend']);assert.deepEqual(learned(s)[0],sharedKnowledge);
 }
 assert.deepEqual(h.calls,calls);assert.deepEqual(s.branches.main,branchA);
});

test('historical replacement diverges from committed events, never patches the original ledger, and failed new lines learn nothing',async()=>{
 const h=harness();let s=await h.run(h.start(),{type:'turn',text:shared,autoAccept:true});const beforeOriginal=s.cursor;
 s=await h.run(s,{type:'turn',text:oldLine,autoAccept:true});const original=structuredClone(s.branches.main),originalClaim=structuredClone(learned(s).find(k=>k.value==='pushover')),originalCursor=s.cursor;
 const calls=structuredClone(h.calls);s=await h.run(s,{type:'seek',cursor:beforeOriginal});assert.deepEqual(values(s),['girlfriend']);
 assert.ok(!JSON.stringify(exportCurrentTake(s,project(s))).includes('pushover'));
 s=await h.run(s,{type:'seek',cursor:originalCursor});assert.deepEqual(learned(s).find(k=>k.value==='pushover'),originalClaim);assert.deepEqual(h.calls,calls);
 s=await h.run(s,{type:'seek',cursor:beforeOriginal});
 await assert.rejects(h.run(s,{type:'turn',text:newLine}),/Create a branch/);assert.deepEqual(s.branches.main,original);
 s=await h.run(s,{type:'branch',name:'Rewritten continuation'});const replacementBranch=s.active,beforeFailed=JSON.stringify(s);
 await assert.rejects(adaptiveCommand(s,{type:'turn',text:newLine},h.config,async()=>{throw Error('generation rejected');}),/generation rejected/);assert.equal(JSON.stringify(s),beforeFailed);assert.deepEqual(values(s),['girlfriend']);
 s=await h.run(s,{type:'turn',text:newLine,autoAccept:true});assert.deepEqual(values(s),['girlfriend','too_aggressive']);assert.deepEqual(s.branches.main,original);
 const replacement=learned(s).find(k=>k.value==='too_aggressive');assert.notEqual(replacement.id,originalClaim.id);assert.notEqual(replacement.acquisition.source_event_id,originalClaim.acquisition.source_event_id);assert.equal(replacement.acquisition.branch_id,replacementBranch);assert.equal(originalClaim.acquisition.branch_id,'main');
 const bExport=exportCurrentTake(s,project(s));assert.ok(!JSON.stringify(bExport).includes('pushover'));assert.ok(bExport.knowledge.records.some(k=>k.value==='too_aggressive'));
 s=await h.run(s,{type:'checkout',id:'main'});assert.deepEqual(values(s),['girlfriend','pushover']);assert.deepEqual(learned(s).find(k=>k.value==='pushover'),originalClaim);assert.ok(!JSON.stringify(exportCurrentTake(s,project(s))).includes('too_aggressive'));
});

test('regenerated and edited-away NPC drafts do not survive in reconstructed or exported knowledge; only committed final words teach the player',async()=>{
 const h=harness();let s=await h.run(h.start(),{type:'turn',text:shared},'My secret is discarded');const playerClaims=()=>project(s).knowledge.filter(k=>k.observer==='player'&&k.predicate==='secret');assert.equal(playerClaims().length,0);
 const speechCalls=h.calls.speech;s=await h.run(s,{type:'retry'},'My secret is regenerated');assert.equal(h.calls.speech,speechCalls);assert.equal(playerClaims().length,0);
 s=await h.run(s,{type:'draft',text:'My secret is committed',knowledge:[]});assert.equal(playerClaims().length,0);const beforeCommit=s.cursor;
 s=await h.run(s,{type:'accept'});const final=structuredClone(playerClaims()[0]),end=s.cursor;assert.equal(final.value,'committed');assert.equal(final.acquisition.attitude,'heard');
 const exported=exportCurrentTake(s,project(s));assert.ok(!JSON.stringify(exported).includes('My secret is discarded'));assert.ok(!JSON.stringify(exported).includes('My secret is regenerated'));
 const calls=structuredClone(h.calls);s=await h.run(s,{type:'seek',cursor:beforeCommit});assert.equal(playerClaims().length,0);
 s=await h.run(s,{type:'seek',cursor:end});assert.deepEqual(playerClaims(),[final]);assert.deepEqual(h.calls,calls);
});
