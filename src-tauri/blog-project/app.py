"""
个人博客系统 - Flask 后端
"""
import os
import json
import uuid
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory, render_template

app = Flask(__name__, static_folder='static')

# 数据文件路径
DATA_FILE = os.path.join(os.path.dirname(__file__), 'data', 'posts.json')


def load_posts():
    """加载文章列表"""
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_posts(posts):
    """保存文章列表"""
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(posts, f, ensure_ascii=False, indent=2)


def generate_id():
    """生成唯一ID"""
    return str(uuid.uuid4())


# 页面路由
@app.route('/')
def index():
    """首页"""
    return send_from_directory('static', 'index.html')


@app.route('/editor')
def editor():
    """编辑器页面"""
    return send_from_directory('static', 'editor.html')


@app.route('/post/<post_id>')
def post_detail(post_id):
    """文章详情页面"""
    return send_from_directory('static', 'post.html')


# 静态文件服务
@app.route('/static/<path:filename>')
def static_files(filename):
    """静态文件服务"""
    return send_from_directory('static', filename)


# API 接口
@app.route('/api/posts', methods=['GET'])
def get_posts():
    """获取文章列表"""
    posts = load_posts()
    # 按创建时间倒序排列
    posts.sort(key=lambda x: x.get('created_at', 0), reverse=True)
    return jsonify(posts)


@app.route('/api/posts/<post_id>', methods=['GET'])
def get_post(post_id):
    """获取单篇文章"""
    posts = load_posts()
    for post in posts:
        if post['id'] == post_id:
            return jsonify(post)
    return jsonify({'error': '文章不存在'}), 404


@app.route('/api/posts', methods=['POST'])
def create_post():
    """创建文章"""
    data = request.get_json()
    
    if not data:
        return jsonify({'error': '无效的请求数据'}), 400
    
    title = data.get('title', '').strip()
    author = data.get('author', '').strip()
    content = data.get('content', '').strip()
    
    if not title or not author or not content:
        return jsonify({'error': '标题、作者和内容不能为空'}), 400
    
    posts = load_posts()
    timestamp = int(datetime.now().timestamp())
    
    new_post = {
        'id': generate_id(),
        'title': title,
        'author': author,
        'content': content,
        'created_at': timestamp,
        'updated_at': timestamp
    }
    
    posts.append(new_post)
    save_posts(posts)
    
    return jsonify(new_post), 201


@app.route('/api/posts/<post_id>', methods=['DELETE'])
def delete_post(post_id):
    """删除文章"""
    posts = load_posts()
    
    for i, post in enumerate(posts):
        if post['id'] == post_id:
            posts.pop(i)
            save_posts(posts)
            return jsonify({'message': '删除成功'})
    
    return jsonify({'error': '文章不存在'}), 404


@app.errorhandler(404)
def not_found(error):
    """404 错误处理"""
    return jsonify({'error': '页面不存在'}), 404


@app.errorhandler(500)
def internal_error(error):
    """500 错误处理"""
    return jsonify({'error': '服务器内部错误'}), 500


if __name__ == '__main__':
    # 确保数据目录存在
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    
    # 如果数据文件不存在，创建空数组
    if not os.path.exists(DATA_FILE):
        save_posts([])
    
    print("=" * 50)
    print("博客系统已启动!")
    print("访问地址: http://localhost:5000")
    print("=" * 50)
    
    app.run(host='0.0.0.0', port=5000, debug=True)