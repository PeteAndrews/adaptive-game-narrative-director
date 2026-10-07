import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSession,command,project} from '../engine/index.mjs';
import {applyDialogueCommand,dialogueRequest,generateReply} from '../engine/dialogue.mjs';
import {publicConfig,readConfig} from '../engine/config.mjs';
const pack=JSON.parse(readFileSync(new URL('../packs/continuous-lesson.json',import.meta.url)));
delete pack.behaviour; // Legacy provider contract; adaptive lifecycle is covered separately.
function start(){const s=createSession(pack);command(s,{type:'accept'});return s;}
const success=text=>async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]})});
test('a question is sent verbatim and the generated answer commits without scene progression',async()=>{
  const s=start();let request;
  const next=await applyDialogueCommand(s,{type:'turn',text:'Why is this lesson free?',autoAccept:true},{apiKey:'test-key',fetchImpl:async(url,opts)=>{assert.equal(url,'https://api.openai.com/v1/responses');request=JSON.parse(opts.body);return success('Because I like to see my students settle in.')();}});
  assert.equal(request.input.at(-1).content,'Why is this lesson free?');assert.equal(request.store,false);
  assert.equal(project(next).transcript.at(-1).text,'Because I like to see my students settle in.');
  assert.equal(project(next).node,'lesson');assert.equal(next.candidate,null);assert.equal(s.cursor,1);
});
test('subsequent questions include the committed answer and stay in one scene',async()=>{
  let s=start();for(const text of ['Why a free lesson?','How long have you been teaching?','What do you enjoy about it?'])s=await applyDialogueCommand(s,{type:'turn',text,autoAccept:true},{apiKey:'test',fetchImpl:success('An answer to '+text)});
  assert.equal(project(s).transcript.length,7);assert.equal(project(s).node,'lesson');
});
test('failed and missing-key requests do not mutate the original session',async()=>{
  const s=start(),before=structuredClone(s);
  for(const config of [{apiKey:''},{apiKey:'test',fetchImpl:async()=>({ok:false,status:401})},{apiKey:'test',fetchImpl:async()=>{throw Error('network');}}]){
    await assert.rejects(applyDialogueCommand(s,{type:'turn',text:'Hello'},config));assert.deepEqual(s,before);
  }
});
test('director drafts are excluded from history until edited and committed',async()=>{
  const s=await applyDialogueCommand(start(),{type:'turn',text:'Why?'},{apiKey:'test',fetchImpl:success('Rejected draft')});
  assert.ok(!JSON.stringify(project(s)).includes('Rejected draft'));
  command(s,{type:'draft',text:'The approved answer',knowledge:[]});command(s,{type:'accept'});
  const next=await applyDialogueCommand(s,{type:'turn',text:'Really?'},{apiKey:'test',fetchImpl:success('Yes.')});
  const req=dialogueRequest(next,'test');assert.ok(JSON.stringify(req).includes('The approved answer'));assert.ok(!JSON.stringify(req).includes('Rejected draft'));
});
test('rewind excludes discarded branch history, private beliefs and scripted knowledge',async()=>{
  let s=start();s=await applyDialogueCommand(s,{type:'turn',text:'Old future',autoAccept:true},{apiKey:'test',fetchImpl:success('Old response')});command(s,{type:'seek',cursor:1});command(s,{type:'branch',name:'New direction'});
  s.pack.knowledge.push({subject:'secret',predicate:'is',value:'private-belief',observer:'player',kind:'belief',confidence:1});
  const next=await applyDialogueCommand(s,{type:'turn',text:'New question'},{apiKey:'test',fetchImpl:success('New answer')});
  const req=JSON.stringify(dialogueRequest(next,'test'));assert.ok(!req.includes('Old future'));assert.ok(!req.includes('Old response'));assert.ok(!req.includes('private-belief'));assert.deepEqual(next.candidate.knowledge,[]);
});
test('provider rejects empty/incomplete output and maps rate limit without leaking upstream body',async()=>{
  const s=start();command(s,{type:'turn',text:'Hello'});
  await assert.rejects(generateReply(s,{apiKey:'secret',fetchImpl:success('')}),/complete reply/);
  await assert.rejects(generateReply(s,{apiKey:'secret',fetchImpl:async()=>({ok:false,status:429,json:async()=>({secret:'secret'})})}),/quota or rate limit/);
});
test('configuration returns only readiness and model to the browser',async()=>{
  const c=await readConfig(new URL('./nonexistent.env',import.meta.url),{OPENAI_API_KEY:'private',OPENAI_MODEL:'example'});
  assert.deepEqual(publicConfig(c),{configured:true,model:'example'});assert.ok(!JSON.stringify(publicConfig(c)).includes('private'));
});
test('network permission failures are distinguished from timeouts',async()=>{
  const s=start();command(s,{type:'turn',text:'Hello'});
  const blocked=Object.assign(new Error('fetch failed'),{cause:{code:'EACCES'}});
  await assert.rejects(generateReply(s,{apiKey:'test',fetchImpl:async()=>{throw blocked;}}),/sandbox or network permissions/);
  const timeout=Object.assign(new Error('timed out'),{name:'TimeoutError'});
  await assert.rejects(generateReply(s,{apiKey:'test',fetchImpl:async()=>{throw timeout;}}),/connection timed out/);
});
