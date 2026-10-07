// Opt-in billable smoke check, using an isolated in-memory session.
import {readFile} from 'node:fs/promises';
import {createSession,command,project} from '../engine/index.mjs';
import {applyDialogueCommand} from '../engine/dialogue.mjs';
import {readConfig} from '../engine/config.mjs';
const config=await readConfig();
let s=createSession(JSON.parse(await readFile(new URL('../packs/continuous-lesson.json',import.meta.url),'utf8')));command(s,{type:'accept'});
for(const text of ["You're an idiot.","You're an incompetent prick.",'Your wife is ugly.','Just shut up, you pathetic loser.']){
 s=await applyDialogueCommand(s,{type:'turn',text,autoAccept:true},config);const p=project(s);
 console.log(JSON.stringify({text,mode:p.reaction.mode,incidents:p.reaction.incidents,teachingPaused:p.reaction.teachingPaused,tactic:p.direction.tactic,rhythm:p.direction.rhythm.id,reply:p.transcript.at(-1).text,source:p.audit.speech.source}));
 if(p.audit.speech.source==='keyword fallback')throw Error('Live interpreter fell back');
}
console.log('Complete. No user sessions changed.');
