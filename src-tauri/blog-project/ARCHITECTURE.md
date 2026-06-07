# 个人博客系统架构设计

## 1. 项目概述
- **项目名称**：个人博客系统
- **项目类型**：Web 全栈应用
- **核心功能**：文章发布、浏览、删除

## 2. 技术栈

### 前端
- HTML5
- CSS3 (原生)
- JavaScript (原生 ES6+)
- Fetch API (异步请求)

### 后端
- Python 3
- Flask 框架
- JSON 文件存储

## 3. 项目目录结构

```
blog-project/
├── app.py              # Flask 后端主程序
├── requirements.txt    # Python 依赖
├── ARCHITECTURE.md     # 本架构文档
├── README.md           # 项目说明
├── data/
│   └── posts.json      # 文章数据存储
└── static/
    ├── index.html      # 首页（文章列表）
    ├── post.html       # 文章详情页
    ├── editor.html     # 编辑器页面
    ├── style.css       # 样式文件
    └── app.js          # 前端逻辑
```

## 4. API 接口设计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/posts | 获取文章列表 |
| GET | /api/posts/<id> | 获取单篇文章 |
| POST | /api/posts | 创建文章 |
| DELETE | /api/posts/<id> | 删除文章 |

## 5. 数据模型

### Post (文章)
```json
{
  "id": "uuid",
  "title": "文章标题",
  "content": "文章内容",
  "author": "作者",
  "created_at": "创建时间戳",
  "updated_at": "更新时间戳"
}
```

## 6. 页面路由

| 路径 | 说明 |
|------|------|
| / | 首页 - 文章列表 |
| /post/<id> | 文章详情 |
| /editor | 发表文章 |