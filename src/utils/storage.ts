/**
 * 文件持久化工具 — IPC 版
 * 
 * 所有数据存储在 eleve-app 侧: <eleve_home>/app-data/<key>.json
 * 通过 bridge.call() 读写，不再依赖 HTTP
 * 
 * 架构：内存缓存 + 后台异步持久化
 * - load/save/remove 保持同步接口（读内存缓存）
 * - 启动时 init() 从 AppService 一次性加载所有数据到内存
 * - save/remove 后台异步写 AppService（不阻塞 UI）
 * - 与旧 localStorage 接口 100% 兼容，零改动调用方
 * 
 * 🔴 2026-08-08 对齐 Hermes 修复（重启弹"数据可能未保存"根因）：
 * - P0-1 恢复链：后端 get_app_data 返回 JSON 字符串（Value::String），
 *   init() 原用 Array.isArray 判断 index → 恒 false → _cache 永不加载 →
 *   重启后 msg_cache/titles/session_id 全部读不到（靠后端 DB 兜底才没暴露）。
 *   修：字符串 index JSON.parse 后按数组处理（对齐 HTTP 端点契约）。
 * - P0-2 写队列 + 重试：原 _persist fire-and-forget，WS 未连（冷启动 mount 期）
 *   直接 reject → 一次 save = save+index 两次计数，3 次 save 即触发 5 次阈值弹窗。
 *   修：写入入 pending 队列，等 WS 连接后批量补写（最终一致，对齐 Hermes
 *   localStorage 同步语义的异步等价）；真落盘失败才计数提示。
 * - P1 index 防抖：_updateIndex 每次 save 都发 RPC → 合并为 500ms 防抖单写。
 */
import { call, getHttpBase } from './bridge';

// ====== 内存缓存（启动时从 AppService 加载，后续同步读写） ======
const _cache = new Map<string, string>();

// ====== 迁移标记 ======
const MIGRATION_DONE_KEY = '__stor…ed__';

// ====== 是否已初始化 ======
let _initialized = false;
let _initPromise: Promise<void> | null = null;

/**
 * 初始化：从 AppService 加载所有数据到内存缓存
 * 应用启动时调用一次即可
 */
export async function init(): Promise<void> {
  if (_initialized) return;
  if (_initPromise) return _initPromise;
  
  _initPromise = (async () => {
    try {
      // 1. 尝试从 AppService 加载索引文件
      const indexRaw = await call('get_app_data', { key: '__index__' });
      // 🔴 P0-1: 后端返回 JSON 字符串（Value::String），非数组。解析后按数组处理。
      let indexKeys: string[] | null = null;
      if (typeof indexRaw === 'string' && indexRaw) {
        try {
          const parsed = JSON.parse(indexRaw);
          if (Array.isArray(parsed)) indexKeys = parsed;
        } catch { /* 非法 JSON → 视为无索引 */ }
      } else if (Array.isArray(indexRaw)) {
        indexKeys = indexRaw;
      }
      if (indexKeys && indexKeys.length > 0) {
        // 2. 并行加载所有 key
        const entries: Array<[string, string] | null> = await Promise.all(
          indexKeys.map(async (key: string) => {
            try {
              const raw = await call('get_app_data', { key });
              if (raw !== null && raw !== undefined) {
                return [key, typeof raw === 'string' ? raw : JSON.stringify(raw)];
              }
            } catch { /* skip missing keys */ }
            return null;
          })
        );
        for (const entry of entries) {
          if (entry) _cache.set(entry[0], entry[1]);
        }
      }
    } catch {
      // 🔴 P0-1: RPC 失败（WS 未连接）≠ 无数据。不置 _initialized，允许 WS 连接后重试。
      // 旧行为：catch 当"首次启动无数据"吞掉 → _initialized=true 封死重试 → 冷启动恢复链整条失效。
      _initPromise = null;
      return;
    }

    // 3. 检查是否需要从 localStorage 迁移（C2: 包 try/catch 防毒化 _initPromise）
    if (!localStorage.getItem('eleve_' + MIGRATION_DONE_KEY)) {
      try {
        await _migrateFromLocalStorage();
      } catch (e) {
        console.warn('[storage] Migration failed, will retry next init:', e);
        _initPromise = null; // 允许重试
        return;
      }
    }

    _initialized = true;
  })();
  
  return _initPromise;
}

