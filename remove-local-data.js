// Explicit manual action: deletes only this project's keys, including per-video cache shards.
(function () {
  let ok = true, index = null;
  const remove = key => { if (!$persistentStore.write(undefined, key)) ok = false; };
  try { index = JSON.parse($persistentStore.read("ytloon.index.v2")); } catch (_) {}
  Object.keys(index && index.s || {}).forEach(function (id) {
    remove("ytloon.shard.v2." + id);
    $persistentStore.write(undefined, "ytloon.lock.v2." + id);
  });
  ["ytloon.index.v2", "ytloon.pending.v1", "ytloon.pendingid.v1", "ytloon.cache.v1", "ytloon.cooldown.v1", "ytloon.settings.v1", "ytloon.deepseek.key"].forEach(remove);
  console.log(ok ? "[YTSubs] 本插件本地数据已删除。" : "[YTSubs] 清理可能未完成。");
  $done({});
})();
