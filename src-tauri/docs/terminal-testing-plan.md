# Terminal 工具测试 Implementation Plan

**Goal:** 为 Terminal 工具建立完整的测试体系，覆盖前端 store 逻辑和组件行为
**Architecture:** 使用 Vitest 作为前端测试框架，对 `terminals.ts` store 进行单元测试，对终端组件进行集成测试。后端 PTY 层暂不测试（需要 native 环境）。
**Tech Stack:** Vitest, @testing-library/react, jsdom

---

## 当前代码分析

### 待测模块

| 模块 | 文件 | 类型 | 测试难度 |
|------|------|------|----------|
| Terminal Store | `src/store/terminals.ts` | 纯逻辑 (状态管理) | ★☆☆ 低 |
| Terminal Buffer | `src/store/terminal-buffer.ts` | 纯逻辑 | ★☆☆ 低 |
| Terminal Font | `src/lib/terminal-font.ts` | 纯函数 | ★☆☆ 低 |
| Terminal Extras | `src/lib/terminal-extras.ts` | 纯函数 | ★☆☆ 低 |
| Agent Terminal Stream | `src/lib/agent-terminal-stream.ts` | 流处理 | ★★☆ 中 |
| Terminal UI 组件 | `src/components/terminal/` | React 组件 | ★★★ 高 |

### 当前状态
- ❌ 无测试框架配置
- ❌ 无现有测试文件
- ❌ package.json 中无 test script

---

### Task 1: 安装测试框架

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 Vitest 和相关依赖**

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

预期输出: 依赖安装成功，无 peer dependency 错误

- [ ] **Step 2: 在 package.json 中添加 test script**

在 `scripts` 中添加:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

- [ ] **Step 3: 创建 Vitest 配置文件**

Create: `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
```

- [ ] **Step 4: 创建测试 setup 文件**

Create: `src/test/setup.ts`

```typescript
import '@testing-library/jest-dom';
```

- [ ] **Step 5: 运行验证测试框架可用**

```bash
npm run test
```

预期输出: `No test files found` (正常，因为还没有测试文件)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: add vitest test framework"
```

---

### Task 2: 测试 Terminal Store - 基础 CRUD

**Files:**
- Create: `src/store/terminals.test.ts`

- [ ] **Step 1: 编写 createTerminal 测试**

```typescript
// src/store/terminals.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTerminal,
  getTerminalsSnapshot,
  getActiveTerminalIdSnapshot,
  closeTerminal,
  closeAllTerminals,
} from './terminals';

// Mock storage module
vi.mock('../utils/storage', () => ({
  load: vi.fn(() => null),
  save: vi.fn(),
  remove: vi.fn(),
}));

