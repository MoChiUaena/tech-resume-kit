---
schemaVersion: 0.2.0
person:
  name: 陈以安
  label: 2027 届硕士
  target: AI / Agent 应用开发实习生
  availability: 意向城市：上海 / 杭州 · 每周 4 天 · 可实习 6 个月
  contacts:
    - text: yian.chen@example.com
      href: mailto:yian.chen@example.com
    - text: 技术笔记与项目演示
      href: https://example.com/yian
assets: {}
notice: 匿名演示样例 · 人物、院校、经历和全部指标均为虚构。
---

## 教育背景 {#education .entries}

### 海岑大学

```yaml
subtitle: 软件工程 · 硕士
date: "2024.09 - 2027.06（预计）"
```

研究方向：信息检索与软件工程；GPA **3.68 / 4.00**。本科期间获校优秀毕业生。

## 专业技能 {#skills .skills}

- **应用开发**：使用 Python、FastAPI、Java 和 Spring Boot 开发服务；能阅读 C++ 接口示例。
- **检索问答**：熟悉 RAG 的解析、切分、混合检索与重排；使用 pgvector 存储向量和元数据。
- **Agent**：掌握结构化输出、Tool Calling、状态持久化与人工确认节点，能设计任务失败处理。
- **工程质量**：使用 Pytest、Docker 和 GitHub Actions；通过固定数据集评估效果、成本与延迟。

## 项目经历 {#projects .entries}

### PaperTrail 论文检索与证据问答助手

```yaml
subtitle: 独立开发
date: "2026.03 - 2026.07"
stack: Python · FastAPI · PostgreSQL · pgvector · RAG
```

- 面向课程文献阅读，实现 PDF 解析、段落检索与带引用回答；在答案中保留论文页码及原文片段。
- 整理 **120 条问题**作为固定评测集，对比关键词、向量与混合检索；在同一数据集上，混合检索 Recall@5 达 **86%**，较纯向量方案提高 **9 个百分点**。
- 评估答案的证据覆盖率，证据不足时拒答；提供[演示说明](https://example.com/yian/papertrail)和可复现的评测配置。

### FlowNote 带人工确认的任务执行助手

```yaml
subtitle: 后端开发 · 2 人协作
date: "2026.07 - 2026.09"
stack: Python · Pydantic · SQLite · Tool Calling
```

- 将任务拆为检索、整理和导出步骤，使用显式状态机保存执行进度；中断后从已完成步骤继续执行。
- 为工具调用加入参数校验、超时和重试上限；写入文件前展示操作摘要，等待用户确认后执行。
- 编写 **26 个测试**覆盖无效参数、超时、重复执行和用户取消；用结构化日志追踪每次工具调用。

## 实习经历 {#internship .entries}

### 星涧软件

```yaml
subtitle: AI 应用开发实习生 · 企业知识服务组
date: "2026.06 - 2026.08"
stack: FastAPI · Elasticsearch · Redis · Pytest
```

- 参与知识库索引任务开发，负责文件去重、处理状态查询和失败重试，补充接口文档及集成测试。
- 将离线评测接入合并前检查，固定 **60 条回归问题**；在一次检索配置变更中定位并修复引用缺失问题。

## 荣誉与其他 {#additional .lines}

**语言能力**：CET-6 580 分，能阅读英文论文、技术文档并撰写问题复现说明。

**协作习惯**：维护设计说明、评测记录和复盘笔记；重视可核实的结果及明确的职责边界。
