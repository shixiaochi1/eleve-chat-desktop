# 测试文件 - 用于 patch 工具测试

def hello():
    print("Hello, Patch Tool!")
    print("测试成功")

def add(a, b):
    return a + b  # 已修改

def multiply(a, b):
    """两数相乘"""
    return a * b  # 乘法函数

def divide(a, b):
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b

# 结束