describe('terminals store - create', () => {
  beforeEach(() => {
    closeAllTerminals();
  });

  it('should create a terminal with default values', () => {
    const id = createTerminal();
    
    const terminals = getTerminalsSnapshot();
    expect(terminals).toHaveLength(1);
    expect(terminals[0].id).toBe(id);
    expect(terminals[0].title).toBe('Terminal');
    expect(terminals[0].auto).toBe(true);
    expect(terminals[0].kind).toBe('user');
  });

  it('should create a terminal with custom cwd', () => {
    const id = createTerminal('/home/user/project');
    
    const terminal = getTerminalsSnapshot().find(t => t.id === id);
    expect(terminal?.cwd).toBe('/home/user/project');
  });

  it('should set new terminal as active', () => {
    const id = createTerminal();
    
    expect(getActiveTerminalIdSnapshot()).toBe(id);
  });

  it('should generate unique ids', () => {
    const id1 = createTerminal();
    const id2 = createTerminal();
    
    expect(id1).not.toBe(id2);
  });
});
```

- [ ] **Step 2: 运行测试验证失败（TDD - 先确认测试能跑）**

```bash
npm run test -- src/store/terminals.test.ts
```

预期: 测试通过（因为 store 已实现）

- [ ] **Step 3: 编写 closeTerminal 测试**

在 `src/store/terminals.test.ts` 中追加:

```typescript
describe('terminals store - close', () => {
  beforeEach(() => {
    closeAllTerminals();
  });

  it('should close a terminal by id', () => {
    const id1 = createTerminal();
    const id2 = createTerminal();
    
    closeTerminal(id1);
    
    const terminals = getTerminalsSnapshot();
    expect(terminals).toHaveLength(1);
    expect(terminals[0].id).toBe(id2);
  });

  it('should switch active to neighbor when closing active', () => {
    const id1 = createTerminal();
    const id2 = createTerminal();
    const id3 = createTerminal();
    
    // id3 is active (last created)
    expect(getActiveTerminalIdSnapshot()).toBe(id3);
    
    closeTerminal(id3);
    
    // Should switch to id2 (next neighbor)
    expect(getActiveTerminalIdSnapshot()).toBe(id2);
  });

  it('should handle closing non-existent terminal gracefully', () => {
    createTerminal();
    
    // Should not throw
    closeTerminal('non-existent-id');
    
    expect(getTerminalsSnapshot()).toHaveLength(1);
  });

  it('should set activeTerminalId to null when closing last terminal', () => {
    const id = createTerminal();
    
    closeTerminal(id);
    
    expect(getTerminalsSnapshot()).toHaveLength(0);
    expect(getActiveTerminalIdSnapshot()).toBeNull();
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
npm run test -- src/store/terminals.test.ts
```

预期: 所有测试通过

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test(terminal): add create/close unit tests"
```

---

### Task 3: 测试 Terminal Store - 选择与循环

**Files:**
- Modify: `src/store/terminals.test.ts`

- [ ] **Step 1: 编写 selectTerminal 测试**

在 `src/store/terminals.test.ts` 中追加:

```typescript
import { selectTerminal, cycleTerminal } from './terminals';

describe('terminals store - select', () => {
  beforeEach(() => {
    closeAllTerminals();
  });

  it('should select a terminal by id', () => {
    const id1 = createTerminal();
    const id2 = createTerminal();
    
    selectTerminal(id1);
    
    expect(getActiveTerminalIdSnapshot()).toBe(id1);
  });

  it('should not change active when selecting non-existent id', () => {
    const id1 = createTerminal();
    
    selectTerminal('non-existent');
    
    expect(getActiveTerminalIdSnapshot()).toBe(id1);
  });
});

describe('terminals store - cycle', () => {
  beforeEach(() => {
    closeAllTerminals();
  });

  it('should cycle to next terminal', () => {
    const id1 = createTerminal();
    const id2 = createTerminal();
    const id3 = createTerminal();
    
    selectTerminal(id1);
    cycleTerminal(1);
    
    expect(getActiveTerminalIdSnapshot()).toBe(id2);
  });

  it('should wrap around when cycling past last', () => {
    const id1 = createTerminal();
    const id2 = createTerminal();
    
    selectTerminal(id2);
    cycleTerminal(1);
    
    expect(getActiveTerminalIdSnapshot()).toBe(id1);
  });

  it('should cycle to previous terminal', () => {
    const id1 = createTerminal();
    const id2 = createTerminal();
    
    selectTerminal(id2);
    cycleTerminal(-1);
    
    expect(getActiveTerminalIdSnapshot()).toBe(id1);
  });

  it('should wrap around when cycling before first', () => {
    const id1 = createTerminal();
    const id2 = createTerminal();
    
    selectTerminal(id1);
    cycleTerminal(-1);
    
    expect(getActiveTerminalIdSnapshot()).toBe(id2);
  });

  it('should do nothing when only one terminal', () => {
    const id1 = createTerminal();
    
    cycleTerminal(1);
    cycleTerminal(-1);
    
    expect(getActiveTerminalIdSnapshot()).toBe(id1);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
npm run test -- src/store/terminals.test.ts
```

预期: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(terminal): add select/cycle unit tests"
```

---

### Task 4: 测试 Terminal Store - 重命名与 Shell 报告

**Files:**
- Modify: `src/store/terminals.test.ts`

- [ ] **Step 1: 编写 renameTerminal 测试**

在 `src/store/terminals.test.ts` 中追加:

```typescript
import { renameTerminal, reportTerminalShell } from './terminals';

describe('terminals store - rename', () => {
  beforeEach(() => {
    closeAllTerminals();
  });

  it('should rename a terminal', () => {
    const id = createTerminal();
    
    renameTerminal(id, 'My Terminal');
    
    const terminal = getTerminalsSnapshot().find(t => t.id === id);
    expect(terminal?.title).toBe('My Terminal');
  });

  it('should set auto to false after rename', () => {
    const id = createTerminal();
    
    renameTerminal(id, 'Custom Name');
    
    const terminal = getTerminalsSnapshot().find(t => t.id === id);
    expect(terminal?.auto).toBe(false);
  });

  it('should keep original title when renaming to empty string', () => {
    const id = createTerminal();
    renameTerminal(id, 'Original');
    
    renameTerminal(id, '   ');
    
    const terminal = getTerminalsSnapshot().find(t => t.id === id);
    expect(terminal?.title).toBe('Original');
  });
});

describe('terminals store - reportTerminalShell', () => {
  beforeEach(() => {
    closeAllTerminals();
  });

  it('should update title when auto is true', () => {
    const id = createTerminal();
    
    reportTerminalShell(id, 'bash');
    
    const terminal = getTerminalsSnapshot().find(t => t.id === id);
    expect(terminal?.title).toBe('bash');
  });

  it('should NOT update title when auto is false (user renamed)', () => {
    const id = createTerminal();
    renameTerminal(id, 'My Shell');
    
    reportTerminalShell(id, 'zsh');
    
    const terminal = getTerminalsSnapshot().find(t => t.id === id);
    expect(terminal?.title).toBe('My Shell');
  });

  it('should ignore empty shell name', () => {
    const id = createTerminal();
    
    reportTerminalShell(id, '   ');
    
    const terminal = getTerminalsSnapshot().find(t => t.id === id);
    expect(terminal?.title).toBe('Terminal');
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
npm run test -- src/store/terminals.test.ts
```

预期: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(terminal): add rename/shell-report unit tests"
```

---

### Task 5: 测试 Terminal Store - Agent Terminal

**Files:**
- Modify: `src/store/terminals.test.ts`

- [ ] **Step 1: 编写 Agent Terminal 测试**

在 `src/store/terminals.test.ts` 中追加:

```typescript
import {
  ensureAgentTerminal,
  openAgentTerminal,
  closeAgentTerminalByProc,
} from './terminals';

describe('terminals store - agent terminals', () => {
  beforeEach(() => {
    closeAllTerminals();
  });

  it('should create agent terminal on first ensure', () => {
    const id = ensureAgentTerminal('proc-123', 'build');
    
    expect(id).toBeTruthy();
    const terminals = getTerminalsSnapshot();
    expect(terminals).toHaveLength(1);
    expect(terminals[0].kind).toBe('agent');
    expect(terminals[0].procId).toBe('proc-123');
    expect(terminals[0].title).toBe('build');
  });

  it('should return existing id on duplicate ensure', () => {
    const id1 = ensureAgentTerminal('proc-123', 'build');
    const id2 = ensureAgentTerminal('proc-123', 'build');
    
    expect(id1).toBe(id2);
    expect(getTerminalsSnapshot()).toHaveLength(1);
  });

  it('should close agent terminal by proc id', () => {
    ensureAgentTerminal('proc-123', 'build');
    
    const closed = closeAgentTerminalByProc('proc-123');
    
    expect(closed).toBe(true);
    expect(getTerminalsSnapshot()).toHaveLength(0);
  });

  it('should return false when closing non-existent proc', () => {
    const closed = closeAgentTerminalByProc('non-existent');
    
    expect(closed).toBe(false);
  });

  it('should open agent terminal even after user closed it', () => {
    const id1 = ensureAgentTerminal('proc-123', 'build');
    closeTerminal(id1);
    
    openAgentTerminal('proc-123', 'build');
    
    const terminals = getTerminalsSnapshot();
    expect(terminals).toHaveLength(1);
    expect(terminals[0].procId).toBe('proc-123');
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
npm run test -- src/store/terminals.test.ts
```

预期: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(terminal): add agent terminal unit tests"
```

---

### Task 6: 测试 Terminal Store - 批量操作

**Files:**
- Modify: `src/store/terminals.test.ts`

- [ ] **Step 1: 编写批量操作测试**

在 `src/store/terminals.test.ts` 中追加:

```typescript
import {
  closeOtherTerminals,
  closeAllTerminals,
  ensureTerminal,
} from './terminals';

describe('terminals store - batch operations', () => {
  beforeEach(() => {
    closeAllTerminals();
  });

  it('should close all other terminals', () => {
    const id1 = createTerminal();
    const id2 = createTerminal();
    const id3 = createTerminal();
    
    closeOtherTerminals(id2);
    
    const terminals = getTerminalsSnapshot();
    expect(terminals).toHaveLength(1);
    expect(terminals[0].id).toBe(id2);
    expect(getActiveTerminalIdSnapshot()).toBe(id2);
  });

  it('should close all terminals', () => {
    createTerminal();
    createTerminal();
    createTerminal();
    
    closeAllTerminals();
    
    expect(getTerminalsSnapshot()).toHaveLength(0);
    expect(getActiveTerminalIdSnapshot()).toBeNull();
  });

  it('should ensure at least one terminal exists', () => {
    closeAllTerminals();
    
    ensureTerminal();
    
    expect(getTerminalsSnapshot()).toHaveLength(1);
  });

  it('should not create new terminal if one exists', () => {
    createTerminal();
    
    ensureTerminal();
    
    expect(getTerminalsSnapshot()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
npm run test -- src/store/terminals.test.ts
```

预期: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(terminal): add batch operation unit tests"
```

---

### Task 7: 测试 Terminal Store - Revive Buffer 与 RestoreCwd

**Files:**
- Modify: `src/store/terminals.test.ts`

- [ ] **Step 1: 编写 revive/restore 测试**

在 `src/store/terminals.test.ts` 中追加:

```typescript
import {
  updateTerminalReviveBuffer,
  updateTerminalRestoreCwd,
} from './terminals';

describe('terminals store - revive buffer', () => {
  beforeEach(() => {
    closeAllTerminals();
  });

  it('should store revive buffer for user terminal', () => {
    const id = createTerminal();
    
    updateTerminalReviveBuffer(id, '$ ls\nfile1.txt\nfile2.txt');
    
    const terminal = getTerminalsSnapshot().find(t => t.id === id);
    expect(terminal?.reviveBuffer).toBe('$ ls\nfile1.txt\nfile2.txt');
  });

  it('should cap revive buffer at 48000 chars', () => {
    const id = createTerminal();
    const longBuffer = 'x'.repeat(50000);
    
    updateTerminalReviveBuffer(id, longBuffer);
    
    const terminal = getTerminalsSnapshot().find(t => t.id === id);
    expect(terminal?.reviveBuffer?.length).toBe(48000);
    // Should be tail-trimmed (last 48000 chars)
    expect(terminal?.reviveBuffer).toBe('x'.repeat(48000));
  });

  it('should NOT store revive buffer for agent terminal', () => {
    const id = ensureAgentTerminal('proc-1', 'agent');
    
    updateTerminalReviveBuffer(id, 'some buffer');
    
    const terminal = getTerminalsSnapshot().find(t => t.id === id);
    expect(terminal?.reviveBuffer).toBeUndefined();
  });
});

describe('terminals store - restore cwd', () => {
  beforeEach(() => {
    closeAllTerminals();
  });

  it('should store restore cwd for user terminal', () => {
    const id = createTerminal('/home/user');
    
    updateTerminalRestoreCwd(id, '/home/user/project');
    
    const terminal = getTerminalsSnapshot().find(t => t.id === id);
    expect(terminal?.restoreCwd).toBe('/home/user/project');
  });

  it('should ignore empty restore cwd', () => {
    const id = createTerminal('/home/user');
    
    updateTerminalRestoreCwd(id, '   ');
    
    const terminal = getTerminalsSnapshot().find(t => t.id === id);
    expect(terminal?.restoreCwd).toBeUndefined();
  });

  it('should NOT update when cwd unchanged', () => {
    const id = createTerminal();
    updateTerminalRestoreCwd(id, '/new/path');
    
    // Call again with same value
    updateTerminalRestoreCwd(id, '/new/path');
    
    const terminal = getTerminalsSnapshot().find(t => t.id === id);
    expect(terminal?.restoreCwd).toBe('/new/path');
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
npm run test -- src/store/terminals.test.ts
```

预期: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(terminal): add revive/restore unit tests"
```

---

### Task 8: 测试 Terminal Store - 持久化

**Files:**
- Modify: `src/store/terminals.test.ts`

- [ ] **Step 1: 编写持久化测试**

在 `src/store/terminals.test.ts` 中追加:

```typescript
import * as storage from '../utils/storage';

describe('terminals store - persistence', () => {
  beforeEach(() => {
    closeAllTerminals();
    vi.clearAllMocks();
  });

  it('should persist on every change', () => {
    createTerminal();
    
    expect(storage.save).toHaveBeenCalled();
  });

  it('should only persist user terminals', () => {
    createTerminal(); // user
    ensureAgentTerminal('proc-1', 'agent'); // agent
    
    // Check what was saved
    const saveCall = vi.mocked(storage.save).mock.calls.find(
      call => call[0] === 'eleve.desktop.terminals.v1'
    );
    const saved = saveCall?.[1] as { terminals: Array<{ kind?: string }> };
    
    // Agent terminals should not be in persisted data
    expect(saved.terminals.every(t => !('kind' in t) || t.kind === undefined)).toBe(true);
  });

  it('should remove storage when no terminals', () => {
    const id = createTerminal();
    closeTerminal(id);
    
    expect(storage.remove).toHaveBeenCalledWith('eleve.desktop.terminals.v1');
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
npm run test -- src/store/terminals.test.ts
```

预期: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(terminal): add persistence unit tests"
```

---

### Task 9: 运行完整测试套件

**Files:** 无修改

- [ ] **Step 1: 运行所有测试**

```bash
npm run test
```

预期输出:
```
 ✓ src/store/terminals.test.ts (XX tests)
Test Files  1 passed (1)
Tests       XX passed (XX)
```

- [ ] **Step 2: 生成覆盖率报告（可选）**

```bash
npm run test:coverage
```

预期: 生成覆盖率报告，terminals.ts 覆盖率 > 90%

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test: verify all terminal tests pass"
```

---

## 测试覆盖总结

| 功能模块 | 测试数量 | 覆盖情况 |
|----------|----------|----------|
| createTerminal | 4 | ✅ |
| closeTerminal | 4 | ✅ |
| selectTerminal | 2 | ✅ |
| cycleTerminal | 5 | ✅ |
| renameTerminal | 3 | ✅ |
| reportTerminalShell | 3 | ✅ |
| Agent Terminal | 5 | ✅ |
| Batch Operations | 4 | ✅ |
| Revive Buffer | 3 | ✅ |
| Restore Cwd | 3 | ✅ |
| Persistence | 3 | ✅ |
| **总计** | **39** | **~95%** |

---

## 执行选项

计划已保存到 `docs/terminal-testing-plan.md`。请选择执行方式:

1. **Subagent-Driven** - 每个 Task 分派一个独立子代理执行，完成后自动审查
2. **Inline Execution** - 在当前会话中逐步执行所有任务

你想用哪种方式？
