import test from 'node:test';
import assert from 'node:assert/strict';
import {directorPanel} from '../public/director.js';
import {createSession,project} from '../engine/index.mjs';
import {readFileSync} from 'node:fs';
test('Director renders initial state and diagnostic content as escaped text',()=>{
  const s=createSession(JSON.parse(readFileSync(new URL('../packs/continuous-lesson.json',import.meta.url))));
  const p=project(s),esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const html=directorPanel(p,s,(label)=>label,esc);assert.ok(html.includes('Adaptive behaviour'));assert.ok(html.includes('charm mask'));assert.ok(html.includes('Unknown — no evidence yet'));
  p.audit.speech={stance:'UNCERTAIN',confidence:0.2,source:'keyword fallback',fallbackReason:'<script>bad</script>',scores:{resistance:0},social_signals:[]};
  const diagnostics=directorPanel(p,s,label=>label,esc);assert.ok(diagnostics.includes('keyword fallback'));assert.ok(!diagnostics.includes('<script>'));assert.ok(diagnostics.includes('&lt;script&gt;'));
  assert.ok(html.includes('Response mode'));assert.ok(html.includes('None — ordinary response'));assert.ok(diagnostics.includes('Completion:'));assert.ok(diagnostics.includes('Targets:'));assert.ok(html.includes('Active facade:'));assert.ok(html.includes('Objective advancement:'));
  assert.ok(html.includes('Conversational work:'));assert.ok(html.includes('Explanation need:'));assert.ok(html.includes('Justification style:'));
});
