import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSession,command,project,validatePack} from '../engine/index.mjs';
import {adaptiveCommand} from '../engine/adaptive.mjs';
import {neutral} from '../engine/interpretation.mjs';
import {exportCurrentTake} from '../public/dialogue-history.js';
import {knowledgeCards} from '../public/director.js';
const pack=JSON.parse(readFileSync(new URL('../packs/continuous-lesson.json',import.meta.url)));
const playerText='I value independence.',npcText='My wife is away this weekend.';
const proposal={subject:'player',predicate:'values',value:'independence',kind:'belief',confidence:0.9,evidence:playerText};
const config={interpreter:{interpret:async()=>({...neutral('fixture'),confidence:0.9,proposals:[proposal]}),disclosures:async text=>({source:'fixture',proposals:text===npcText?[{subject:'instructor',predicate:'wife_location',value:'away',kind:'claim',confidence:0.9,evidence:npcText}]:[]})}};
const run=(s,c,g=async()=>npcText)=>adaptiveCommand(s,c,config,g);
const start=()=>{const s=createSession(pack,{sceneId:'scene-a'});command(s,{type:'accept'});return s;};

test('disclosure commits distinguish heard from belief kind and retain source/commit/turn/time/origin',async()=>{
 const s=await run(start(),{type:'turn',text:playerText});const p=project(s),k=p.knowledge.find(k=>k.value==='independence'),a=k.acquisition;
 assert.equal(k.kind,'belief');assert.equal(k.observer,'instructor');assert.equal(a.method,'disclosure');assert.equal(a.attitude,'heard');assert.equal(a.scene_id,'scene-a');assert.equal(a.session_id,s.pack.start);assert.equal(a.take_id,s.id);assert.equal(a.branch_id,'main');assert.ok(a.turn_id);assert.ok(Number.isFinite(Date.parse(a.timestamp)));assert.equal(a.evidence,playerText);
 const events=s.branches.main.events;assert.equal(events.find(e=>e.id===a.source_event_id).type,'input');assert.equal(events.find(e=>e.id===a.knowledge_commit_event_id).type,'knowledge_committed');
 assert.ok(!p.knowledge.some(k=>k.value==='away'));const committed=await run(s,{type:'accept'}),npc=project(committed).knowledge.find(k=>k.value==='away');assert.equal(npc.observer,'player');assert.equal(npc.acquisition.attitude,'heard');assert.equal(npc.acquisition.turn_id,a.turn_id);assert.equal(committed.branches.main.events.find(e=>e.id===npc.acquisition.source_event_id).type,'utterance');
});

test('discarded NPC candidates and failed generation cannot create knowledge',async()=>{
 const base=start(),pending=await run(base,{type:'turn',text:playerText});
 const edited=await run(pending,{type:'draft',text:'Nothing to disclose.',knowledge:[]});const final=await run(edited,{type:'accept'});assert.ok(!project(final).knowledge.some(k=>k.value==='away'));
 const before=JSON.stringify(base);await assert.rejects(run(base,{type:'turn',text:playerText},async()=>{throw Error('generation failed');}));assert.equal(JSON.stringify(base),before);assert.ok(!project(base).knowledge.some(k=>k.value==='independence'));
});

test('player-model observations have inference envelopes without being promoted to knowledge or truth confidence',async()=>{
 const s=await run(start(),{type:'turn',text:playerText});const p=project(s);assert.ok(p.inferences.length);
 for(const k of p.inferences){assert.equal(k.observer,'instructor');assert.equal(k.acquisition.method,'inference');assert.equal(k.acquisition.attitude,'suspected');assert.equal(k.confidence,null);assert.equal(k.extraction_confidence,0.9);assert.ok(k.acquisition.supporting_event_ids.length>=2);assert.ok(!p.knowledge.some(x=>x.id===k.id));assert.equal(k.evidence,playerText);}
});

