/**
 * 密码哈希 — IPC 版
 * 所有加密运算在 AppService 侧完成
 */
import { call } from './bridge';

/**
 * 生成密码哈希
 */
export async function hashPassword(password: string): Promise<string> {
  const result = await call('hash_password', { password });
  return result.hash;
}

/**
 * 验证密码
 */
export async function verifyPassword(input: string, storedHash: string): Promise<boolean> {
  const result = await call('verify_password', { input, hash: storedHash });
  return result.valid;
}
