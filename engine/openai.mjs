export async function responseText(body,{apiKey,fetchImpl=fetch}) {
  if(!apiKey) throw Error('Add your OpenAI API key to .env to enable replies.');
  let response;
  try {
    response=await fetchImpl('https://api.openai.com/v1/responses',{
      method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(45000),
    });
  } catch(error) {
    const code=error.cause?.code??error.code;
    let reason='Could not connect to OpenAI. Check the server’s network connection and try again.';
    if(['EACCES','EPERM'].includes(code)) reason='The server is blocked from accessing OpenAI by its sandbox or network permissions. Restart it with network access.';
    else if(error.name==='TimeoutError'||['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'].includes(code)) reason='The OpenAI connection timed out. Please try again.';
    else if(['ENOTFOUND','EAI_AGAIN'].includes(code)) reason='The server could not resolve api.openai.com. Check its DNS or internet connection.';
    else if(['CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN'].includes(code)) reason='The server could not verify OpenAI’s TLS certificate. Check the server’s trusted certificates or network proxy.';
    throw Error(`${reason} Your message has not been saved.`);
  }
  if(!response.ok) {
    const messages={401:'OpenAI rejected the API key. Check OPENAI_API_KEY in .env.',403:'This API key does not have access to the selected model.',404:'The selected OpenAI model is unavailable. Check OPENAI_MODEL in .env.',429:'OpenAI usage quota or rate limit reached. Check API billing or try again shortly.'};
    throw Error(messages[response.status]??`OpenAI request failed (${response.status}). Try again. No dialogue was committed.`);
  }
  const result=await response.json();
  const text=(result.output??[]).filter(x=>x.type==='message').flatMap(x=>x.content??[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n').trim();
  if(result.status!=='completed'||!text) throw Error('OpenAI did not return a complete reply. Please try again.');
  return text;
}
