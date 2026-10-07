import http from 'node:http';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createSession,command,project,validatePack} from './engine/index.mjs';
import {applyDialogueCommand} from './engine/dialogue.mjs';
import {readConfig,publicConfig} from './engine/config.mjs';
import {jevStatus,logJev} from './engine/jev.mjs';
import {sceneForTake,removeScene,removeSection} from './engine/scene-management.mjs';
import {upgradeResponsePolicy} from './engine/policy-upgrade.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const data=process.env.DIALOGUE_DATA_DIR||path.join(root,'data');await mkdir(data,{recursive:true});
let pack=JSON.parse(await readFile(path.join(root,'packs/continuous-lesson.json'),'utf8'));
const defaultPack=structuredClone(pack),behaviour=pack.behaviour;
const emptyPack=()=>({...structuredClone(defaultPack),title:'Untitled scene',nodes:{},start:'',speechRules:[],worldEvents:{}});
try { pack=validatePack(JSON.parse(await readFile(path.join(data,'continuous-pack.json'),'utf8'))); } catch(e) { if(e.code!=='ENOENT') console.error('Custom pack could not be loaded:',e.message); }
pack.behaviour??=structuredClone(behaviour);
pack.behaviour.reaction??=structuredClone(behaviour.reaction);
upgradeResponsePolicy(pack,behaviour);
let library={activeSceneId:'initial-scene',scenes:{'initial-scene':{id:'initial-scene',name:pack.title,pack:structuredClone(pack),updatedAt:null}}};
let sessions={};
try {const stored=JSON.parse(await readFile(path.join(data,'workspace.json'),'utf8'));library=stored.library;sessions=stored.sessions;}
catch(e){if(e.code!=='ENOENT')throw e;
 try {library=JSON.parse(await readFile(path.join(data,'scenes.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 try {sessions=JSON.parse(await readFile(path.join(data,'sessions.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
}
if(!library.scenes||(!library.scenes[library.activeSceneId]&&Object.keys(library.scenes).length))throw Error('Invalid saved scene library');
pack=library.activeSceneId?validatePack(structuredClone(library.scenes[library.activeSceneId].pack),{allowEmpty:true}):emptyPack();
if(Object.keys(pack.nodes).length)upgradeResponsePolicy(pack,behaviour);
const sceneList=()=>Object.values(library.scenes).map(({id,name,updatedAt,pack:p})=>({id,name,updatedAt,sections:Object.entries(p.nodes).map(([nodeId,n])=>({id:nodeId,name:n.title}))}));
// Add policy to prior continuous sessions without rewriting their historical events.
for(const s of Object.values(sessions))upgradeResponsePolicy(s.pack,behaviour);
const sessionList=()=>Object.values(sessions).map(s=>{
 const dialogue=s.branches[s.active].events.slice(0,s.cursor).filter(e=>['input','utterance'].includes(e.type));
 return {id:s.id,sceneId:sceneForTake(s,library),nodeId:s.pack.start,sectionName:s.pack.nodes[s.pack.start]?.title??'Legacy session',name:s.pack.title,branch:s.branches[s.active].name,continuous:s.pack.dialogueMode==='continuous',branches:Object.keys(s.branches).length,lines:dialogue.length,preview:dialogue.at(-1)?.text?.slice(0,160)??''};
});
logJev(jevStatus(await readConfig()));
const saveWorkspace=async(nextLibrary,nextSessions)=>{const f=path.join(data,'workspace.json');await writeFile(f+'.tmp',JSON.stringify({library:nextLibrary,sessions:nextSessions}));await rename(f+'.tmp',f);};
const save=(name,value)=>saveWorkspace(name==='scenes'?value:library,name==='sessions'?value:sessions);
const applyRemoval=async(change)=>{await saveWorkspace(change.library,change.takes);library=change.library;sessions=change.takes;pack=library.activeSceneId?structuredClone(library.scenes[library.activeSceneId].pack):emptyPack();if(Object.keys(pack.nodes).length)upgradeResponsePolicy(pack,behaviour);return {pack,scenes:sceneList(),activeSceneId:library.activeSceneId,sessions:sessionList()};};
let queue=Promise.resolve();
const server=http.createServer((req,res)=>{queue=queue.then(async()=>{
  try {
    const url=new URL(req.url,'http://localhost');
    res.setHeader('Cache-Control','no-store');
    if(['POST','DELETE'].includes(req.method) && (req.headers['sec-fetch-site']==='cross-site' || (req.headers.origin && new URL(req.headers.origin).host!==req.headers.host))) throw Error('Cross-origin writes are not allowed');
    if(req.method==='GET'&&!url.pathname.startsWith('/api/')) {
      const files={'/':'index.html','/app.js':'app.js','/director.js':'director.js','/length-control.js':'length-control.js','/dialogue-history.js':'dialogue-history.js','/session-manager.js':'session-manager.js','/style.css':'style.css','/manifest.json':'manifest.json'};
      const f=files[url.pathname];if(!f){res.writeHead(404);res.end();return;}
      res.setHeader('Content-Type',f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':f.endsWith('.json')?'application/json':'text/html');res.end(await readFile(path.join(root,'public',f)));return;
    }
    let body='';for await(const chunk of req){body+=chunk;if(body.length>1000000) throw Error('Request too large');}
    const b=body?JSON.parse(body):{};let result;
    if(req.method==='GET'&&url.pathname==='/api/bootstrap') result={pack,scenes:sceneList(),activeSceneId:library.activeSceneId,provider:publicConfig(await readConfig()),sessions:sessionList()};
    else if(req.method==='POST'&&(url.pathname==='/api/pack'||url.pathname==='/api/scenes')){
      const nextPack=validatePack(url.pathname==='/api/pack'?b:b.pack,{allowEmpty:true});
      const id=url.pathname==='/api/pack'?(library.activeSceneId??randomUUID()):b.id??randomUUID();
      if(typeof id!=='string'||(b.id&&!Object.hasOwn(library.scenes,id)))throw Error('Unknown saved scene');
      const next=structuredClone(library);next.activeSceneId=id;next.scenes[id]={id,name:nextPack.title,pack:structuredClone(nextPack),updatedAt:new Date().toISOString()};
      await save('scenes',next);library=next;pack=nextPack;result={ok:true,activeSceneId:id,scenes:sceneList()};
    }
    else if(req.method==='POST'&&url.pathname==='/api/scenes/select'){
      const scene=Object.hasOwn(library.scenes,b.id)?library.scenes[b.id]:null;if(!scene)throw Error('Unknown saved scene');
      const nextPack=validatePack(structuredClone(scene.pack),{allowEmpty:true});if(Object.keys(nextPack.nodes).length)upgradeResponsePolicy(nextPack,behaviour);
      const next={...library,activeSceneId:b.id};await save('scenes',next);library=next;pack=nextPack;result={pack,activeSceneId:b.id,scenes:sceneList()};
    }
    else if(req.method==='DELETE'&&url.pathname.match(/^\/api\/scenes\/([\w-]+)(?:\/sessions\/([\w-]+))?$/)){
      const m=url.pathname.match(/^\/api\/scenes\/([\w-]+)(?:\/sessions\/([\w-]+))?$/);
      result=await applyRemoval(m[2]?removeSection(library,sessions,m[1],m[2]):removeScene(library,sessions,m[1]));
    }
    else if(req.method==='POST'&&url.pathname==='/api/sessions'){
      if(b.sceneId&&!Object.hasOwn(library.scenes,b.sceneId))throw Error('Unknown saved scene');
      const source=structuredClone(b.sceneId?library.scenes[b.sceneId].pack:pack);upgradeResponsePolicy(source,behaviour);
      let s=createSession(source,{node:b.node??source.start});s.sceneId=b.sceneId??library.activeSceneId;if(b.autoAccept===true)s=await applyDialogueCommand(s,{type:'accept'},await readConfig());await save('sessions',{...sessions,[s.id]:s});sessions[s.id]=s;result={session:s,projection:project(s)};
    }
    else {
      const m=url.pathname.match(/^\/api\/sessions\/([\w-]+)$/);
      if(req.method==='DELETE'&&m){
        if(Object.hasOwn(sessions,m[1])){const next={...sessions};delete next[m[1]];await save('sessions',next);sessions=next;}
        result={ok:true,deletedId:m[1],sessions:sessionList()};
      }else{
        if(!m||!Object.hasOwn(sessions,m[1])){res.writeHead(404);res.end(JSON.stringify({error:'Session not found'}));return;}
        let s=structuredClone(sessions[m[1]]);if(req.method==='POST'){if(s.pack.dialogueMode==='continuous')s=await applyDialogueCommand(s,b,await readConfig());else command(s,b);await save('sessions',{...sessions,[s.id]:s});sessions[s.id]=s;}else if(req.method!=='GET')throw Error('Unsupported method');result={session:s,projection:project(s)};
      }
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
  }).catch(e=>{console.error(e);res.end();});});
server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`Dialogue Laboratory: http://${process.env.HOST||'127.0.0.1'}:${server.address().port}`));
