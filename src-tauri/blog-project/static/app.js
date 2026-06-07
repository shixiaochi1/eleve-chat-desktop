// 博客系统前端脚本

const API_BASE = '/api/posts';

// 加载文章列表
async function loadPosts() {
    const container = document.getElementById('postsList');
    try {
        const response = await fetch(API_BASE);
        const posts = await response.json();
        
        if (!posts || posts.length === 0) {
            container.innerHTML = `
                <h2>最新文章</h2>
                <div class="empty-state">
                    <p>还没有文章，快去 <a href="/editor">写文章</a> 吧！</p>
                </div>
            `;
            return;
        }
        
        const postsHtml = posts.map(post => `
            <div class="post-card">
                <h3><a href="/post/${post.id}">${escapeHtml(post.title)}</a></h3>
                <div class="post-meta">
                    作者：${escapeHtml(post.author)} | 
                    ${formatDate(post.created_at)}
                </div>
                <p class="post-excerpt">${escapeHtml(post.content.substring(0, 100))}...</p>
            </div>
        `).join('');
        
        container.innerHTML = `<h2>最新文章</h2>${postsHtml}`;
    } catch (error) {
        container.innerHTML = `
            <div class="empty-state">
                <p>加载文章失败，请确保后端服务正在运行。</p>
            </div>
        `;
        console.error('Error loading posts:', error);
    }
}

// 加载单篇文章
async function loadPost(postId) {
    const container = document.getElementById('postDetail');
    try {
        const response = await fetch(`${API_BASE}/${postId}`);
        
        if (!response.ok) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>文章不存在或已被删除。</p>
                    <a href="/" class="btn">返回首页</a>
                </div>
            `;
            return;
        }
        
        const post = await response.json();
        
        container.innerHTML = `
            <h1>${escapeHtml(post.title)}</h1>
            <div class="post-meta">
                作者：${escapeHtml(post.author)} | 
                创建时间：${formatDate(post.created_at)}
                ${post.updated_at ? ' | 更新时间：' + formatDate(post.updated_at) : ''}
            </div>
            <div class="post-content">${escapeHtml(post.content)}</div>
            <div class="post-actions">
                <button class="btn btn-danger" onclick="deletePost('${post.id}')">删除文章</button>
                <a href="/" class="btn btn-secondary">返回首页</a>
            </div>
        `;
        
        // 更新页面标题
        document.title = `${post.title} - 我的博客`;
    } catch (error) {
        container.innerHTML = `
            <div class="empty-state">
                <p>加载文章失败。</p>
            </div>
        `;
        console.error('Error loading post:', error);
    }
}

// 提交新文章
async function handleSubmit(event) {
    event.preventDefault();
    
    const form = event.target;
    const messageEl = document.getElementById('message');
    const submitBtn = form.querySelector('button[type="submit"]');
    
    const postData = {
        title: form.title.value,
        author: form.author.value,
        content: form.content.value
    };
    
    // 禁用提交按钮
    submitBtn.disabled = true;
    submitBtn.textContent = '发布中...';
    
    try {
        const response = await fetch(API_BASE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(postData)
        });
        
        if (response.ok) {
            messageEl.className = 'success';
            messageEl.textContent = '文章发布成功！正在跳转...';
            form.reset();
            setTimeout(() => {
                window.location.href = '/';
            }, 1500);
        } else {
            throw new Error('发布失败');
        }
    } catch (error) {
        messageEl.className = 'error';
        messageEl.textContent = '发布失败，请重试。';
        console.error('Error creating post:', error);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '发布文章';
    }
}

// 删除文章
async function deletePost(postId) {
    if (!confirm('确定要删除这篇文章吗？')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/${postId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            alert('文章已删除');
            window.location.href = '/';
        } else {
            throw new Error('删除失败');
        }
    } catch (error) {
        alert('删除失败，请重试。');
        console.error('Error deleting post:', error);
    }
}

// 工具函数：HTML 转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 工具函数：格式化日期
function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}