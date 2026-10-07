import {readFile,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {createSession,command,project} from './engine/index.mjs';
const pack=JSON.parse(await readFile(new URL('./packs/driving-instructor.json',import.meta.url)));
let s=createSession(pack);const rl=createInterface({input:stdin,output:stdout});
console.log('Commands: accept, say TEXT, action ID, event ID, state, rewind NUMBER, branch NAME, save, load, quit');
while(true){console.log(s.candidate?`DRAFT: ${s.candidate.text}`:`Beat: ${project(s).node}`);const input=await rl.question('> ');const [cmd,...words]=input.split(' '),value=words.join(' ');try{if(cmd==='quit')break;if(cmd==='state')console.log(JSON.stringify(project(s),null,2));else if(cmd==='save')await writeFile('data/cli-session.json',JSON.stringify(s));else if(cmd==='load')s=JSON.parse(await readFile('data/cli-session.json'));else command(s,cmd==='say'?{type:'turn',text:value}:cmd==='action'?{type:'turn',choice:value}:cmd==='event'?{type:'world',event:value}:cmd==='rewind'?{type:'seek',cursor:Number(value)}:cmd==='branch'?{type:'branch',name:value}:{type:cmd});}catch(e){console.log(e.message);}}
rl.close();
