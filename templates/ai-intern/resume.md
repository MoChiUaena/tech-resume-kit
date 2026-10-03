---
schemaVersion: 0.2.0
locale: zh-CN
person:
  name: 奶龙
  label: 2027 届硕士
  target: AI / Agent 应用开发实习生
  availability: 意向城市：杭州 / 上海 · 每周 5 天 · 可实习 6 个月
  contacts:
    - text: nailong@example.com
      href: mailto:nailong@example.com
    - text: 项目与作品演示
      href: https://example.com/nailong
assets: {}
notice: 演示样张 · 人物、学校、经历和指标均为虚构。
---

## 教育背景 {#education .entries}

### 澄川理工大学

```yaml
subtitle: 软件工程 · 硕士
date: 2024.09 - 2027.06（预计）
```


GPA **3.72 / 4.00**，专业前 **10%**；主修课程：机器学习、信息检索、自然语言处理、分布式系统。

## 专业技能 {#skills .skills}

- **AI 应用**：使用 Python 构建 RAG 和工具调用流程，理解切分、检索、重排与引用溯源。
- **评估与数据**：整理标注数据和失败样例，分别评估检索召回、回答正确性、延迟与成本。
- **服务与工程**：使用 FastAPI、PostgreSQL、Docker 和 pytest，处理超时、重试与可观测日志。

## 实习经历 {#internship .entries}

### 清澜信息

```yaml
subtitle: AI 应用实习生 · 知识服务组
date: 2026.06 - 2026.09
stack: Python · FastAPI · pgvector
```

- 参与企业知识库检索服务，完成文档去重、增量索引和来源信息保存。
- 整理 120 条人工标注问题，按文档来源分组切分评估集，记录无答案与跨段检索失败样例。

## 项目经历 {#projects .entries}

### DocPilot 技术文档问答助手

```yaml
subtitle: 独立开发
date: 2026.03 - 2026.06
stack: RAG · 混合检索 · 重排 · SSE
```

- 实现文档解析、切分、混合检索和流式回答，展示引用片段，证据不足时返回无法回答。
- 在固定文档和 80 条标注问题上，比较切分与重排策略，Recall@5 从 68% 提升至 84%。
- 保存每次评估的文档版本和参数，分别统计检索、生成耗时及失败原因。

### IssueMate 工单辅助 Agent

```yaml
subtitle: 应用开发 · 2 人协作
date: 2026.07 - 2026.09
stack: Tool Calling · FastAPI · pytest
```

- 封装只读工单检索与状态查询工具，校验参数，限制调用次数并设置超时。
- 加入工具失败和越权请求测试，对草稿回复保留人工确认步骤，提供完整调用记录。

## 荣誉与其他 {#additional .lines}

CET-6：580 分；可阅读英文论文与技术文档；校创新项目优秀结项。
