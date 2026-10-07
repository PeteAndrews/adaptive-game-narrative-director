export const choices=['AUTO','MICRO','SHORT','NORMAL','EXPLAIN','EXTENDED'];
export function lengthControl(candidate,{composer=false}={}){
 const selected=choices.includes(candidate.lengthOverride)?candidate.lengthOverride:'AUTO';
 const automatic=choices.includes(candidate.lengthPolicy?.id)?candidate.lengthPolicy.id.toLowerCase():null;
 const id=composer?'reply-length':'draft-length';
 return `<label for="${id}">Response length</label><select id="${id}" aria-label="Response length" ${candidate.locked?'disabled':''}>${choices.map(value=>`<option value="${value}" ${value===selected?'selected':''}>${value==='AUTO'?`Auto${automatic?` (${automatic})`:''}`:value[0]+value.slice(1).toLowerCase()}</option>`).join('')}</select><p class="muted">${composer?'Applies to the next instructor reply. Auto lets the Director choose.':'Controls this candidate on regeneration. Author direction controls content.'}</p>`;
}
