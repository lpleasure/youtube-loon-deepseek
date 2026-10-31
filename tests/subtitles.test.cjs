'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../src/core.js');
const root = path.resolve(__dirname, '..');
const fixture = format => fs.readFileSync(path.join(__dirname, 'fixtures', `manual.${format}`), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const requestURL = 'https://www.youtube.com/api/timedtext?v=synthetic&lang=en&signature=PRIVATE_SENTINEL';
function harness(mode = 'translate', options = {}) {
  const store = Object.assign({'ytloon.deepseek.key': 'TEST_ONLY_NOT_A_REAL_CREDENTIAL'}, options.store);
  const results = [], calls = [], logs = [], timers = new Map(); let serial = 0;
  let now = Date.now(); const epoch = now;
  function advance(ms) {
    const target = now + ms;
    for (;;) {
      const due = [...timers].filter(([,t]) => t.at <= target).sort((a,b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].fn();
    }
    now = target;
  }
  const ctx = {
    Date: class extends Date { static now() { return now; } },
    $request: {url: options.url || requestURL},
    $response: {status: options.status || 200, headers: {'Content-Type': 'application/json', 'Content-Length': '9', 'Content-Encoding': 'gzip', ETag: 'stale'}, body: options.body === undefined ? fixture('json3') : options.body},
    $argument: options.args === undefined ? {enabled: true, max_calls: 4, concurrency: 2} : options.args,
    $done: r => results.push(plain(r)),
    $persistentStore: {read: k => store[k], write: (v, k) => { if (options.storageFails) return false; if (v == null) delete store[k]; else store[k] = v; return true; }},
    $httpClient: {post: (opt, cb) => { calls.push({options: plain(opt), cb}); if (options.throwHTTP) throw new Error('network PRIVATE_SENTINEL'); }},
    console: {log: message => logs.push(message)},
    setTimeout: (fn, delay) => { timers.set(++serial, {fn, at: now + delay}); return serial; }, clearTimeout: id => timers.delete(id)
  };
  if (options.noClearTimeout) delete ctx.clearTimeout;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'dist', `yt-${mode}.js`), 'utf8'), ctx, {timeout: 1000});
  return {store, results, calls, logs, timers, epoch, advance, elapse(ms) { now += ms; }, now: () => now, respond(index = 0, customize) {
    const call = calls[index], input = JSON.parse(JSON.parse(call.options.body).messages[1].content).subtitles;
    let outer = {choices: [{finish_reason: 'stop', message: {content: JSON.stringify({translations: input.map(c => ({id: c.id, text: '译文 ' + c.id}))})}}]};
    if (customize) outer = customize(outer, input);
    call.cb(null, {status: 200}, typeof outer === 'string' ? outer : JSON.stringify(outer));
  }, deadline() { advance(22000); }};
}

