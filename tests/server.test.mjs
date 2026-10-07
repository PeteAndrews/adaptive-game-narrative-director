import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
async function startServer(data){
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DIALOGUE_DATA_DIR:data,INTERPRETER_MODE:'keyword'},stdio:['ignore','pipe','pipe']});
 const base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(Error('Server did not start'));},10000);child.stdout.on('data',chunk=>{const m=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timeout);resolve(m[0]);}});child.once('error',reject);});
 return {base,stop:async()=>{child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));}};
}
test('saved scene library supports adaptation, copies, selection and survives server restart without changing sessions',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'dialogue-scenes-test-'));let server=await startServer(data);
 const request=async(route,body)=>{const r=await fetch(server.base+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200);return r.json();};
 try{
  let boot=await request('/api/bootstrap');assert.equal(boot.scenes.length,1);const initialId=boot.activeSceneId;
  const prior=await request('/api/sessions',{});
  const first=structuredClone(boot.pack);first.title='Scene one';first.nodes[first.start].text='A saved opening.';
  first.nodes.meet={title:'Meet',text:'Ready for the final lesson?',tactic:'friendly_bonding',characterPrompt:'An ordinary greeting before starting the lesson.',initialPhase:Object.keys(first.behaviour.phases)[0],choices:[]};
  let saved=await request('/api/scenes',{id:initialId,pack:first});assert.equal(saved.scenes.length,1);assert.equal(saved.scenes[0].name,'Scene one');
  const second=structuredClone(first);second.title='Scene two';second.nodes[second.start].text='Another opening.';
  saved=await request('/api/scenes',{pack:second});const secondId=saved.activeSceneId;assert.notEqual(secondId,initialId);assert.equal(saved.scenes.length,2);
  const selected=await request('/api/scenes/select',{id:initialId});assert.equal(selected.pack.title,'Scene one');assert.equal(selected.pack.nodes[first.start].text,'A saved opening.');
  const section=await request('/api/sessions',{sceneId:initialId,node:'meet'});assert.equal(section.session.pack.start,'meet');assert.equal(section.session.candidate.node,'meet');assert.equal(section.session.candidate.text,'Ready for the final lesson?');assert.equal(section.session.pack.characterPrompt,first.nodes.meet.characterPrompt);assert.equal(section.session.pack.behaviour.initialPhase,first.nodes.meet.initialPhase);
  assert.equal((await fetch(server.base+'/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sceneId:initialId,node:'absent'})})).status,400);
  const current=await request('/api/sessions',{});assert.equal(current.session.pack.title,'Scene one');assert.deepEqual((await request('/api/sessions/'+prior.session.id)).session.pack,prior.session.pack);
  const asset=await fetch(server.base+'/dialogue-history.js');assert.equal(asset.status,200);
  assert.equal((await fetch(server.base+'/api/scenes/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'missing'})})).status,400);
  await server.stop();server=await startServer(data);boot=await request('/api/bootstrap');assert.equal(boot.activeSceneId,initialId);assert.equal(boot.scenes.length,2);assert.equal(boot.pack.title,'Scene one');
  assert.equal(boot.pack.nodes.meet.title,'Meet');assert.equal(boot.pack.start,first.start);assert.equal(boot.pack.characterPrompt,first.characterPrompt);
  const reopened=await request('/api/scenes/select',{id:secondId});assert.equal(reopened.pack.nodes[second.start].text,'Another opening.');
 }finally{await server.stop();}
});
test('session deletion persists, removes all branches, is idempotent and protects other sessions/scenes',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'dialogue-delete-test-'));let server=await startServer(data);
 const request=async(route,method='GET',body)=>{const r=await fetch(server.base+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200);return r.json();};
 try{
  const initial=await request('/api/bootstrap'),first=await request('/api/sessions','POST',{}),second=await request('/api/sessions','POST',{});
  await request('/api/sessions/'+first.session.id,'POST',{type:'branch',name:'Alternate future'});
  const list=await request('/api/bootstrap');assert.equal(list.sessions.find(s=>s.id===first.session.id).branches,2);
  const cross=await fetch(server.base+'/api/sessions/'+first.session.id,{method:'DELETE',headers:{Origin:'https://other.example'}});assert.equal(cross.status,400);assert.equal((await request('/api/bootstrap')).sessions.length,2);
  let deleted=await request('/api/sessions/'+first.session.id,'DELETE');assert.equal(deleted.deletedId,first.session.id);assert.deepEqual(deleted.sessions.map(s=>s.id),[second.session.id]);
  assert.equal((await fetch(server.base+'/api/sessions/'+first.session.id)).status,404);assert.deepEqual(await request('/api/sessions/'+second.session.id),second);
  deleted=await request('/api/sessions/'+first.session.id,'DELETE');assert.equal(deleted.sessions.length,1);
  assert.deepEqual((await request('/api/bootstrap')).scenes,initial.scenes);
  const asset=await fetch(server.base+'/session-manager.js');assert.equal(asset.status,200);
  await server.stop();server=await startServer(data);assert.deepEqual((await request('/api/bootstrap')).sessions.map(s=>s.id),[second.session.id]);assert.deepEqual(await request('/api/sessions/'+second.session.id),second);
  await request('/api/sessions/'+second.session.id,'DELETE');assert.equal((await request('/api/bootstrap')).sessions.length,0);
 }finally{await server.stop();}
});
test('hierarchical scene/session deletion cascades only within its scope and empty scenes survive restart',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'dialogue-hierarchy-test-'));let server=await startServer(data);
 const request=async(route,method='GET',body)=>{const r=await fetch(server.base+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200,await r.clone().text());return r.json();};
 try{
  const boot=await request('/api/bootstrap'),p=structuredClone(boot.pack),sceneA=boot.activeSceneId,first=p.start;
  p.nodes.meet={title:'Meet',text:'Hello.',tactic:'friendly_bonding',choices:[]};p.nodes[first].choices.push({id:'meeting',label:'Go to meeting',target:'meet',stance:'neutral'});p.nodes[first].fallback='meet';p.worldEvents.MEETING='meet';
  await request('/api/scenes','POST',{id:sceneA,pack:p});const q=structuredClone(p);q.title='Other scene';const sceneB=(await request('/api/scenes','POST',{pack:q})).activeSceneId;
  const a1=(await request('/api/sessions','POST',{sceneId:sceneA,node:'meet'})).session,a2=(await request('/api/sessions','POST',{sceneId:sceneA,node:first})).session,b1=(await request('/api/sessions','POST',{sceneId:sceneB,node:'meet'})).session;
  await request('/api/sessions/'+a1.id,'POST',{type:'branch',name:'Alternative'});
  let result=await request('/api/scenes/'+sceneA+'/sessions/meet','DELETE');assert.ok(!result.sessions.some(t=>t.id===a1.id));assert.ok(result.sessions.some(t=>t.id===a2.id));assert.ok(result.sessions.some(t=>t.id===b1.id));
  const selected=await request('/api/scenes/select','POST',{id:sceneA});assert.ok(!selected.pack.nodes.meet);assert.equal(selected.pack.nodes[first].fallback,first);assert.ok(!selected.pack.nodes[first].choices.some(c=>c.target==='meet'));assert.ok(!selected.pack.worldEvents.MEETING);
  result=await request('/api/scenes/'+sceneA+'/sessions/'+first,'DELETE');assert.equal(result.scenes.find(s=>s.id===sceneA).sections.length,0);assert.equal(result.pack.start,'');assert.equal(result.sessions.length,1);
  await server.stop();server=await startServer(data);let again=await request('/api/bootstrap');assert.equal(Object.keys(again.pack.nodes).length,0);assert.equal(again.sessions[0].sceneId,sceneB);assert.equal(again.sessions[0].nodeId,'meet');
  await request('/api/scenes/'+sceneA,'DELETE');assert.equal((await request('/api/bootstrap')).scenes.length,1);assert.equal((await request('/api/sessions/'+b1.id)).session.pack.title,'Other scene');
  await request('/api/scenes/'+sceneB,'DELETE');await server.stop();server=await startServer(data);again=await request('/api/bootstrap');assert.equal(again.scenes.length,0);assert.equal(again.sessions.length,0);assert.equal(again.activeSceneId,null);
  again.pack.nodes.intro={title:'New session',text:'A fresh opening.',tactic:'friendly_bonding',choices:[]};again.pack.start='intro';const recreated=await request('/api/scenes','POST',{pack:again.pack});assert.equal(recreated.scenes.length,1);
 }finally{await server.stop();}
});
test('HTTP session persistence, secret-file denial and cross-origin protection',async()=>{
  const data=await mkdtemp(path.join(tmpdir(),'dialogue-api-test-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DIALOGUE_DATA_DIR:data,INTERPRETER_MODE:'keyword'},stdio:['ignore','pipe','pipe']});
  try {
    const base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Server did not start')),10000);child.stdout.on('data',chunk=>{const m=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timeout);resolve(m[0]);}});child.once('error',reject);});
    const boot=await (await fetch(base+'/api/bootstrap')).json();assert.equal(Object.keys(boot.pack.nodes).length,1);assert.equal(boot.pack.dialogueMode,'continuous');assert.deepEqual(Object.keys(boot.provider).sort(),['configured','model']);
    const r=await fetch(base+'/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({autoAccept:true})});const created=await r.json();assert.equal(created.projection.transcript.length,1);assert.equal(created.session.candidate,null);
    const saved=await (await fetch(base+'/api/sessions/'+created.session.id)).json();assert.deepEqual(saved,created);
    const control=await fetch(base+'/length-control.js');assert.equal(control.status,200);assert.match(control.headers.get('content-type'),/javascript/);assert.match(await control.text(),/export function lengthControl/);
    assert.equal((await fetch(base+'/.env')).status,404);
    assert.equal((await fetch(base+'/api/sessions',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'})).status,400);
  } finally {child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));}
});

test('legacy workspace without acquisition or timestamps loads without rewriting history; new authored origins persist',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'dialogue-knowledge-legacy-'));let server=await startServer(data);
 try{
  const response=await fetch(server.base+'/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,200);const current=await response.json();const id=current.session.id;
  const origin=current.projection.knowledge[0].acquisition;assert.equal(origin.method,'authored');assert.equal(origin.scene_id,current.session.sceneId);assert.equal(origin.take_id,id);
  await server.stop();server=await startServer(data);const saved=await (await fetch(server.base+'/api/sessions/'+id)).json();assert.deepEqual(saved.projection.knowledge[0].acquisition,origin);await server.stop();
  const file=path.join(data,'workspace.json'),workspace=JSON.parse(await readFile(file,'utf8')),take=workspace.sessions[id];delete take.createdAt;
  for(const k of take.pack.knowledge){delete k.acquisition;delete k.id;}for(const branch of Object.values(take.branches))for(const event of branch.events){delete event.timestamp;for(const k of event.knowledge??[])delete k.acquisition;}
  const old=JSON.stringify(workspace);await writeFile(file,old);server=await startServer(data);const loaded=await (await fetch(server.base+'/api/sessions/'+id)).json();assert.equal(loaded.projection.knowledge[0].acquisition.timestamp,null);assert.equal(loaded.projection.knowledge[0].acquisition.method,'authored');assert.equal(await readFile(file,'utf8'),old);
 }finally{await server.stop();}
});
