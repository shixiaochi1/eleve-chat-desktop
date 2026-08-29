import { defineConfig } from 'vitest/config';
import path from 'node:path';

// 纯函数层单元测试（tool-row-model / lib/text）——零 React 依赖，node 环境即可。
// '@' alias 与 vite.config 的应用别名保持一致（tool-row-model import '@/lib/text'）。
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
