/* Optional since 1.2.0: the key can be typed in the plugin settings instead.
 * Copy to a NEW LOCAL Loon script. Do not edit a GitHub-hosted file with your key.
 * Run manually once; then erase the key from this editor copy and delete the local setup script.
 * The value remains in Loon script storage, not iOS Keychain. Never share Loon backups containing it.
 */
(function () {
  "use strict";
  const LOCAL_KEY = "PASTE_KEY_ON_IPHONE_ONLY";
  if (!LOCAL_KEY || LOCAL_KEY === "PASTE_KEY_ON_IPHONE_ONLY" || /\s/.test(LOCAL_KEY)) {
    console.log("[YTSubs setup] 未填写本地 Key；未保存。");
    return $done({});
  }
  const ok = $persistentStore.write(LOCAL_KEY, "ytloon.deepseek.key");
  const cfg = $persistentStore.write(JSON.stringify({enabled: false, target: "zh-Hans", model: "deepseek-flash"}), "ytloon.settings.v1");
  $persistentStore.write(undefined, "ytloon.cooldown.v1");
  console.log(ok && cfg ? "[YTSubs setup] 本地设置已保存；日志不包含 Key。" : "[YTSubs setup] 保存失败，请检查本地存储。");
  $done({});
})();
