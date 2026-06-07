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
 */
import { call } from './bridge';

// ====== 内存缓存（启动时从 AppService 加载，后续同步读写） ======
const _cache = new Map<string, string>();

// ====== 迁移标记 ======
const MIGRATION_DONE_KEY = '__storage_migrated__';

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
      if (indexRaw && Array.isArray(indexRaw)) {
        // 2. 并行加载所有 key
        const entries: Array<[string, string] | null> = await Promise.all(
          indexRaw.map(async (key: string) => {
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
      // 首次启动无数据，正常
    }

    // 3. 检查是否需要从 localStorage 迁移
    if (!localStorage.getItem('eleve_' + MIGRATION_DONE_KEY)) {
      await _migrateFromLocalStorage();
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

/**
 * 后台持久化（不阻塞 UI，fire-and-forget）
 */
function _persist(key: string, value: string | null): void {
  if (value === undefined || value === null) {
    call('delete_app_data', { key })
      .catch(e => console.warn('[storage] remove failed:', e));
  } else {
    call('set_app_data', { key, value })
      .catch(e => console.warn('[storage] save failed:', e));
  }
  _updateIndex();
}

/**
 * 更新索引文件（记录所有已存储的 key）
 */
function _updateIndex(): void {
  const keys = Array.from(_cache.keys()).filter(k => !k.startsWith('__'));
  call('set_app_data', { key: '__index__', value: JSON.stringify(keys) })
    .catch(e => console.warn('[storage] index update failed:', e));
}

// ====== 对外接口 — 与旧 storage.js 100% 兼容（同步） ======

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
  _cache.set(key, JSON.stringify(value));
  _persist(key, JSON.stringify(value));
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
 * 桌面模式：走 invoke（同步性更好）
 * 浏览器模式：走 sendBeacon
 */
export function saveBeacon(key: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  _cache.set(key, serialized);
  // 桌面模式：直接 invoke（更可靠）
  if (typeof window !== 'undefined' && ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)) {
    call('set_app_data', { key, value: serialized })
      .catch(e => console.warn('[storage] beacon save failed:', e));
  } else {
    // 浏览器 fallback：sendBeacon
    navigator.sendBeacon(
      `http://127.0.0.1:3001/api/app-data/${encodeURIComponent(key)}`,
      new Blob([serialized], { type: 'text/plain' })
    );
  }
  _updateIndex();
}
