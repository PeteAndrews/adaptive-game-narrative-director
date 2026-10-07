// Opt-in billable check. Uses isolated in-memory histories, never user sessions.
import {readFile} from 'node:fs/promises';
import {createSession,command,project} from '../engine/index.mjs';
import {applyDialogueCommand} from '../engine/dialogue.mjs';
import {readConfig} from '../engine/config.mjs';
const config=await readConfig(),pack=JSON.parse(await readFile(new URL('../packs/continuous-lesson.json',import.meta.url),'utf8'));
let s=createSession(pack);s.candidate.text="Look at him, right up your arse. Don't move over just because he's in a BMW.";command(s,{type:'accept'});
for(const [label,text,choice] of [
 ['A','Huh, probably just some suit late for his macchiato.'],
 ['B',"Haha, are you joking? That's super dangerous."],
 ['C','Nah, not worth it.'],
 ['D',"Okay, you're right. Let's push Mr Macchiato.",'PULL_UP_BEHIND_CAR'],
 ['E','She tells me to stand up for myself all the time but when I do...']
]){
 s=await applyDialogueCommand(s,{type:'turn',text,choice,autoAccept:true},config);const p=project(s),d=p.direction;
 console.log(JSON.stringify({label,text,mode:d.responseMode,advancement:d.objectiveAdvancement,facade:d.activeFacade,tactic:d.tactic,completion:p.audit.speech.completion_status,targets:p.audit.speech.targets,safety:p.audit.speech.scores.safety_concern,disrespect:p.audit.speech.scores.npc_disrespect,interpretationSource:p.audit.speech.source,physical:p.audit.action.outcome,knowledge:p.audit.playerKnowledge,reply:p.transcript.at(-1).text}));
 if(p.audit.speech.source==='keyword fallback')throw Error('Live interpretation fell back');
 if(label==='A'&&(d.tactic!==null||d.objectiveAdvancement!=='NONE'||p.audit.speech.scores.npc_disrespect>0.2))throw Error('Shared joke was misdirected');
 if(label==='E'&&(d.responseMode!=='PROBE'||d.tactic!==null))throw Error('Incomplete disclosure was not probed');
}
console.log('Live check complete; no saved sessions were changed.');
