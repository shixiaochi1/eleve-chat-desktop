/**
 * useFileTree — 文件树 Hook
 *
 * 使用 Tauri fs API 或 HTTP backend 列出目录内容
 * 支持缓存、排序（目录优先，按字母序）、展开/折叠
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { isDesktop } from '../utils/bridge';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileEntry[] | null;
}

interface CacheMap {
  [dirPath: string]: FileEntry[];
}

interface OpenStateMap {
  [dirPath: string]: boolean;
}

/** Minimal typed shape for raw directory entries returned by Tauri APIs */
interface TauriDirEntry {
  name?: string;
  path?: string;
  isDirectory?: boolean;
  is_dir?: boolean;
  kind?: string;
  children?: FileEntry[];
}

/**
 * 尝试用 Tauri 的原生 fs API 读取目录
 * 优先 Tauri invoke IPC，回退 HTTP API
 */
async function readDirViaTauri(dirPath: string): Promise<TauriDirEntry[]> {
  // 方式 1: 通过 Tauri invoke 调用 fs 插件 (v2 plugin-fs)
  // @tauri-apps/plugin-fs 不是 npm 依赖，但 plugin:fs|read_dir 命令在 Rust 端注册后可用
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const entries = await invoke('plugin:fs|read_dir', { path: dirPath });
    if (entries && Array.isArray(entries)) {
      return entries;
    }
  } catch { /* 继续 fallback */ }

  // 方式 2: 通过 Tauri invoke 调用自定义命令
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const entries = await invoke('list_files', { path: dirPath });
    if (entries && Array.isArray(entries)) {
      return entries;
    }
  } catch { /* 继续 fallback */ }

  // 方式 3: 直接通过 TAURI_INTERNALS IPC 调用
  try {
    const wi = window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown> } };
    if (wi.__TAURI_INTERNALS__) {
      const entries = await wi.__TAURI_INTERNALS__.invoke('plugin:fs|read_dir', {
        path: dirPath,
      });
      if (entries && Array.isArray(entries)) {
        return entries;
      }
    }
  } catch { /* 全部失败 */ }

  throw new Error('Tauri filesystem API not available');
}

/**
 * 尝试用 HTTP API 读取目录
 */
async function readDirViaHTTP(dirPath: string): Promise<unknown[]> {
  const encoded = encodeURIComponent(dirPath);

  // 动态获取 base URL
  let base = 'http://127.0.0.1:3001';
  try {
    const { getHttpBase } = await import('../utils/bridge');
    base = getHttpBase();
  } catch { /* 默认值 */ }

  // 尝试多个可能的端点
  const endpoints = [
    `/api/files/list?path=${encoded}`,
    `/v1/files?path=${encoded}`,
    `/v1/files/list?path=${encoded}`,
    `/api/fs/readdir?path=${encoded}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const resp = await fetch(`${base}${endpoint}`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = await resp.json();
        // 后端可能返回 { files: [...] } 或直接数组
        const entries = Array.isArray(data) ? data
          : (data.files || data.entries || data.children || data.result || []);
        return entries;
      }
    } catch { /* 尝试下一个 */ }
  }

  throw new Error('No file API endpoint available');
}

/**
 * 标准化文件条目格式
 */
function normalizeEntries(entries: unknown[]): FileEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.map((e) => {
    const entry = e as TauriDirEntry;
    return {
    name: entry.name || '',
    path: entry.path || entry.name || '',
    isDirectory: !!(entry.isDirectory || entry.is_dir || entry.kind === 'directory' || entry.children !== undefined),
    children: entry.children || null,
  };
  });
}

/**
 * 排序：目录优先，再按字母序
 */
function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });
}

/**
 * useFileTree Hook
 */
export function useFileTree(initialPath: string | null = null) {
  const [data, setData] = useState<FileEntry[] | null>(null);        // 当前根目录的子条目
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openState, setOpenState] = useState<OpenStateMap>({}); // { [dirPath]: true/false }
  const [rootPath, setRootPath] = useState<string | null>(initialPath);
  const cacheRef = useRef<CacheMap>({});                    // { [dirPath]: [entries] }
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  /**
   * 列出目录（带缓存）
   */
  const listDir = useCallback(async (dirPath: string): Promise<FileEntry[]> => {
    if (!dirPath) return [];

    // 缓存命中
    if (cacheRef.current[dirPath]) {
      return cacheRef.current[dirPath];
    }

    let entries: unknown[];

    if (isDesktop()) {
      try {
        entries = await readDirViaTauri(dirPath);
      } catch (err) {
        // Tauri 不可用时尝试 HTTP
        try {
          entries = await readDirViaHTTP(dirPath);
        } catch (httpErr: unknown) {
          throw new Error(`无法读取目录: ${(httpErr as Error).message}`);
        }
      }
    } else {
      // 浏览器开发模式
      try {
        entries = await readDirViaHTTP(dirPath);
      } catch {
        throw new Error('浏览器开发模式不支持文件系统操作');
      }
    }

    const sorted = sortEntries(normalizeEntries(entries));
    cacheRef.current[dirPath] = sorted;
    return sorted;
  }, []);

  /**
   * 设置根目录（刷新整个树）
   */
  const setRoot = useCallback(async (path: string | null) => {
    if (!path) {
      setRootPath(null);
      setData(null);
      setError(null);
      setOpenState({});
      return;
    }

    setRootPath(path);
    setLoading(true);
    setError(null);

    try {
      const entries = await listDir(path);
      if (mountedRef.current) {
        setData(entries);
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        setError((err as Error).message || '读取目录失败');
        setData([]);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [listDir]);

  /**
   * 刷新当前目录
   */
  const refresh = useCallback(async () => {
    if (!rootPath) return;
    // 清除缓存
    cacheRef.current = {};
    await setRoot(rootPath);
  }, [rootPath, setRoot]);

  /**
   * 展开/折叠目录
   */
  const toggleOpen = useCallback(async (dirPath: string) => {
    setOpenState(prev => {
      const next = { ...prev };
      if (next[dirPath]) {
        delete next[dirPath];
      } else {
        next[dirPath] = true;
      }
      return next;
    });

    // 如果打开时还没缓存，预加载子目录
    if (!cacheRef.current[dirPath]) {
      try {
        const entries = await listDir(dirPath);
        cacheRef.current[dirPath] = entries;
      } catch { /* 静默失败 */ }
    }
  }, [listDir]);

  /**
   * 获取子目录条目（用于递归渲染）
   */
  const loadChildren = useCallback(async (dirPath: string): Promise<FileEntry[]> => {
    if (cacheRef.current[dirPath]) {
      return cacheRef.current[dirPath];
    }
    try {
      const entries = await listDir(dirPath);
      return entries;
    } catch {
      return [];
    }
  }, [listDir]);

  return {
    data,
    loading,
    error,
    refresh,
    setRoot,
    loadChildren,
    openState,
    toggleOpen,
    rootPath,
  };
}
