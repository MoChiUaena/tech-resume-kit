---
schemaVersion: 0.2.0
locale: zh-CN
person:
  name: 奶龙
  label: 2027 届本科
  target: Python 后端开发实习生
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
subtitle: 计算机科学与技术 · 本科
date: 2023.09 - 2027.06（预计）
```


GPA **3.72 / 4.00**，专业前 **10%**；主修课程：数据结构、数据库系统、计算机网络、软件工程。

## 专业技能 {#skills .skills}

- **语言基础**：使用类型标注、异步编程和 pytest；理解异常处理、迭代器及依赖隔离。
- **接口与数据**：使用 FastAPI、Pydantic 和 SQLAlchemy 开发接口，处理鉴权、事务与数据校验。
- **任务与部署**：使用 PostgreSQL、Redis、Docker 和 Linux，维护日志、定时任务及 CI 检查。

## 实习经历 {#internship .entries}

### 清澜信息

```yaml
subtitle: Python 后端实习生 · 数据服务组
date: 2026.06 - 2026.09
stack: FastAPI · PostgreSQL · Redis
```

- 交付报表查询、数据导入与导出接口，按用户权限隔离数据，补齐分页和错误定位。
- 为大文件导入增加分批写入和失败行报告，在固定 10 万行 CSV 上将内存峰值由 680 MB 降至 190 MB。

## 项目经历 {#projects .entries}

### TaskLane 异步任务平台

```yaml
subtitle: 独立开发
date: 2026.03 - 2026.06
stack: FastAPI · Celery · Redis · PostgreSQL
```

- 实现任务提交、执行进度和结果下载，支持取消与失败重试，限制用户并行任务数量。
- 以任务幂等键和数据库状态转换控制重复执行，增加超时回收和可追踪日志。
- 编写 24 个集成测试，覆盖重复提交、工作进程退出和重启后任务恢复。

### BookShelf 图书检索服务

```yaml
subtitle: 后端开发 · 2 人协作
date: 2026.07 - 2026.09
stack: Python · SQLAlchemy · pytest
```

- 设计图书、借阅与归还模型，使用事务和唯一约束处理并发借阅。
- 优化条件检索与索引，固定 5 万条数据评估查询耗时，并提供 OpenAPI 接口说明。

## 荣誉与其他 {#additional .lines}

CET-6：548 分；维护个人技术笔记；习惯通过测试和变更说明交付接口。
