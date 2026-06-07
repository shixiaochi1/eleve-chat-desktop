# 个人博客系统

一个简单但完整的博客系统，用于测试 Eleve Agent 的看板、子 Agent 和文件工具功能。

## 技术栈

- **前端**: HTML5 + CSS3 + JavaScript (原生)
- **后端**: Python Flask
- **存储**: JSON 文件

## 功能特性

- 📝 文章列表展示
- 📖 阅读文章详情
- ✏️ 撰写新文章
- 🗑️ 删除文章
- 📱 响应式设计

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 启动服务

```bash
python app.py
```

### 3. 访问系统

打开浏览器访问: http://localhost:5000

## 项目结构

```
blog-project/
├── app.py              # Flask 后端
├── requirements.txt    # 依赖
├── README.md           # 本文件
├── ARCHITECTURE.md     # 架构文档
├── data/
│   └── posts.json      # 文章数据
└── static/
    ├── index.html      # 首页
    ├── post.html       # 详情页
    ├── editor.html     # 编辑器
    ├── style.css       # 样式
    └── app.js          # 前端脚本
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/posts | 获取文章列表 |
| GET | /api/posts/<id> | 获取单篇文章 |
| POST | /api/posts | 创建文章 |
| DELETE | /api/posts/<id> | 删除文章 |

## 测试信息

- 创建时间: 2026-06-07
- 用途: Eleve Agent 功能测试
- 状态: 开发完成 ✅