test('world claims remain heard assertions; world events remain authoritative observations',async()=>{
 const local={interpreter:{...config.interpreter,interpret:async()=>({...neutral(),confidence:0.9,world_claims:[{subject:'other_driver',predicate:'pulled_over',value:'true',confidence:0.9,evidence:'He pulled over.'}]})}};
 let s=await adaptiveCommand(start(),{type:'turn',text:'He pulled over.'},local,async()=> 'Alright.');let p=project(s);const claim=p.worldClaims.at(-1);assert.equal(claim.acquisition.method,'disclosure');assert.equal(claim.acquisition.attitude,'heard');assert.ok(!p.worldState.some(f=>f.predicate==='pulled_over'&&f.value==='true'));
 s=await run(s,{type:'accept'});s=await run(s,{type:'world',event:'BMW_PULLS_OVER'},async()=> 'Alright.');p=project(s);const fact=p.worldState.find(f=>f.predicate==='pulled_over');assert.equal(fact.value,'true');assert.equal(fact.acquisition.method,'observation');assert.equal(p.worldClaims.at(-1).status,'CONFIRMED');assert.equal(p.worldClaims.at(-1).acquisition.attitude,'heard');
});

test('branch copies and replay preserve original learning IDs and provenance with no duplicated acquisition',async()=>{
 let s=await run(start(),{type:'turn',text:playerText,autoAccept:true});const original=project(s).knowledge.find(k=>k.value==='independence');s=await run(s,{type:'branch',name:'Alternate'});assert.notEqual(s.active,'main');assert.equal(s.branches[s.active].parentBranchId,'main');
 const copy=project(JSON.parse(JSON.stringify(s))).knowledge.filter(k=>k.value==='independence');assert.equal(copy.length,1);assert.deepEqual(copy[0],original);assert.equal(copy[0].acquisition.branch_id,'main');
 const exported=exportCurrentTake(s,project(s));assert.notEqual(exported.take.branch,original.acquisition.branch_id);assert.deepEqual(exported.knowledge.records.find(k=>k.id===original.id),original);
});

test('old records without timestamps/acquisition remain loadable and gain conservative stable starting provenance',()=>{
 const s=start();delete s.createdAt;delete s.sceneId;for(const k of s.pack.knowledge){delete k.id;delete k.acquisition;}for(const e of s.branches.main.events)delete e.timestamp;
 const before=JSON.stringify(s);validatePack(s.pack);const p=project(JSON.parse(before)),again=project(JSON.parse(before));assert.deepEqual(p.knowledge,again.knowledge);assert.ok(p.knowledge.every(k=>k.id&&k.acquisition.method==='authored'&&k.acquisition.timestamp===null));assert.equal(p.knowledge[0].acquisition.source_event_id,null);assert.equal(p.knowledge[0].acquisition.source_label,'previous lessons');assert.equal(JSON.stringify(s),before);
});

test('exports include knowledge/inference ledger and supporting source events scoped to the selected timeline',async()=>{
 const s=await run(start(),{type:'turn',text:playerText,autoAccept:true}),p=project(s),out=exportCurrentTake(s,p),k=out.knowledge.records.find(k=>k.value==='independence');
 assert.ok(k.acquisition);assert.ok(out.knowledge.events.some(e=>e.id===k.acquisition.source_event_id));assert.ok(out.knowledge.events.some(e=>e.id===k.acquisition.knowledge_commit_event_id));assert.equal(out.knowledge.inferences.length,p.inferences.length);assert.ok(out.dialogue.some(line=>line.id===k.acquisition.source_event_id));
 const rewound=structuredClone(s);rewound.cursor=1;const early=exportCurrentTake(rewound,project(rewound));assert.ok(!early.knowledge.records.some(k=>k.value==='independence'));assert.equal(early.knowledge.inferences.length,0);
});

test('knowledge UI identifies the observer, uses attitude independently of kind and collapses technical details',()=>{
 const esc=x=>String(x??'').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const records=[{...proposal,observer:'instructor',source_actor:'player',acquisition:{attitude:'heard',method:'disclosure'}},{subject:'instructor',predicate:'wife_location',value:'away',kind:'claim',observer:'player',source_actor:'instructor',evidence:'My wife is away.',acquisition:{attitude:'heard',method:'disclosure'}}];
 let html=knowledgeCards(records,pack.behaviour,esc);assert.match(html,/Instructor has heard/);assert.match(html,/Player has heard/);assert.match(html,/You said:/);assert.match(html,/The instructor said:/);assert.match(html,/<details><summary>Technical details/);assert.ok(!html.includes('Instructor believes'));
 records[0].acquisition.attitude='accepted';html=knowledgeCards(records,pack.behaviour,esc);assert.match(html,/Instructor accepts/);records[0].evidence='<script>';assert.ok(!knowledgeCards(records,pack.behaviour,esc).includes('<script>'));
});