/**
 * 从 localStorage 迁移旧数据到 AppService 文件存储
 */
async function _migrateFromLocalStorage(): Promise<void> {
  const items: Array<{ key: string; value: string }> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('eleve_') && key !== 'eleve_' + MIGRATION_DONE_KEY) {
      const value = localStorage.getItem(key);
      if (value) {
        items.push({ key, value });
        // 同时写入内存缓存
        const cleanKey = key.slice(6);
        _cache.set(cleanKey, value);
      }
    }
  }
  
  if (items.length > 0) {
    try {
      await call('migrate_app_data', { items });
    } catch (e) {
      console.warn('[storage] Migration failed:', e);
      return;
    }
    // 迁移成功，清除 localStorage 旧数据
    for (const item of items) {
      localStorage.removeItem(item.key);
    }
  }
  
  localStorage.setItem('eleve_' + MIGRATION_DONE_KEY, '1');
}

// ====== 后台持久化（写队列 + WS 就绪后批量补写，最终一致） ======

// 🔴 P0-2: pending 写队列。key → value（value=null 表示删除）。
// 原实现 fire-and-forget：WS 未连（冷启动 mount 期）sendRpc 直接 reject →
// 一次 save = save+index 两次失败计数，3 次 save 即触发 5 次阈值弹窗。
// 新实现：入队后等 WS 连接，连接后批量补写；真落盘失败才计数提示。
const _pendingWrites = new Map<string, string | null>();
let _flushing = false;

let _writeFailCount = 0;
const WRITE_FAIL_THRESHOLD = 5;

function _reportWriteFailure(context: string, e: unknown): void {
  _writeFailCount++;
  console.warn(`[storage] ${context} failed:`, e);
  // C3: 阈值触发一次用户提示（去重防刷屏）
  if (_writeFailCount === WRITE_FAIL_THRESHOLD) {
    import('./notifications').then(({ notifyWarning }) => {
      notifyWarning('数据可能未保存（存储写入失败）');
    }).catch(() => { /* 通知模块加载失败静默 */ });
  }
}

function _persist(key: string, value: string | null): void {
  _pendingWrites.set(key, value);
  if (key !== '__index__') _indexDirty = true; // 数据变更 → 同批补写 index
  _scheduleFlush();
}

/**
 * 触发一次写队列 flush（单飞：已有 flush 在跑则复用）。
 * flush 流程：等 WS 连接（带超时）→ 批量写出当前快照 → 失败项重新入队并跳出
 * （留待下次 save 触发重试，防无限循环）→ 补一次防抖 index 更新。
 */
