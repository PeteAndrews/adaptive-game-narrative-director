// Map visible dialogue to complete commands, never half-applied turns.
export function dialogueBoundaries(session){
 const events=session.branches[session.active].events;
 const boundaries=[0];let adaptive=false;
 events.forEach((event,i)=>{
  if(['speech_interpretation','candidate','director_decision'].includes(event.type))adaptive=true;
  if(!adaptive||event.type==='command_completed'||(i===0&&event.type==='candidate')||event.type==='checkpoint')boundaries.push(i+1);
 });
 return Object.fromEntries(events.flatMap((event,i)=>['input','utterance'].includes(event.type)?[[event.id,{before:boundaries.findLast(n=>n<=i)??0,after:boundaries.find(n=>n>=i+1)??null}]]:[]));
}
