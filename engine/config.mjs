import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
export async function readConfig(file=new URL('../.env',import.meta.url),env=process.env) {
  let local={};
  try {local=parseEnv(await readFile(file,'utf8'));} catch(e) {if(e.code!=='ENOENT')throw Error('Could not read the local .env configuration.');}
  return {apiKey:(env.OPENAI_API_KEY||local.OPENAI_API_KEY||'').trim(),model:(env.OPENAI_MODEL||local.OPENAI_MODEL||'gpt-4.1-mini').trim(),interpreterMode:env.INTERPRETER_MODE||local.INTERPRETER_MODE||'llm',jevEnabled:(env.JEV_ENABLED??local.JEV_ENABLED??'false').toLowerCase()==='true',jevApiKey:(env.JEV_API_KEY||local.JEV_API_KEY||'').trim()};
}
export function publicConfig(config) {return {configured:Boolean(config.apiKey),model:config.model};}