for (const format of ['json3', 'srv3', 'srv1', 'vtt']) {
  test(`${format}: merges original and translation into same cue`, () => {
    const d = C.parse(fixture(format));
    assert.equal(d.format, format); assert.equal(d.cues.length, 2);
    assert.equal(d.cues[0].text, 'Hello world & friends.');
    const output = d.render({0: '你好 <世界> & 朋友', 1: '欢迎'}), parsed = C.parse(output);
    assert.equal(parsed.cues[0].text, '你好 <世界> & 朋友\nHello world & friends.');
    assert.equal(parsed.cues[1].text, '欢迎\nWelcome!');
  });
}
test('JSON3 retains event timings, window definitions and unrelated properties', () => {
  const original = JSON.parse(fixture('json3'));
  const output = JSON.parse(C.parse(fixture('json3')).render({0: '你好'}));
  assert.deepEqual(output.events[0], original.events[0]);
  assert.deepEqual(output.events[2].segs, original.events[2].segs);
  assert.equal(output.events[2].tStartMs, original.events[2].tStartMs);
  assert.equal(output.events[2].dDurationMs, original.events[2].dDurationMs);
  assert.equal(output.wpWinPositions[0].ahHorPos, 50);
  assert.equal(output.events[1].tStartMs, 1000); assert.equal(output.events[1].dDurationMs, 2500);
  assert.equal(output.events[1].wWinId, 1);
});
test('SRV3 retains pen and timing attributes while updating layout', () => {
  const input = fixture('srv3'), out = C.parse(input).render({0: '测试'});
  assert.equal(input.match(/<pen\b[^>]*>/)[0], out.match(/<pen\b[^>]*>/)[0]);
  assert.ok(out.includes('<p t="1000" d="2500" wp="0"'));
});
test('VTT keeps header, note, cue identifier, settings and CRLF', () => {
  const out = C.parse(fixture('vtt').replace(/\n/g, '\r\n')).render({1: '欢迎'});
  assert.ok(out.includes('Language: en\r\n')); assert.ok(out.includes('NOTE Synthetic'));
  assert.ok(out.includes('1\r\n00:00:01.000 --> 00:00:03.500 align:start position:10%'));
  assert.ok(out.includes('欢迎\r\nWelcome!')); assert.equal(/[^\r]\n/.test(out), false);
});
test('VTT final newline does not create a detached translated block', () => {
  const out = C.parse(fixture('vtt')).render({1: '欢迎'});
  assert.ok(out.includes('欢迎\nWelcome!')); assert.equal(C.parse(out).cues.length, 2);
});
for (const [name, body] of [
  ['invalid JSON', '{oops'], ['HTML error', '<html>error</html>'], ['binary', new Uint8Array([1,2])],
  ['empty body', ''], ['body limit', 'x'.repeat(4000001)], ['protobuf-like', '\u0000\u0001abc'],
  ['rolling JSON', JSON.stringify({events: [{aAppend: 1}]})],
  ['rolling XML', '<timedtext format="3"><body><p a="1" t="0" d="2">a</p></body></timedtext>'],
  ['DTD', '<!DOCTYPE x><transcript></transcript>'],
  ['mismatched XML', '<transcript><text start="0" dur="1">x</text></wrong>'],
  ['unsupported XML inline', '<transcript><text start="0" dur="1"><i>x</i></text></transcript>'],
  ['bad entity', '<transcript><text start="0" dur="1">&fake;</text></transcript>'],
  ['invalid uppercase XML entity', '<transcript><text start="0" dur="1">&AMP;</text></transcript>'],
  ['bad timing', 'WEBVTT\n\n00:00:06.000 --> 00:00:05.000\nx'],
  ['invalid JSON3 timing', JSON.stringify({events: [{tStartMs: -1, dDurationMs: 3, segs: [{utf8: 'x'}]}]})]
]) test(`${name}: original response passes through without API`, () => {
  const h = harness('translate', {body}); assert.deepEqual(h.results, [{}]); assert.equal(h.calls.length, 0);
});
test('URL allowlist rejects lookalike and unrelated endpoints', () => {
  for (const url of ['https://www.youtube.com.evil.invalid/api/timedtext', 'https://www.youtube.com/api/timedtextother', 'https://youtubei.googleapis.com/youtubei/v1/player', 'http://www.youtube.com/api/timedtext']) {
    assert.equal(C.URL_RE.test(url), false); assert.equal(harness('translate', {url}).calls.length, 0);
  }
  assert.equal(C.URL_RE.test('https://video.google.com/api/timedtext?x=1'), true);
});
test('non-200 responses pass through untouched', () => { assert.deepEqual(harness('translate', {status: 403}).results, [{}]); });
test('translation disabled by default with no local settings', () => { assert.equal(harness('translate', {args: null}).calls.length, 0); });
test('missing local key causes zero requests', () => {
  const h = harness('translate', {store: {'ytloon.deepseek.key': ''}}); assert.equal(h.calls.length, 0); assert.deepEqual(h.results, [{}]);
});
test('valid API result is merged; key and signed URL never appear in logs/cache/payload', () => {
  const h = harness(); assert.equal(h.calls.length, 1);
  const opt = h.calls[0].options, payload = JSON.parse(opt.body);
  assert.equal(opt.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(opt.insecure, false); assert.equal(opt['auto-redirect'], false); assert.equal(opt['auto-cookie'], false);
  assert.equal(payload.response_format.type, 'json_object'); assert.equal(payload.thinking.type, 'disabled');
  assert.equal(payload.stream, false); assert.equal(opt.timeout, 12000);
  h.respond(); assert.equal(h.results.length, 1); assert.ok(h.results[0].body.includes('译文'));
  assert.ok(h.store['ytloon.cache.v1']);
  for (const text of [h.logs.join(' '), h.store['ytloon.cache.v1'], opt.body]) {
    assert.equal(text.includes('TEST_ONLY_NOT_A_REAL_CREDENTIAL'), false); assert.equal(text.includes('PRIVATE_SENTINEL'), false);
  }
});
test('cached replay requires zero HTTP requests even after key is removed', () => {
  const a = harness(); a.respond();
  const b = harness('translate', {store: Object.assign({}, a.store, {'ytloon.deepseek.key': ''})});
  assert.equal(b.calls.length, 0); assert.ok(b.results[0].body.includes('译文'));
});
test('expired cache, model, target and source changes each miss cache', () => {
  const a = harness(); a.respond();
  const expired = JSON.parse(a.store['ytloon.cache.v1']).map(r => ({...r, expires: 1}));
  assert.equal(harness('translate', {store: {...a.store, 'ytloon.cache.v1': JSON.stringify(expired)}}).calls.length, 1);
  for (const args of [{enabled:true, model:'different-model'}, {enabled:true, target:'ja'}]) assert.equal(harness('translate', {store:a.store, args}).calls.length, 1);
  assert.equal(harness('translate', {store:a.store, url:requestURL.replace('lang=en', 'lang=ja')}).calls.length, 1);
});
test('cache corruption recovers; storage failure still returns valid translated subtitles', () => {
  const h = harness('translate', {store:{'ytloon.cache.v1':'broken'}, storageFails:true}); h.respond();
  assert.ok(h.results[0].body.includes('译文')); assert.ok(h.logs.some(x => x.includes('cache_write_failed')));
});
for (const status of [401,403,429,400,402,422,302]) test(`HTTP ${status} falls back without retry and starts classified cooldown`, () => {
  const h = harness(); h.calls[0].cb(null, {status}, 'PRIVATE_SERVER_BODY');
  assert.deepEqual(h.results, [{}]); assert.ok(Number(h.store['ytloon.cooldown.v1']) > Date.now());
  assert.equal(harness('translate', {store:h.store}).calls.length, 0);
  assert.equal(h.logs.join(' ').includes('PRIVATE_SERVER_BODY'), false);
  assert.equal(Number(h.store['ytloon.cooldown.v1']) - h.now(), [401,403].includes(status) ? 300000 : 60000);
  h.advance(1000); assert.equal(h.calls.length, 1);
});
test('network error and synchronous HTTP throw each finish once', () => {
  const h = harness(); h.calls[0].cb('PRIVATE_SENTINEL', null, null); assert.deepEqual(h.results,[{}]);
  const b = harness('translate', {throwHTTP:true}); assert.deepEqual(b.results,[{}]);
  assert.equal(h.logs.join(' ').includes('PRIVATE_SENTINEL'), false);
});
for (const [name, transform] of [
  ['invalid outer JSON', () => 'not json'],
  ['truncated finish reason', x => { x.choices[0].finish_reason = 'length'; return x; }],
  ['empty result', x => { x.choices[0].message.content = ''; return x; }],
  ['missing id', (x,input) => { x.choices[0].message.content = JSON.stringify({translations:input.slice(1).map(c=>({id:c.id,text:'one'}))}); return x; }],
  ['duplicate id', x => { x.choices[0].message.content = '{"translations":[{"id":0,"text":"one"},{"id":0,"text":"two"}]}'; return x; }],
  ['unknown id', x => { x.choices[0].message.content = '{"translations":[{"id":0,"text":"one"},{"id":9,"text":"two"}]}'; return x; }]
]) test(`${name}: rejects whole batch, no bad cache`, () => {
  const h = harness(); h.respond(0, transform);
  for (let i=1; i<h.calls.length; i++) h.respond(i,transform);
  assert.deepEqual(h.results,[{}]); assert.equal(h.store['ytloon.cache.v1'],undefined);
  assert.equal(h.store['ytloon.cooldown.v1'], undefined); assert.ok(h.calls.length <= 3);
  assert.equal(harness('translate', {store:h.store}).calls.length, 1);
});
test('global deadline ignores late and duplicate callbacks; done exactly once', () => {
  const h = harness(); h.deadline(); h.respond(); h.respond(); assert.deepEqual(h.results,[{}]); assert.equal(h.store['ytloon.cache.v1'],undefined);
});
test('identical source cue is translated once then mapped to all IDs', () => {
  const body = JSON.stringify({events:[0,1].map(i=>({tStartMs:i*1000,dDurationMs:900,segs:[{utf8:'same'}]}))});
  const h = harness('translate',{body});
  assert.equal(JSON.parse(JSON.parse(h.calls[0].options.body).messages[1].content).subtitles.length,1);
  h.respond(); assert.equal((h.results[0].body.match(/译文/g)||[]).length,2);
});
test('bounded requests: max two active and four total, remainder stays original', () => {
  const body = JSON.stringify({events:Array.from({length:150},(_,i)=>({tStartMs:i*1000,dDurationMs:900,segs:[{utf8:`cue ${i}`}]}))});
  const h = harness('translate',{body}); assert.equal(h.calls.length,2);
  h.respond(0); assert.equal(h.calls.length,3); h.respond(1); assert.equal(h.calls.length,4);
  h.respond(2); h.respond(3); assert.equal(h.results.length,1); assert.equal(h.calls.length,4);
  const events=JSON.parse(h.results[0].body).events;
  assert.equal(events.filter(e=>e.segs[0].utf8.includes('译文')).length,96);
  assert.equal(events[149].segs[0].utf8,'cue 149');
});
test('partial success survives a second batch failure', () => {
  const body = JSON.stringify({events:Array.from({length:30},(_,i)=>({tStartMs:i*1000,dDurationMs:900,segs:[{utf8:`cue ${i}`}]}))});
  const h = harness('translate',{body}); h.respond(0); h.calls[1].cb(null,{status:429},'');
  assert.ok(h.results[0].body.includes('译文')); assert.equal(JSON.parse(h.results[0].body).events[29].segs[0].utf8,'cue 29');
});
test('header adjustment removes stale metadata and preserves Content-Type', () => {
  assert.deepEqual(C.headers({'content-length':'1','CONTENT-ENCODING':'gzip',ETag:'x','Content-Type':'text/vtt','Cache-Control':'public',Server:'test'}),{'Content-Type':'text/vtt',Server:'test','Cache-Control':'no-store'});
});
test('UTF8 cache size counts Chinese and emoji correctly', () => { assert.equal(C.utf8size('a中😀'),Buffer.byteLength('a中😀')); });
test('cache capacity is bounded by both bytes and record count', () => {
  const records = Array.from({length:500},(_,i)=>({k:'old'+i,v:'中'.repeat(800),expires:Date.now()+100000}));
  const h = harness('translate',{store:{'ytloon.cache.v1':JSON.stringify(records)}}); h.respond();
  const saved=h.store['ytloon.cache.v1']; assert.ok(Buffer.byteLength(saved)<=4194304); assert.ok(JSON.parse(saved).length<=6000);
});
test('cache merges fresh concurrent entries at completion', () => {
  const h=harness(); h.store['ytloon.cache.v1']=JSON.stringify([{k:'parallel',v:'其他',expires:Date.now()+10000}]);
  h.respond(); assert.ok(JSON.parse(h.store['ytloon.cache.v1']).some(r=>r.k==='parallel'));
});
test('API reordered IDs map to correct cues', () => {
  const h=harness(); h.respond(0,(x)=>{const content=JSON.parse(x.choices[0].message.content); content.translations.reverse(); x.choices[0].message.content=JSON.stringify(content); return x;});
  assert.ok(JSON.parse(h.results[0].body).events[1].segs[0].utf8.startsWith('译文 0\n'));
});
test('API translations are escaped for XML and VTT', () => {
  for (const format of ['srv3','srv1','vtt']) {
    const h=harness('translate',{body:fixture(format)});
    h.respond(0,(x,input)=>{x.choices[0].message.content=JSON.stringify({translations:input.map(c=>({id:c.id,text:'<script> & 文'}))});return x;});
    assert.ok(h.results[0].body.includes('&lt;script&gt; &amp; 文')); assert.equal(h.results[0].body.includes('<script>'),false);
  }
});
test('new config overrides local defaults and legacy query string is parsed', () => {
  const h=harness('translate',{args:'enabled=true&target=ja&model=deepseek-flash'});
  assert.ok(JSON.parse(h.calls[0].options.body).messages[0].content.includes('into ja'));
  assert.equal(harness('translate',{args:{enabled:false},store:{'ytloon.settings.v1':'{"enabled":true}'}}).calls.length,0);
});
test('overlong cues stay original without an API request', () => {
  const body=JSON.stringify({events:[{tStartMs:0,dDurationMs:1000,segs:[{utf8:'a'.repeat(801)}]}]});
  const h=harness('translate',{body}); assert.equal(h.calls.length,0); assert.deepEqual(h.results,[{}]);
});
test('JSON3 centers left/right windows and preserves vertical placement, rows and styles', () => {
  const input=JSON.parse(fixture('json3'));
  input.wpWinPositions=[{apPoint:6,ahHorPos:20,avVerPos:90,rcRows:3},{apPoint:2,ahHorPos:80,avVerPos:8}];
  input.wsWinStyles=[{juJustifCode:0,mhModeHint:1},{juJustifCode:1,sdScrollDir:3}];
  input.events[1].wpWinPosId=1; input.events[1].wsWinStyleId=1;
  const out=JSON.parse(C.parse(JSON.stringify(input)).render({0:'中文'}));
  assert.deepEqual(out.wpWinPositions,[{apPoint:7,ahHorPos:50,avVerPos:90,rcRows:3},{apPoint:1,ahHorPos:50,avVerPos:8}]);
  assert.equal(out.wsWinStyles[0].juJustifCode,2); assert.equal(out.wsWinStyles[1].juJustifCode,2);
  assert.equal(out.wsWinStyles[0].mhModeHint,1); assert.equal(out.wsWinStyles[1].sdScrollDir,3);
  assert.equal(out.events[1].wpWinPosId,1); assert.equal(out.events[1].wsWinStyleId,1);
  assert.equal(out.events[1].segs[0].utf8,'中文\nHello world & friends.');
});
test('JSON3 missing layout arrays receive referenced centered defaults', () => {
  const input={events:[{tStartMs:10,dDurationMs:2000,segs:[{utf8:'Original'}]}]};
  const out=JSON.parse(C.parse(JSON.stringify(input)).render({0:'中文'}));
  const e=out.events[0], p=out.wpWinPositions[e.wpWinPosId], s=out.wsWinStyles[e.wsWinStyleId];
  assert.equal(p.apPoint,7); assert.equal(p.ahHorPos,50); assert.equal(s.juJustifCode,2);
  assert.equal(e.tStartMs,10); assert.equal(e.dDurationMs,2000);
});
test('JSON3 cues inherit the correct parent window instead of moving to default window', () => {
  const input={wpWinPositions:[{apPoint:6,avVerPos:95},{apPoint:2,avVerPos:5}],wsWinStyles:[{},{juJustifCode:1}],events:[
    {id:8,tStartMs:0,wpWinPosId:1,wsWinStyleId:1},
    {wWinId:8,tStartMs:100,dDurationMs:1000,segs:[{utf8:'Original'}]}
  ]};
  const out=JSON.parse(C.parse(JSON.stringify(input)).render({0:'中文'}));
  assert.equal(out.events[1].wpWinPosId,1); assert.equal(out.events[1].wsWinStyleId,1);
  assert.equal(out.wpWinPositions[1].avVerPos,5); assert.equal(out.wpWinPositions[1].apPoint,1);
});
test('SRV3 centers existing layouts and supplies referenced defaults without ID collisions', () => {
  const body='<timedtext format="3"><head><wp id="0" ap="6" ah="20" av="90"/><ws id="0" ju="0" pd="0"/></head><body><p t="100" d="2000" wp="0" ws="0">Original</p><p t="3000" d="1000">Other</p></body></timedtext>';
  const out=C.parse(body).render({0:'中文'});
  assert.equal(C.parse(out).cues[0].text,'中文\nOriginal');
  const existingPos=out.match(/<wp id="0"[^>]*>/)[0], existingStyle=out.match(/<ws id="0"[^>]*>/)[0];
  assert.ok(existingPos.includes('ap="7"')); assert.ok(existingPos.includes('ah="50"')); assert.ok(existingPos.includes('av="90"'));
  assert.ok(existingStyle.includes('ju="2"')); assert.ok(existingStyle.includes('pd="0"'));
  assert.ok(out.includes('<p t="3000" d="1000" wp="1" ws="1">Other</p>'));
  assert.equal((out.match(/<wp id="0"/g)||[]).length,1);
});
test('SRV3 absent or self-closing head is expanded into a valid centered document', () => {
  for (const head of ['','<head/>','<head></head>']) {
    const out=C.parse('<timedtext format="3">'+head+'<body><p t="0" d="1000">Original</p></body></timedtext>').render({0:'中文'});
    assert.equal(C.parse(out).cues.length,1); assert.ok(out.includes('ju="2"')); assert.ok(out.includes('ah="50"'));
    assert.equal((out.match(/<head>/g)||[]).length,1);
  }
});
test('VTT translated cue centers and removes conflicting region while preserving timestamps and markup', () => {
  const input='WEBVTT\n\nlabel\n00:00:01.000 --> 00:00:02.000 align:start position:10% size:30% region:left line:90%\n<c.yellow>Original</c>\n';
  const out=C.parse(input).render({0:'中文'});
  assert.ok(out.includes('label\n00:00:01.000 --> 00:00:02.000 line:90% align:center position:50%,center size:100%'));
  assert.ok(out.includes('\n中文\n<c.yellow>Original</c>'));
  assert.equal(out.includes('region:left'),false); assert.equal(out.includes('align:start'),false);
});
test('empty translation map keeps every original format byte-for-byte', () => {
  for (const f of ['json3','srv3','srv1','vtt']) assert.equal(C.parse(fixture(f)).render({}),fixture(f));
});
test('Loon runtime without clearTimeout still returns once and ignores its late timer', () => {
  const h=harness('translate',{noClearTimeout:true}); h.respond(); h.deadline();
  assert.equal(h.results.length,1); assert.ok(h.results[0].body.includes('译文'));
});

const manyCues = (n = 100) => JSON.stringify({events:Array.from({length:n},(_,i)=>({
  tStartMs:i*1000, dDurationMs:900, segs:[{utf8:'cue '+i}]
}))});
const httpFailure = (h, i, status = 503, headers = {}) => h.calls[i].cb(null, {status, headers}, 'PRIVATE_SERVER_BODY');

for (const status of [500,502,503,504]) test('HTTP '+status+' retries once after backoff then caches success', () => {
  const h = harness();
  httpFailure(h,0,status); assert.equal(h.results.length,0); assert.equal(h.store['ytloon.cooldown.v1'],undefined);
  h.advance(749); assert.equal(h.calls.length,1);
  h.advance(1); assert.equal(h.calls.length,2); assert.equal(h.calls[0].options.body,h.calls[1].options.body);
  h.respond(1); assert.ok(h.results[0].body.includes('译文')); assert.ok(h.store['ytloon.cache.v1']);
  assert.ok(h.logs.some(x=>x.includes('api_error=HTTP_SERVER status='+status) && x.includes('retry_in_ms=750')));
  assert.equal(h.store['ytloon.cooldown.v1'],undefined);
});

for (const error of ['ETIMEDOUT PRIVATE_SENTINEL', {code:-1001, message:'PRIVATE_SENTINEL'},
  'The network connection was lost.', {code:'ECONNRESET',message:'PRIVATE_SENTINEL'}, 'EAI_AGAIN']) {
  test('temporary network error gets bounded retry: '+(typeof error==='string'?error.split(' ')[0]:error.code), () => {
    const h=harness(); h.calls[0].cb(error,null,null); h.advance(750);
    assert.equal(h.calls.length,2); h.respond(1); assert.equal(h.results.length,1);
    assert.equal(h.logs.join(' ').includes('PRIVATE_SENTINEL'),false);
  });
}

test('exhausted transient retry writes only 10s cooldown and blocks subsequent responses', () => {
  const h=harness(); httpFailure(h,0); h.advance(750); httpFailure(h,1);
  assert.deepEqual(h.results,[{}]); assert.equal(Number(h.store['ytloon.cooldown.v1'])-h.now(),10000);
  assert.equal(harness('translate',{store:h.store}).calls.length,0);
  h.deadline(); h.respond(1); assert.equal(h.calls.length,2); assert.equal(h.results.length,1);
});

test('unknown network error and TLS errors do not blindly retry', () => {
  for (const error of ['PRIVATE_SENTINEL', {code:'CERT_HAS_EXPIRED',message:'PRIVATE_SENTINEL'}]) {
    const h=harness(); h.calls[0].cb(error,null,null); h.advance(750);
    assert.deepEqual(h.results,[{}]); assert.equal(h.calls.length,1);
    assert.ok(h.logs.some(x=>x.includes('api_error=NETWORK status=0')));
    assert.equal(Number(h.store['ytloon.cooldown.v1'])-h.epoch,10000);
  }
});

test('HTTP auth/rate-limit status wins over a simultaneous network error', () => {
  for (const status of [401,403,429]) {
    const h=harness(); h.calls[0].cb('ETIMEDOUT PRIVATE_SENTINEL',{status},'PRIVATE_SERVER_BODY');
    assert.deepEqual(h.results,[{}]); assert.equal(h.calls.length,1);
    assert.ok(h.logs[0].includes('status='+status));
  }
});

test('Retry-After supports case-insensitive seconds/date, defaults and bounded cooldown', () => {
  for (const [value,expected] of [['120',120000],['99999999',300000],['0',60000],['PRIVATE_SENTINEL',60000]]) {
    const h=harness(); httpFailure(h,0,429,{'rEtRy-AfTeR':value});
    assert.equal(Number(h.store['ytloon.cooldown.v1'])-h.now(),expected);
    assert.equal(h.logs.join(' ').includes('PRIVATE_SENTINEL'),false);
  }
  const h=harness(), date=new Date(h.now()+180000).toUTCString();
  httpFailure(h,0,429,{'Retry-After':date});
  assert.equal(Number(h.store['ytloon.cooldown.v1']),Date.parse(date));
});

test('parallel transient failure and success cannot shorten or clear auth cooldown', () => {
  const h=harness('translate',{body:manyCues()});
  httpFailure(h,0,401); const until=h.store['ytloon.cooldown.v1'];
  httpFailure(h,1,503); assert.equal(h.store['ytloon.cooldown.v1'],until);
  assert.equal(h.calls.length,2); assert.deepEqual(h.results,[{}]);
  const b=harness('translate',{body:manyCues(30)});
  httpFailure(b,0,403); b.respond(1);
  assert.ok(b.results[0].body.includes('译文')); assert.ok(b.store['ytloon.cooldown.v1']);
});

test('pending retry is suppressed by another batch auth failure, even without clearTimeout', () => {
  const h=harness('translate',{body:manyCues(),noClearTimeout:true});
  httpFailure(h,0); httpFailure(h,1,401); const until=h.store['ytloon.cooldown.v1'];
  h.advance(750); assert.equal(h.calls.length,2); assert.deepEqual(h.results,[{}]);
  assert.equal(h.store['ytloon.cooldown.v1'],until); h.deadline(); assert.equal(h.results.length,1);
});

test('retry rechecks cooldown written by another script execution', () => {
  const h=harness(); httpFailure(h,0);
  const until=String(h.now()+300000); h.store['ytloon.cooldown.v1']=until;
  h.advance(750); assert.equal(h.calls.length,1); assert.deepEqual(h.results,[{}]);
  assert.equal(h.store['ytloon.cooldown.v1'],until);
});

test('two simultaneous retries reserve slots: at most two active and four HTTP calls total', () => {
  const h=harness('translate',{body:manyCues()});
  httpFailure(h,0); httpFailure(h,1); h.advance(750);
  assert.equal(h.calls.length,4); h.respond(2); h.respond(3);
  assert.equal(h.calls.length,4); assert.equal(h.results.length,1);
  assert.equal(JSON.parse(h.results[0].body).events.filter(e=>e.segs[0].utf8.includes('译文')).length,48);
});

test('request cap prevents retry after all four calls have been spent', () => {
  const h=harness('translate',{body:manyCues()});
  h.respond(0); h.respond(1); httpFailure(h,2); h.respond(3);
  h.advance(750); assert.equal(h.calls.length,4); assert.equal(h.results.length,1);
  assert.equal(Number(h.store['ytloon.cooldown.v1'])-h.epoch,10000);
});

test('JSON validation failure continues queued batches without global cooldown', () => {
  const h=harness('translate',{body:manyCues()});
  h.respond(0,()=>'{PRIVATE_SENTINEL'); assert.equal(h.calls.length,3);
  h.respond(1); h.respond(2); h.respond(3);
  assert.equal(h.calls.length,4); assert.equal(h.store['ytloon.cooldown.v1'],undefined);
  const events=JSON.parse(h.results[0].body).events;
  assert.equal(events[0].segs[0].utf8,'cue 0'); assert.ok(events[24].segs[0].utf8.includes('译文'));
  assert.ok(h.logs.some(x=>x.includes('result=API_FALLBACK')));
});

for (const [code, transform] of [
  ['API_JSON_OUTER',()=>'{PRIVATE_SENTINEL'],
  ['API_SCHEMA',()=>null],
  ['API_SCHEMA',()=>({choices:[]})],
  ['API_SCHEMA',x=>{x.choices[0].message.content='null';return x;}],
  ['API_JSON_INNER',x=>{x.choices[0].message.content='{PRIVATE_SENTINEL';return x;}],
  ['API_FINISH_LENGTH',x=>{x.choices[0].finish_reason='length';return x;}],
  ['API_FINISH_FILTER',x=>{x.choices[0].finish_reason='content_filter';return x;}],
  ['API_FINISH_OTHER',x=>{x.choices[0].finish_reason='PRIVATE_SENTINEL';return x;}],
  ['API_BODY_LIMIT',()=> 'x'.repeat(100001)]
]) test('safe actionable validator classification: '+code, () => {
  const h=harness(); h.respond(0,transform);
  for (let i=1; i<h.calls.length; i++) h.respond(i,transform);
  assert.ok(h.logs.some(x=>x.includes('api_error='+code+' status=200')));
  assert.equal(h.logs.join(' ').includes('PRIVATE_SENTINEL'),false);
  assert.equal(h.store['ytloon.cache.v1'],undefined); assert.equal(h.store['ytloon.cooldown.v1'],undefined);
  assert.deepEqual(h.results,[{}]); assert.ok(h.calls.length<=3);
});

test('timeout retry fits remaining time, with 500ms margin inside the 22s deadline', () => {
  const h=harness(); h.advance(12000); h.calls[0].cb('timeout',null,null);
  h.advance(750); assert.equal(h.calls.length,2); assert.equal(h.calls[1].options.timeout,8750);
  h.advance(8000); h.respond(1); assert.ok(h.results[0].body.includes('译文'));
  assert.ok(h.now()-h.epoch < 22000);
});

test('insufficient time skips retry and new batches without discarding active success', () => {
  const h=harness(); h.advance(18000); httpFailure(h,0);
  assert.equal(h.calls.length,1); assert.deepEqual(h.results,[{}]);
  const b=harness('translate',{body:manyCues()});
  b.advance(18000); b.respond(0); assert.equal(b.results.length,0); assert.equal(b.calls.length,2);
  b.respond(1); assert.equal(b.results.length,1); assert.ok(b.results[0].body.includes('译文'));
});

test('late timer scheduling cannot start a retry with too little time', () => {
  const h=harness(); httpFailure(h,0);
  const retry=[...h.timers.values()].find(t=>t.at-h.epoch===750);
  h.elapse(18000); retry.fn();
  assert.equal(h.calls.length,1); assert.deepEqual(h.results,[{}]);
});

test('missing HTTP callback returns partial success at 22s, ignores late/duplicate callback', () => {
  const h=harness('translate',{body:manyCues(30),noClearTimeout:true});
  h.respond(0); h.advance(21999); assert.equal(h.results.length,0);
  h.advance(1); assert.ok(h.results[0].body.includes('译文'));
  const saved=h.store['ytloon.cache.v1']; h.respond(1); h.respond(0);
  assert.equal(h.store['ytloon.cache.v1'],saved); assert.equal(h.results.length,1);
  assert.ok(h.logs.some(x=>x.includes('result=DEADLINE')));
});

test('callback after absolute deadline is ignored even before timer has fired', () => {
  const h=harness(); h.elapse(22000); h.respond();
  assert.deepEqual(h.results,[{}]); assert.equal(h.store['ytloon.cache.v1'],undefined);
});

test('success in the final processing margin is preserved before the absolute deadline', () => {
  const h=harness(); h.elapse(21600); h.respond();
  assert.ok(h.results[0].body.includes('译文')); assert.equal(h.results.length,1);
});

test('duplicate callbacks during backoff cannot schedule another retry or mutate cache', () => {
  const h=harness(); httpFailure(h,0); httpFailure(h,0); h.respond(0);
  h.advance(750); assert.equal(h.calls.length,2); h.respond(1);
  assert.equal(h.results.length,1); assert.ok(h.results[0].body.includes('译文'));
});

test('diagnostics never include key, Authorization, subtitle text, signed URL or response body', () => {
  const body=JSON.stringify({events:[{tStartMs:0,dDurationMs:1000,segs:[{utf8:'PRIVATE_SUBTITLE'}]}]});
  const h=harness('translate',{body});
  h.calls[0].cb({code:'ETIMEDOUT',message:'Authorization Bearer TEST_ONLY_NOT_A_REAL_CREDENTIAL PRIVATE_SUBTITLE PRIVATE_SENTINEL'},null,null);
  h.advance(750); httpFailure(h,1,503);
  const logs=h.logs.join(' ');
  for (const secret of ['Authorization','TEST_ONLY_NOT_A_REAL_CREDENTIAL','PRIVATE_SUBTITLE','PRIVATE_SENTINEL','PRIVATE_SERVER_BODY']) assert.equal(logs.includes(secret),false);
});

const innerFailure = x => { x.choices[0].message.content='{PRIVATE_SENTINEL'; return x; };
const inputOf = call => JSON.parse(JSON.parse(call.options.body).messages[1].content).subtitles;
for (const [code,change] of [
  ['API_JSON_INNER',innerFailure],
  ['API_SCHEMA',x=>{x.choices[0].message.content='{"translations":[]}';return x;}],
  ['API_FINISH_LENGTH',x=>{x.choices[0].finish_reason='length';return x;}]
]) test(code+' splits once and caches validated child replies',()=>{
  const h=harness('translate',{body:manyCues(24)});
  h.respond(0,change); assert.equal(h.calls.length,3);
  assert.equal(inputOf(h.calls[1]).length,12); assert.equal(inputOf(h.calls[2]).length,12);
  assert.deepEqual(inputOf(h.calls[1]).concat(inputOf(h.calls[2])),inputOf(h.calls[0]));
  assert.equal(h.store['ytloon.cache.v1'],undefined);
  h.respond(1); h.respond(2);
  assert.equal(JSON.parse(h.store['ytloon.cache.v1']).length,24);
  assert.ok(h.logs.some(s=>s.includes('action=split')&&s.includes('cues=24')));
  assert.equal(h.results.length,1);
});
test('failed child cannot split again; valid sibling survives',()=>{
  const h=harness(); h.respond(0,innerFailure); h.respond(1,innerFailure); h.respond(2);
  assert.equal(h.calls.length,3); assert.equal(h.results.length,1);
  assert.equal(JSON.parse(h.store['ytloon.cache.v1']).length,1);
  assert.deepEqual(JSON.parse(h.results[0].body).events[1].segs,JSON.parse(fixture('json3')).events[1].segs);
});
test('single cue retries validation once after backoff',()=>{
  const h=harness('translate',{body:manyCues(1)}); h.respond(0,innerFailure);
  h.advance(749); assert.equal(h.calls.length,1); h.advance(1); h.respond(1);
  assert.equal(h.calls.length,2); assert.ok(h.results[0].body.includes('译文'));
  const b=harness('translate',{body:manyCues(1)}); b.respond(0,innerFailure); b.advance(750); b.respond(1,innerFailure);
  assert.deepEqual(b.results,[{}]); assert.equal(b.calls.length,2);
});
test('parallel malformed batches and late recovery respect budget/deadline',()=>{
  const h=harness('translate',{body:manyCues(100)});
  h.respond(0,innerFailure); h.respond(1,innerFailure);
  assert.equal(h.calls.length,4); h.respond(2); h.respond(3);
  assert.equal(h.calls.length,4); assert.equal(h.results.length,1);
  const b=harness(); b.elapse(18000); b.respond(0,innerFailure);
  assert.equal(b.calls.length,1); assert.deepEqual(b.results,[{}]);
});
test('auth during split stops queued child',()=>{
  const h=harness('translate',{body:manyCues(100)}); h.respond(0,innerFailure);
  httpFailure(h,1,401); h.respond(2); assert.equal(h.calls.length,3);
  assert.equal(h.results.length,1); assert.ok(h.results[0].body.includes('译文'));
});
test('repeat request advances past the first 96 cached cues',()=>{
  const h=harness('translate',{body:manyCues(150)}); for(let i=0;i<h.calls.length;i++) h.respond(i);
  const b=harness('translate',{body:manyCues(150),store:h.store});
  assert.equal(inputOf(b.calls[0])[0].id,96);
  for(let i=0;i<b.calls.length;i++) b.respond(i);
  assert.ok(JSON.parse(b.results[0].body).events[149].segs[0].utf8.includes('译文'));
});
test('remote subscriptions use configured branch and bundles match source',()=>{
  const config=require('../subscription.json');
  for(const mode of ['translate']) {
    const script=fs.readFileSync(path.join(root,'dist','yt-'+mode+'.js'),'utf8');
    assert.ok(script.endsWith(fs.readFileSync(path.join(root,'src/'+mode+'.js'),'utf8')));
    assert.ok(script.includes(fs.readFileSync(path.join(root,'src/core.js'),'utf8')));
    for(const legacy of ['']) {
      const plugin=fs.readFileSync(path.join(root,'plugins','YouTube-'+mode+legacy+'.plugin'),'utf8');
      assert.ok(plugin.includes('https://raw.githubusercontent.com/'+config.repository+'/'+config.ref+'/dist/yt-'+mode+'.js'));
    }
  }
});

function completeWaves(h, delay=8000) {
  let next=0, maxActive=0;
  while(!h.results.length) {
    const end=h.calls.length; maxActive=Math.max(maxActive,end-next);
    if(end===next) {h.advance(delay);continue;}
    h.advance(delay);
    for(;next<end;next++) h.respond(next);
  }
  return maxActive;
}
test('default full-track mode translates 2400 cues with fast replies, including final cue',()=>{
  const h=harness('translate',{body:manyCues(2400),args:{enabled:true}});
  assert.equal(h.calls.length,8);
  for(let i=0;i<h.calls.length;i++) h.respond(i);
  assert.equal(h.calls.length,100); assert.equal(h.results.length,1);
  assert.ok(JSON.parse(h.results[0].body).events[2399].segs[0].utf8.includes('译文'));
  assert.equal(JSON.parse(h.store['ytloon.cache.v1']).length,2400);
  assert.ok(h.logs.some(s=>s.includes('result=COMPLETE ')));
});
test('slow long track resumes in manual prewarm and subsequent response is fully cached',()=>{
  const body=manyCues(2400), h=harness('translate',{body,args:{enabled:true}});
  assert.equal(completeWaves(h),8);
  assert.ok(h.logs.some(s=>s.includes('result=DEADLINE')));
  assert.ok(JSON.parse(h.store['ytloon.cache.v1']).length<2400);
  const snapshot=h.store['ytloon.pending.v1'];
  assert.equal(snapshot.includes('PRIVATE_SENTINEL'),false);
  assert.equal(snapshot.includes('TEST_ONLY_NOT_A_REAL_CREDENTIAL'),false);
  const worker=harness('prewarm',{store:h.store});
  assert.equal(completeWaves(worker),8); assert.deepEqual(worker.results,[{}]);
  assert.equal(JSON.parse(worker.store['ytloon.cache.v1']).length,2400);
  const replay=harness('translate',{body,store:worker.store,args:{enabled:true}});
  assert.equal(replay.calls.length,0);
  assert.equal(JSON.parse(replay.results[0].body).events.filter(e=>e.segs[0].utf8.includes('译文')).length,2400);
});
test('prewarm missing/expired job never calls API; checkpoint survives unfinished run',()=>{
  assert.equal(harness('prewarm').calls.length,0);
  assert.equal(harness('prewarm',{store:{'ytloon.pending.v1':JSON.stringify({expires:0})}}).calls.length,0);
  const h=harness('translate',{body:manyCues(600),args:{enabled:true}}); h.deadline();
  const w=harness('prewarm',{store:h.store});
  for(let i=0;i<4;i++) w.respond(i);
  assert.equal(JSON.parse(w.store['ytloon.cache.v1']).length,96);
  w.advance(270000); assert.equal(w.results.length,1);
  const resumed=harness('prewarm',{store:w.store});
  assert.equal(inputOf(resumed.calls[0])[0].id,96);
  resumed.advance(270000);
});
test('manual prewarm ignores stale manual start and keeps strict failure fallback',()=>{
  const h=harness('translate',{body:manyCues(150),args:{enabled:true,start_seconds:100}}); h.deadline();
  const w=harness('prewarm',{store:h.store}); assert.equal(inputOf(w.calls[0])[0].id,0);
  httpFailure(w,0,401); for(let i=1;i<w.calls.length;i++) w.respond(i);
  assert.equal(w.results.length,1); assert.ok(w.store['ytloon.cooldown.v1']);
});
test('prewarm subscription points to worker and gives it a 300s runtime',()=>{
  const plugin=fs.readFileSync(path.join(root,'plugins/YouTube-prewarm.plugin'),'utf8');
  assert.ok(plugin.includes('generic then script'));assert.ok(plugin.includes('timeout=300'));
  assert.ok(plugin.includes(require('../subscription.json').ref+'/dist/yt-prewarm.js'));
});

test('four-hour 14400-cue track survives prewarm and fully cached replay',()=>{
 const body=manyCues(14400), capture=harness('translate',{body,args:{enabled:true}}); capture.deadline();
 const worker=harness('prewarm',{store:capture.store});
 for(let i=0;i<worker.calls.length;i++) worker.respond(i);
 assert.equal(JSON.parse(worker.store['ytloon.cache.v1']).length,14400);
 const replay=harness('translate',{body,store:worker.store,args:{enabled:true}});
 assert.equal(replay.calls.length,0);
 assert.equal(JSON.parse(replay.results[0].body).events.filter(e=>e.segs[0].utf8.includes('译文')).length,14400);
});
test('prewarm recovers missing callback and ignores late original success',()=>{
 const h=harness('translate',{body:manyCues(48),args:{enabled:true}});h.deadline();
 const w=harness('prewarm',{store:h.store}); w.respond(1); w.advance(30750);
 assert.equal(w.calls.length,3);w.respond(2);const saved=w.store['ytloon.cache.v1'];w.respond(0);
 assert.equal(w.store['ytloon.cache.v1'],saved);assert.equal(w.results.length,1);
 assert.equal(JSON.parse(saved).length,48);
});
test('prewarm repeated transient failure does not abandon later batches',()=>{
 const h=harness('translate',{body:manyCues(240),args:{enabled:true,concurrency:1}});h.deadline();
 const w=harness('prewarm',{store:h.store});httpFailure(w,0,503);w.advance(750);httpFailure(w,1,503);
 for(let i=2;i<w.calls.length;i++) w.respond(i);
 assert.equal(w.results.length,1);assert.equal(JSON.parse(w.store['ytloon.cache.v1']).length,216);
});
test('release ignores old start offsets',()=>{const h=harness('translate',{body:manyCues(2),args:{enabled:true,start_seconds:100}});assert.equal(inputOf(h.calls[0])[0].id,0);h.respond();assert.equal(h.results.length,1);});

test('overlapping same-window bilingual cues stop at next start without shifting text IDs',()=>{
 const input={events:[{tStartMs:0,dDurationMs:5000,wWinId:1,segs:[{utf8:'Look at their gym leader.'}]},{tStartMs:2000,dDurationMs:4000,wWinId:1,segs:[{utf8:'Shirtless and ripped.'}]}]};
 const out=JSON.parse(C.parse(JSON.stringify(input)).render({0:'看看他们的道馆馆主。',1:'赤膊又健壮。'}));
 assert.equal(out.events[0].dDurationMs,2000);assert.equal(out.events[1].dDurationMs,4000);
 assert.equal(out.events[1].segs[0].utf8,'赤膊又健壮。\nShirtless and ripped.');
 assert.equal(out.events[1].tStartMs,2000);
});
test('overlap repair preserves separate windows, gaps, simultaneous starts and passthrough',()=>{
 const input={events:[{tStartMs:0,dDurationMs:5000,wWinId:1,segs:[{utf8:'A'}]},{tStartMs:1000,dDurationMs:500,wWinId:2,segs:[{utf8:'B'}]},{tStartMs:6000,dDurationMs:1000,wWinId:1,segs:[{utf8:'C'}]},{tStartMs:6000,dDurationMs:1000,wWinId:1,segs:[{utf8:'D'}]}]};
 const body=JSON.stringify(input),doc=C.parse(body);assert.equal(doc.render({}),body);
 const out=JSON.parse(doc.render({0:'甲',1:'乙',2:'丙',3:'丁'}));
 assert.deepEqual(out.events.map(e=>[e.tStartMs,e.dDurationMs]),input.events.map(e=>[e.tStartMs,e.dDurationMs]));
});
test('overlap repair uses time order and also clears preceding untranslated cue',()=>{
 const body=JSON.stringify({events:[{tStartMs:2000,dDurationMs:1000,segs:[{utf8:'B'}]},{tStartMs:0,dDurationMs:5000,segs:[{utf8:'A'}]}]});
 const out=JSON.parse(C.parse(body).render({0:'乙'}));assert.equal(out.events[1].dDurationMs,2000);assert.equal(out.events[1].segs[0].utf8,'A');
});
function sentenceSample() {
 return JSON.stringify({events:[
 {tStartMs:92000,dDurationMs:4000,segs:[{utf8:'Let me ',tOffsetMs:0},{utf8:'read to you ',tOffsetMs:500},{utf8:"its blurb from Let's Go.",tOffsetMs:1000},{utf8:' The stone city ',tOffsetMs:2000}]},
 {tStartMs:95000,dDurationMs:4000,segs:[{utf8:'that rests ',tOffsetMs:0},{utf8:'at the foot ',tOffsetMs:500},{utf8:'of a great rocky mountain.',tOffsetMs:1000},{utf8:' This is rugged.',tOffsetMs:2000}]}
 ]});
}
test('sentence sync binds complete source sentence and translation to the same interval',()=>{
 const body=sentenceSample(),d=C.sentenceParse(body);
 assert.equal(d.cues.length,3);assert.equal(d.cues[1].text,'The stone city that rests at the foot of a great rocky mountain.');
 const out=JSON.parse(d.render({0:'让我读简介。',1:'这座石头城坐落在一座巨大的岩石山脚下。',2:'这里崎岖。'}));
 assert.equal(out.events[1].tStartMs,94000);assert.equal(out.events[1].dDurationMs,3000);
 assert.equal(out.events[1].segs[0].utf8,'这座石头城坐落在一座巨大的岩石山脚下。\nThe stone city that rests at the foot of a great rocky mountain.');
 assert.equal(d.render({}),body);
 const h=harness('translate',{body});assert.equal(inputOf(h.calls[0])[1].text,d.cues[1].text);h.respond();assert.equal(h.results.length,1);
});
test('sentence sync does not estimate missing timing or merge multiple windows',()=>{
 for(const mutate of [d=>{delete d.events[0].segs[1].tOffsetMs;},d=>{d.events[1].wWinId=5;},d=>{d.events[1].tStartMs=92000;}]){
 const d=JSON.parse(sentenceSample());mutate(d);const body=JSON.stringify(d);
 assert.deepEqual(C.sentenceParse(body).cues,C.parse(body).cues);
 }
});
function srvSentences() {
 return '<timedtext format="3"><body><p t="92000" d="4000"><s t="0">Let me read its blurb.</s><s t="2000"> The stone city that rests</s></p><p t="96000" d="5000"><s t="0">at the foot of a great rocky mountain.</s><s t="3000"> This is rugged.</s></p></body></timedtext>';
}
test('SRV3 sentence reconstruction preserves format and binds bilingual text to one interval',()=>{
 const body=srvSentences(),d=C.sentenceParse(body);assert.equal(d.format,'srv3');assert.equal(d.sentenceMode,'srv3_estimated');
 assert.equal(d.cues[1].text,'The stone city that rests at the foot of a great rocky mountain.');
 const out=d.render({0:'让我读简介。',1:'这座石头城坐落在巨大的岩石山脚下。',2:'这里崎岖。'}),parsed=C.parse(out);
 assert.equal(parsed.cues[1].text,'这座石头城坐落在巨大的岩石山脚下。\nThe stone city that rests at the foot of a great rocky mountain.');
 assert.equal(parsed.cues[1].startSeconds,94);assert.ok(out.includes('t="94000" d="5000"'));assert.equal(d.render({}),body);
});
test('SRV3 plain cues can split multiple sentences and preserve XML entities',()=>{
 const body='<timedtext format="3"><body><p t="0" d="8000">One &amp; two. Three &lt; four. Five and six.</p></body></timedtext>';
 const d=C.sentenceParse(body);assert.equal(d.cues.length,3);assert.equal(d.cues[0].text,'One & two.');
 const parsed=C.parse(d.render({0:'一与二。',1:'三小于四。',2:'五和六。'}));assert.equal(parsed.cues.length,3);assert.ok(parsed.cues[1].text.includes('Three < four.'));
});
test('SRV3 new sentence cache namespace bypasses old translations without clearing key',()=>{
 const body=srvSentences(),d=C.sentenceParse(body),old=d.cues.map(c=>({k:JSON.stringify(['prompt-v1','deepseek-flash','zh-Hans','en',c.text]),v:'OLD_TRANSLATION',expires:Date.now()+86400000}));
 const h=harness('translate',{body,store:{'ytloon.cache.v1':JSON.stringify(old)}});assert.ok(h.calls.length);h.respond();
 assert.ok(h.logs.some(s=>s.includes('sentence=srv3_estimated')));assert.equal(h.results[0].body.includes('OLD_TRANSLATION'),false);
 assert.ok(h.store['ytloon.deepseek.key']);assert.ok(JSON.parse(h.store['ytloon.cache.v1']).some(r=>r.v==='OLD_TRANSLATION'));
 const replay=harness('translate',{body,store:h.store});assert.equal(replay.calls.length,0);assert.ok(replay.results[0].body.includes('译文'));
});
function longSentence() {
 // Manual-caption style: one long sentence with source line breaks inside cues.
 const words='Not that the current mini-LED\nMac Pros looked bad ever, but this one gets you that crazy 10 million\nto 1 contrast ratio because what OLED has always been good at is pitch-black blacks...'.split(/(?<=\s)/);
 return JSON.stringify({events:[0,1].map(k=>{const part=words.slice(k*20,k*20+20);return {tStartMs:k*5000,dDurationMs:5000,segs:part.map((w,j)=>({utf8:w,tOffsetMs:j*200}))};})});
}
test('long sentences split at clauses so bilingual cues fit a phone player',()=>{
 const d=C.sentenceParse(longSentence());assert.equal(d.sentenceMode,'json3_wordtimed');
 assert.deepEqual(d.cues.map(c=>c.text),['Not that the current mini-LED Mac Pros looked bad ever,','but this one gets you that crazy 10 million to 1 contrast ratio','because what OLED has always been good at is pitch-black blacks...']);
 for(const c of d.cues){assert.ok(c.text.length<=90);assert.equal(c.text.includes('\n'),false);}
});
test('sentence cues obey hard width and duration limits without punctuation',()=>{
 const segs=Array.from({length:60},(_,j)=>({utf8:'word ',tOffsetMs:j*100}));
 const d=C.sentenceParse(JSON.stringify({events:[{tStartMs:0,dDurationMs:6000,segs}]}));
 assert.ok(d.cues.length>=4);for(const c of d.cues) assert.ok(c.text.length<=90);
 const slow=Array.from({length:6},(_,j)=>({tStartMs:j*3000,dDurationMs:3000,segs:[{utf8:'a ',tOffsetMs:0},{utf8:'b ',tOffsetMs:1000}]}));
 assert.deepEqual(C.sentenceParse(JSON.stringify({events:slow})).cues.map(c=>[c.startSeconds,c.text]),[[0,'a b a b a b'],[9,'a b a b a b']]);
 const cjk=Array.from({length:40},(_,j)=>({utf8:'字字',tOffsetMs:j*100}));
 assert.ok(C.sentenceParse(JSON.stringify({events:[{tStartMs:0,dDurationMs:5000,segs:cjk}]})).cues.every(c=>c.text.replace(/ /g,'').length*2<=90));
});
test('bilingual output collapses source line breaks below the translation',()=>{
 const body='<timedtext format="3"><body><p t="0" d="3000">First line<br/>second line</p></body></timedtext>';
 assert.equal(C.parse(C.parse(body).render({0:'第一行第二行'})).cues[0].text,'第一行第二行\nFirst line second line');
});
test('Simplified and Traditional Chinese tracks pass through without translation',()=>{
 const zh=JSON.stringify({events:[{tStartMs:0,dDurationMs:2000,segs:[{utf8:'這是繁體中文字幕。'}]},{tStartMs:2000,dDurationMs:2000,segs:[{utf8:'这是简体中文 iPhone 字幕。'}]}]});
 for(const lang of ['zh-Hans','zh-Hant','zh-TW','zh-HK','zh-CN','zh','zh_TW']){
  const h=harness('translate',{body:zh,url:requestURL.replace('lang=en','lang='+lang)});
  assert.equal(h.calls.length,0);assert.deepEqual(h.results,[{}]);assert.ok(h.logs.some(s=>s.includes('result=SAME_LANGUAGE')));
 }
 // Missing or mislabeled language codes fall back to the track text.
 for(const url of [requestURL,requestURL.replace('lang=en','lang=auto'),requestURL.replace('lang=en&','')]) assert.equal(harness('translate',{body:zh,url}).calls.length,0);
 assert.equal(harness('translate',{body:zh,url:requestURL.replace('lang=en','lang=zh-Hant'),args:{enabled:true,target:'ja'}}).calls.length,1);
});
test('Japanese and English tracks still translate; YouTube Chinese auto-translation passes through',()=>{
 const ja=JSON.stringify({events:[{tStartMs:0,dDurationMs:2000,segs:[{utf8:'これは日本語の字幕です。'}]}]});
 assert.equal(harness('translate',{body:ja,url:requestURL.replace('lang=en','lang=ja')}).calls.length,1);
 assert.equal(harness('translate',{}).calls.length,1);
 assert.equal(harness('translate',{body:ja,url:requestURL.replace('lang=en','lang=ja&tlang=zh-Hant')}).calls.length,0);
});
test('SRV3 multiple windows fall back without merging separate speakers',()=>{
 const body=srvSentences().replace('t="92000"','w="1" t="92000"').replace('t="96000"','w="2" t="96000"');
 const d=C.sentenceParse(body);assert.equal(d.sentenceMode,'fallback_multiwindow');assert.deepEqual(d.cues,C.parse(body).cues);
});