function _scheduleFlush(): void {
  if (_flushing) return;
  _flushing = true;
  void (async () => {
    try {
      while (_pendingWrites.size > 0) {
        const { getWsClient } = await import('../services/ws-client');
        const ws = getWsClient();
        // 等 WS 连接（对齐 Hermes localStorage 同步语义：写入不因连接未就绪而失败）。
        // 先订阅再查状态，防订阅后状态已变 connected 导致永久挂起。
        // 60s 超时保护：重连彻底失败时放弃本轮（pending 保留），不永久卡死 _flushing。
        if (ws.state !== 'connected') {
          await new Promise<void>((resolve) => {
            let done = false;
            const finish = () => { if (!done) { done = true; unsub(); resolve(); } };
            const unsub = ws.onStateChange((s) => {
              if (s === 'connected') finish();
            });
            if (ws.state === 'connected') finish();
            setTimeout(finish, 60_000);
          });
        }

        // 等连接超时仍未连 → 跳出（pending 保留），60s 后兜底重试一次，
        // 防止 WS 恢复连接后无人触发 flush（_flushing 已释放，不卡死）
        if (ws.state !== 'connected') {
          setTimeout(() => _scheduleFlush(), 60_000);
          break;
        }

        const entries = Array.from(_pendingWrites.entries());
        _pendingWrites.clear();
        let failed = false;
        for (const [key, value] of entries) {
          try {
            if (value === null) {
              await call('delete_app_data', { key });
            } else {
              await call('set_app_data', { key, value });
            }
          } catch (e) {
            // 真落盘失败：重新入队（下次 save 触发重试）+ 计数提示
            _pendingWrites.set(key, value);
            _reportWriteFailure(value === null ? 'remove' : 'save', e);
            failed = true;
          }
        }
        // 本轮有失败 → 跳出循环，避免同批失败项无限重试；
        // 5s 后兜底重试一次（用户无新 save 时也能自愈），失败计数已有阈值提示。
        if (failed) {
          setTimeout(() => _scheduleFlush(), 5000);
          break;
        }

        // 数据写入完成后，补一次 index 更新（同批写出，防抖：仅数据变更时置脏一次）
        if (_indexDirty) {
          _indexDirty = false;
          const keys = Array.from(_cache.keys()).filter(k => !k.startsWith('__'));
          _pendingWrites.set('__index__', JSON.stringify(keys));
        }
      }
    } finally {
      _flushing = false;
    }
  })();
}

// ====== 索引更新（防抖合并，避免每次 save 都发 index RPC） ======
// 数据变更（_persist）时置脏；flush 循环同批写出 __index__；
// 不存在独立定时器 → 无“index 更新后再次触发 flush”的死循环。
let _indexDirty = false;

// ====== 对外接口 — 与旧 storage.js 100% 兼容（同步） ======

/**
 * 检查存储是否已初始化完成
 */
export function isReady(): boolean {
  return _initialized;
}

/**
 * 读取数据（同步，读内存缓存）
 */
export function load(key: string, fallback: unknown = null): unknown {
  const raw = _cache.get(key);
  if (raw === undefined || raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * 保存数据（同步写内存缓存 + 后台异步持久化到 AppService）
 */
export function save(key: string, value: unknown): void {
  // 🔴 2026-09-01 内存修复（审查 P0-1 放大器）：消除双重 stringify——
  // 原实现对同一 value 序列化两次（内存缓存 + 持久化各一次）。msg_cache
  // 全量回写路径（每 turn 一次，见 useMessageStream saveCache 调用点）下，
  // 大 JSON 的重复序列化是主线程 CPU 尖峰与瞬时内存翻倍的主源之一。
  // 复用同一次序列化结果，行为语义不变（两处持有同一字符串内容）。
  const raw = JSON.stringify(value);
  _cache.set(key, raw);
  _persist(key, raw);
}

/**
 * 删除数据（同步删内存缓存 + 后台异步删 AppService 文件）
 */
export function remove(key: string): void {
  _cache.delete(key);
  _persist(key, null);
}

/**
 * beforeunload 专用保存：同步写内存缓存 + sendBeacon 持久化
 * 🔴 2026-08-08 对齐修复：统一走 HTTP sendBeacon，不依赖 WS 连接。
 *   原桌面分支走 call('set_app_data')（WS RPC）——关闭窗口时 WS 已断 → 必失败 →
 *   msg_cache 永远停在关闭前（重启后丢最后消息）。后端 /api/app-data/:key 已
 *   支持 POST（sendBeacon 只能 POST，专门复用 PUT handler），HTTP server 独立
 *   于 WS，关闭瞬间仍可送达。
 */
export function saveBeacon(key: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  _cache.set(key, serialized);
  try {
    navigator.sendBeacon(
      `${getHttpBase()}/api/app-data/${encodeURIComponent(key)}`,
      new Blob([serialized], { type: 'text/plain' })
    );
  } catch (e) {
    console.warn('[storage] beacon save failed:', e);
  }
  // 索引异步补写（尽力而为，beforeunload 场景不阻塞）
  _indexDirty = true;
  _scheduleFlush();
}
