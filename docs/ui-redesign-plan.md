# Eleve 桌面前端 UI 美化方案

## 方案 C 设计要点

### 1. 背板效果

**核心特性：** 半透明毛玻璃 + 多层渐变光晕

```css
/* 背板基础样式 */
background: linear-gradient(
  135deg, 
  rgba(30, 60, 114, 0.7) 0%, 
  rgba(42, 82, 152, 0.7) 50%, 
  rgba(30, 60, 114, 0.7) 100%
);
backdrop-filter: blur(20px) saturate(1.2);
-webkit-backdrop-filter: blur(20px) saturate(1.2);
```

**渐变光晕层（4层径向渐变）：**
- 左上角：青色光晕 `rgba(56, 189, 248, 0.2)`
- 右下角：紫色光晕 `rgba(120, 80, 220, 0.18)`
- 中心：淡青色光晕 `rgba(56, 189, 248, 0.08)`
- 左下角：淡紫色光晕 `rgba(120, 80, 220, 0.1)`

**立体感增强（内阴影）：**
```css
box-shadow: 
  inset 0 1px 0 rgba(255, 255, 255, 0.08),    /* 顶部高光 */
  inset 0 -1px 0 rgba(0, 0, 0, 0.2),          /* 底部阴影 */
  inset 1px 0 0 rgba(255, 255, 255, 0.05),    /* 左侧高光 */
  inset -1px 0 0 rgba(0, 0, 0, 0.15),         /* 右侧阴影 */
  inset 0 0 80px rgba(0, 0, 0, 0.15);         /* 整体凹陷感 */
```

**噪点纹理：**
- SVG 噪点背景，opacity 0.4，模拟真实磨砂颗粒感

---

### 2. 三张卡片效果

**统一样式：**

```css
/* 基础样式 */
background: rgba(15, 31, 56, 0.92);
backdrop-filter: blur(20px);
-webkit-backdrop-filter: blur(20px);
border-radius: 12px;
border: 1px solid rgba(255, 255, 255, 0.15);
```

**多层阴影（立体感）：**
```css
box-shadow: 
  0 8px 32px rgba(0, 0, 0, 0.4),    /* 外层大阴影 */
  0 2px 8px rgba(0, 0, 0, 0.3),     /* 内层小阴影 */
  inset 0 1px 0 rgba(255, 255, 255, 0.05);  /* 顶部内发光 */
```

**顶部渐变光线描边（每张卡片独立颜色）：**

```css
/* 左侧会话面板 - 青色→紫色 */
background: linear-gradient(
  90deg, 
  transparent, 
  rgba(56, 189, 248, 0.5), 
  rgba(120, 80, 220, 0.3), 
  transparent
);

/* 中间聊天区 - 紫色→青色 */
background: linear-gradient(
  90deg, 
  transparent, 
  rgba(120, 80, 220, 0.5), 
  rgba(56, 189, 248, 0.3), 
  transparent
);

/* 右侧文件面板 - 青色→紫色 */
background: linear-gradient(
  90deg, 
  transparent, 
  rgba(56, 189, 248, 0.4), 
  rgba(120, 80, 220, 0.5), 
  transparent
);
```

**卡片间距：**
- 左侧卡片：`margin: 8px 0 8px 8px`
- 中间卡片：`margin: 8px`
- 右侧卡片：`margin: 8px 8px 8px 0`

---

### 3. 性能注意事项

- `backdrop-filter: blur()` 在滚动时会实时重算，中低端机器可能掉帧
- 建议：如果性能有问题，可将 `blur(20px)` 降至 `blur(15px)`，透明度从 0.7 提高到 0.8
- 卡片顶部渐变光线是静态的，几乎零性能消耗

---

### 4. 实现优先级

1. **背板效果**（最重要）：渐变 + 毛玻璃 + 光晕 + 内阴影
2. **卡片立体感**：多层阴影 + 顶部渐变光线
3. **其他细节**：后续再讨论

---

## 测试文件位置

`C:\Users\Administrator\前端UI测试\index.html`

可直接在浏览器打开查看效果对比。
