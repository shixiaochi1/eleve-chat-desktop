# 个人技术博客 - 技术规格文档

## 1. 技术栈选择

### 推荐方案：静态博客 + Hexo

- **框架**: Hexo
- **主题**: Butterfly
- **部署**: GitHub Pages + Vercel CDN
- **域名**: 使用现有的域名

### 备选方案
- 动态博客：WordPress / Typecho
- 源码构建：VuePress / VitePress

## 2. 功能需求

### 必选功能
- [ ] 文章列表展示
- [ ] 文章详情页
- [ ] 分类与标签
- [ ] 搜索功能
- [ ] 评论系统 (Valine/Gitalk)
- [ ] 暗色主题

### 可选功能
- [ ] 访问统计 (不蒜子)
- [ ] RSS 订阅
- [ ] 归档页面
- [ ] 关于页面

## 3. 部署方案

### 部署流程
1. 开发环境：本地 Hexo 服务
2. 构建：`hexo generate`
3. 部署：推送到 GitHub 仓库
4. CDN：Vercel 自动部署

### CI/CD
- 使用 GitHub Actions 自动构建部署
- 每次 push 自动部署

## 4. 里程碑

- [ ] Day 1: 本地环境搭建
- [ ] Day 2: 主题配置
- [ ] Day 3: 插件集成
- [ ] Day 4: 部署上线

---
*创建时间：2026-06-07*
*状态：待确认技术选型*