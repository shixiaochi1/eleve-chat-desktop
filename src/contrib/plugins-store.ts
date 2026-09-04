/**
 * 鎻掍欢璁板綍 store锛堝榻?Hermes contrib/plugins-store.ts 绮剧畝鐗堬級銆? *
 * enabled 鎸佷箙鍖栧湪 localStorage eleve.plugins.disabled锛堥粦鍚嶅崟妯″瀷锛? * 鏂版彃浠?defaultEnabled 鐢熸晥锛岀敤鎴锋樉寮忕鐢ㄧ殑璁板叆榛戝悕鍗曪級銆傝杞?鍗歌浇
 * 寮曟搸鍥炶皟鐢?plugins.ts 娉ㄥ叆锛堟湰 store 鍙鏁版嵁锛岃亴璐ｅ垎绂伙級銆? */

import { useSyncExternalStore } from 'react';

export interface PluginRecord {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
}

const DISABLED_KEY = 'eleve.plugins.disabled';

let records: PluginRecord[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  records = [...records];
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function loadDisabled(): Set<string> {
  try {
    const raw = localStorage.getItem(DISABLED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveDisabled(set: Set<string>): void {
  try {
    localStorage.setItem(DISABLED_KEY, JSON.stringify([...set]));
  } catch {
    /* 闅愮妯″紡闄嶇骇锛氫粎鍐呭瓨鎬?*/
  }
}

/** 寮曟搸瑁呰浇鏃剁櫥璁版彃浠惰褰曪紙enabled 鐢遍粦鍚嶅崟鍙嶆帹锛夈€?*/
export function publishPlugin(rec: Omit<PluginRecord, 'enabled'>): void {
  const disabled = loadDisabled();
  const idx = records.findIndex(r => r.id === rec.id);
  const entry: PluginRecord = { ...rec, enabled: !disabled.has(rec.id) };
  if (idx >= 0) records[idx] = entry;
  else records.push(entry);
  emit();
}

export function isPluginEnabled(id: string): boolean {
  return !loadDisabled().has(id);
}

/** 鍒囨崲鍚敤鎬侊紙UI 寮€鍏宠皟鐢紱寮曟搸鐨勯噸杞藉洖璋冪敱 setReloadHandler 娉ㄥ叆锛夈€?*/
export function setPluginEnabled(id: string, enabled: boolean): void {
  const disabled = loadDisabled();
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  saveDisabled(disabled);
  emit();
  reloadHandler?.(id, enabled);
}

type ReloadHandler = (id: string, enabled: boolean) => void;
let reloadHandler: ReloadHandler | null = null;

export function setPluginReloadHandler(fn: ReloadHandler | null): void {
  reloadHandler = fn;
}

export function usePluginRecords(): readonly PluginRecord[] {
  return useSyncExternalStore(subscribe, () => records, () => records);
}
