# YouTube DeepSeek 1.3.2

用 DeepSeek 把 YouTube 字幕翻译成中文，中文在上、原文在下。需要 Loon 3.5.1(983)+ 和你自己的 DeepSeek API Key。

- 视频自带中文字幕时直接使用，不调用 DeepSeek；自带字幕未覆盖的句子只显示原文。
- 简体、繁体中文字幕原样显示，不翻译。
- 自动生成的字幕按整句重组后翻译，单条原文不超过约 90 字符宽。

## 安装

1. 在 Loon 里添加插件：[安装正式版](https://raw.githubusercontent.com/lpleasure/youtube-loon-deepseek/main/plugins/YouTube-translate.plugin)。
2. 打开插件设置，在「DeepSeek Key」里粘贴你的 Key，再打开「允许翻译」。
3. 关闭其他改写 YouTube 字幕的插件（两者互斥）。打开 YouTube 视频并开启字幕即可。

老用户：之前用 local-setup.example.js 存过的 Key 继续有效，插件里的 Key 可以留空；填了则优先使用插件里的。

## 已知缺点

- **双语字幕不是一打开视频就出现**（视频自带中文字幕时除外）。字幕要先发给 DeepSeek 翻译完才会显示，通常要等几秒，最多约 22 秒，这段时间里看不到字幕。
- **部分长视频第一次打开可能提示字幕加载出错。** 字幕太多、22 秒内翻译不完时会出现这种情况。退出视频重新进入即可显示：已翻译的部分已经缓存，第二次很快。也可以手动运行 YouTube-prewarm.plugin 把整条字幕翻译完（最多 270 秒），再重新打开字幕。
- 网络或 DeepSeek 接口出问题时，部分句子可能没有译文，重新打开字幕会补上。

## Key 安全

- 插件里填的 Key 只保存在你自己手机的 Loon 里，同时存一份到 Loon 本地存储供预翻译使用，不会上传到本仓库，作者和其他人看不到。Key 只发给 api.deepseek.com。
- 插件设置里的 Key 是明文显示的。截图、分享 Loon 配置或备份前，请先遮住或删掉 Key。
- 请在 Loon 的插件设置里填 Key，不要下载插件文件后把 Key 写进去再转发给别人。
- 日志里只显示 key=plugin 或 key=local（Key 来自哪里），不会出现 Key 本身。
- 不再使用时：清空插件里的 Key，再运行 remove-local-data.js 删除本地保存的 Key 和缓存。

## 其他说明

翻译起点固定为 0，旧设置会被忽略。缓存按视频分片保存，每次只读写当前视频，总计最多6MiB、400个视频、7天。

整句同步：对支持的单窗口 JSON3、SRV3 轨道重组语句；SRV3 缺少逐词时间时估算句内时间，再生成同时切换的中英文字幕。详见 [同步处理说明](ALIGNMENT.md)。

## 仓库结构

```
plugins/        在线安装用的插件（脚本地址指向本仓库），由构建生成
dist/           完整本地版：两个插件 + 两个打包好的脚本，由构建生成，不要手改
src/            脚本源码：core.js（字幕解析与输出）、translate.js（翻译与缓存）
tools/          build.cjs 构建；subscription.cjs 生成 plugins/；inspect-har.cjs 离线分析抓包
tests/          自动测试（模拟 API，不进入插件），fixtures/ 为人工构造的字幕样本
subscription.json       plugins/ 里脚本网址使用的仓库和分支
clear-cache.js          在 Loon 手动运行：清缓存，保留 Key
remove-local-data.js    在 Loon 手动运行：删除 Key、缓存和设置
local-setup.example.js  旧的本地存 Key 方式，可改用插件设置
ALIGNMENT.md            字幕整句同步的实现说明
```

修改流程：改 src/ → node tools/build.cjs → node --test tests/*.test.cjs
