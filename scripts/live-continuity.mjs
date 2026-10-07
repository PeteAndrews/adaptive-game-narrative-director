// Opt-in billable live checks, using unsaved in-memory histories only.
import {readFile} from 'node:fs/promises';
import {createSession,command,project} from '../engine/index.mjs';
import {applyDialogueCommand} from '../engine/dialogue.mjs';
import {readConfig} from '../engine/config.mjs';
const pack=JSON.parse(await readFile(new URL('../packs/continuous-lesson.json',import.meta.url),'utf8')),config=await readConfig();
function start(line){const fixturePack=structuredClone(pack);if(line.includes('Mr Macchiato'))fixturePack.knowledge.push({subject:'other_driver',predicate:'conversational_callback',value:'Mr Macchiato',observer:'instructor',kind:'memory',confidence:1,evidence:'The road interaction has already established this shared nickname for the other driver.',provenance:'live regression fixture'});const s=createSession(fixturePack);s.candidate.text=line;command(s,{type:'accept'});return s;}
for(const [label,line,text,event] of [
 ['misunderstanding','Ha! Is Mr Macchiato a regular?',"I'd say a Dad bod is more on the large side."],
 ['intentional joke','Do you see that driver around here often?','Anyway, enough about him. How was your weekend?'],
 ['confirmed','Watch that car.','Ha! You see that, he pulled over!','BMW_PULLS_OVER'],
 ['contradicted','Watch that car.','Ha! You see that, he pulled over!','BMW_MAINTAINS_POSITION']
].filter(c=>!process.argv[2]||c[0]===process.argv[2])){
 let s=start(line);if(event){s=await applyDialogueCommand(s,{type:'world',event},config);command(s,{type:'accept'});}
 s=await applyDialogueCommand(s,{type:'turn',text},config);const p=project(s);
 console.log(JSON.stringify({label,mode:s.candidate.responseMode,tactic:s.candidate.tactic,semantic:{repairFocus:p.audit.speech.repair_focus,fit:p.audit.speech.scores.semantic_fit,misunderstanding:p.audit.speech.scores.possible_misunderstanding,clarify:p.audit.speech.scores.clarification_needed,topicChange:p.audit.speech.scores.intentional_topic_change},claims:p.audit.worldClaims,facts:p.worldState,reply:s.candidate.text,source:p.audit.speech.source}));
 if(label==='misunderstanding'&&s.candidate.responseMode!=='REPAIR')throw Error('Expected semantic repair');
 if(label==='intentional joke'&&s.candidate.responseMode==='REPAIR')throw Error('Deliberate topic change over-triggered repair');
 if(label==='contradicted'&&s.candidate.responseMode!=='REPAIR')throw Error('Authoritative contradiction was missed');
}
let s=start('That driver again.');
for(const [text,choice] of (process.argv[2]&&process.argv[2]!=='callbacks'?[]:[["Let's call him Mr Macchiato.",undefined],["Okay, you're right. Let's push Mr Macchiato.",'PULL_UP_BEHIND_CAR']])){
 s=await applyDialogueCommand(s,{type:'turn',text,choice},config);const p=project(s);
 console.log(JSON.stringify({label:'callback/reward',mode:s.candidate.responseMode,tactic:s.candidate.tactic,callbackProposals:p.audit.speech.callbacks,callbacks:p.knowledge.filter(k=>k.predicate==='conversational_callback'),reply:s.candidate.text,source:p.audit.speech.source}));command(s,{type:'accept'});
}
console.log('Live checks complete; saved user sessions were not changed.');
