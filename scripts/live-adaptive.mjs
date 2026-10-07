// Explicit opt-in smoke check; never part of npm test. Makes billable API requests.
import {readFile} from 'node:fs/promises';
import {createSession,command,project} from '../engine/index.mjs';
import {applyDialogueCommand} from '../engine/dialogue.mjs';
import {readConfig} from '../engine/config.mjs';
const config=await readConfig();
const pack=JSON.parse(await readFile(new URL('../packs/continuous-lesson.json',import.meta.url),'utf8'));
let s=createSession(pack);command(s,{type:'accept'});
for(const text of ['Feels great and all thanks to you!','I think the freedom. Now I can go anywhere at anytime without relying on others.']){
  s=await applyDialogueCommand(s,{type:'turn',text,autoAccept:true},config);
  const p=project(s);
  console.log(JSON.stringify({text,source:p.audit.speech.source,stance:p.audit.speech.stance,confidence:p.audit.speech.confidence,scores:p.audit.speech.scores,signals:p.audit.speech.social_signals,knowledge:p.audit.playerKnowledge,phase:p.phase,tactic:p.direction.tactic,reply:p.transcript.at(-1).text,npcExtraction:p.audit.npcInterpreter.source}));
  if(p.audit.speech.source!=='LLM')throw Error('Live interpreter fell back');
}
console.log('Live check complete. No user session was modified.');
