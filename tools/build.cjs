'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const out = path.join(root, 'dist');
fs.mkdirSync(out, {recursive: true});
const core = fs.readFileSync(path.join(root, 'src/core.js'), 'utf8');
for (const mode of ['translate', 'prewarm']) {
  const runtime = fs.readFileSync(path.join(root, `src/${mode === 'prewarm' ? 'translate' : mode}.js`), 'utf8');
  fs.writeFileSync(path.join(out, `yt-${mode}.js`), `/* YT Loon ${version}. Generated: edit src/, run npm run build. */\n${core}\n${mode === 'prewarm' ? 'var YTSubsPrewarm = true;\n' : ''}${runtime}`);
}
const regex = '^https:\\/\\/(?:www\\.youtube\\.com|m\\.youtube\\.com|youtube\\.com|video\\.google\\.com)\\/api\\/timedtext(?:\\?|$)';
for (const mode of ['translate', 'prewarm']) {
  if (mode === 'prewarm') continue;
  const title = mode === 'probe' ? 'YouTube 字幕注入验证（无 API）' : 'YouTube DeepSeek 双语字幕';
  const common = `#!name = ${title}\n#!desc = ${version}；中文在上、原文在下；与其他字幕重写插件互斥；密钥只存本地\n#!system = iOS,iPadOS\n#!date = 2026-11-01\n`;
  const args = mode === 'translate' ? '[Argument]\nenabled = switch,false,type=boolean,tag=允许翻译,desc=启用双语字幕\ntarget = input,"zh-Hans",type=string,tag=目标语言\nmodel = input,"deepseek-flash",type=string,tag=DeepSeek 模型\n' : '';
  const params = mode === 'translate' ? ', {${enabled}, ${target}, ${model}}' : '';
  const mitm = '\n[Mitm]\nhostname = www.youtube.com, m.youtube.com, youtube.com, video.google.com\n';
  fs.writeFileSync(path.join(out, `YouTube-${mode}.plugin`), common + '#!loon_version = 3.5.1(983)\n' + args + `[Script]\nresponse if \${url} ~= /${regex}/ then script("yt-${mode}.js"${params}) with requires_body=true, binary_body_mode=false, timeout=${mode === 'probe' ? 5 : 25}, tag="YTSubs ${mode}"\n` + mitm);
}
fs.writeFileSync(path.join(out, 'YouTube-prewarm.plugin'), '#!name = YouTube 最近字幕预翻译\n#!desc = 1.1.1；手动运行，最长约 270 秒；完成后重新请求字幕\n[Script]\ngeneric then script("yt-prewarm.js") with timeout=300, tag="YTSubs prewarm"\n');
console.log('Built response/probe/prewarm scripts and plugin configurations.');
if (fs.existsSync(path.join(root, 'subscription.json'))) require('./subscription.cjs');
