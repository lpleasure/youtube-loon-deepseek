// Manually run in Loon. Only this project's cache/cooldown are removed.
(function () {
  let ok = true, index = null;
  const remove = key => { if (!$persistentStore.write(undefined, key)) ok = false; };
  try { index = JSON.parse($persistentStore.read("ytloon.index.v2")); } catch (_) {}
  Object.keys(index && index.s || {}).forEach(function (id) {
    remove("ytloon.shard.v2." + id);
    $persistentStore.write(undefined, "ytloon.lock.v2." + id);
  });
  ["ytloon.index.v2", "ytloon.cache.v1", "ytloon.pending.v1", "ytloon.pendingid.v1", "ytloon.cooldown.v1"].forEach(remove);
  console.log(ok ? "[YTSubs] 缓存与冷却记录已清除；Key 保留。" : "[YTSubs] 清理可能未完成。");
  $done({});
})();
