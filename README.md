# YouTube DeepSeek 1.1.0

正式版。关闭旧插件，安装 plugins/YouTube-translate.plugin，更新脚本并开启翻译。需要 Loon 3.5.1(983)+。Key 和缓存继续保留。新用户在手机本地运行 local-setup.example.js 配置 Key。

翻译起点固定为 0，旧设置会被忽略。长视频可手动运行 YouTube-prewarm.plugin 补全，然后重新请求字幕。

响应最多等待约22秒；预翻译最多270秒。失败仍可能缺少译文，已交付轨道需要重新请求才能更新。缓存按视频分片保存，每次只读写当前视频，总计最多6MiB、400个视频、7天。

正式版依据用户实测反馈发布。自动回归测试使用模拟 API，保留在 tests/，不进入插件。运行 node tools/build.cjs 和 node --test tests/*.test.cjs。

整句同步：对支持的单窗口 JSON3、SRV3 轨道重组语句；SRV3 缺少逐词时间时估算句内时间，再生成同时切换的中英文字幕。详见 [同步处理说明](ALIGNMENT.md)。

[安装正式版](https://raw.githubusercontent.com/lpleasure/youtube-loon-deepseek/main/plugins/YouTube-translate.plugin)
