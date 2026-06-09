#!/usr/bin/env python3
"""
简单文件测试工具
支持文件存在性检查、内容读取、行数统计
"""
import os
import sys


def check_file_exists(filepath: str) -> bool:
    """检查文件是否存在"""
    return os.path.exists(filepath)


def read_file(filepath: str) -> str:
    """读取文件内容"""
    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read()


def count_lines(filepath: str) -> int:
    """统计文件行数"""
    with open(filepath, 'r', encoding='utf-8') as f:
        return len(f.readlines())


def test_file(filepath: str) -> dict:
    """测试文件并返回结果"""
    result = {
        'filepath': filepath,
        'exists': False,
        'size': 0,
        'lines': 0,
        'content': None,
        'error': None
    }
    
    try:
        if not check_file_exists(filepath):
            result['error'] = '文件不存在'
            return result
        
        result['exists'] = True
        result['size'] = os.path.getsize(filepath)
        result['lines'] = count_lines(filepath)
        result['content'] = read_file(filepath)[:500]  # 限制显示前500字符
        
    except Exception as e:
        result['error'] = str(e)
    
    return result


if __name__ == '__main__':
    # 简单的命令行测试
    test_files = ['eleve_test.txt', 'test.txt', 'notexist.txt']
    
    print("=" * 50)
    print("File Test Tool")
    print("=" * 50)
    
    for f in test_files:
        print(f"\n[File] {f}")
        result = test_file(f)
        
        if result['error']:
            print(f"   [ERROR] {result['error']}")
        else:
            print(f"   [Exists] {result['exists']}")
            print(f"   [Size] {result['size']} bytes")
            print(f"   [Lines] {result['lines']}")