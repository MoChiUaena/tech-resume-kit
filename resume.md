---
schemaVersion: 0.2.0
locale: zh-CN
person:
  name: 奶龙
  label: 2027 届本科
  target: Java 后端 / AI 应用开发实习生
  availability: 意向城市：杭州 / 上海 · 每周 5 天 · 可实习 6 个月
  contacts:
    - text: 138 0000 0000
      href: tel:13800000000
    - text: zhixia.lin@example.com
      href: mailto:zhixia.lin@example.com
    - text: 作品集：example.com/linzhixia
      href: https://example.com/linzhixia
assets:
  schoolLogo:
    src: assets/images/chengchuan-logo.png
    alt: 澄川理工大学自制虚构学校标识
  portrait:
    src: assets/images/nailong-avatar.jpg
    alt: 奶龙角色头像，来源为 B 站用户头像
notice: 演示样张 · 姓名、学校、经历及指标均为虚构；奶龙头像为第三方角色图片。
---

## 教育背景 {#education .entries}

### 澄川理工大学

```yaml
subtitle: 计算机科学与技术 · 本科
date: 2023.09 - 2027.06（预计）
```

GPA **3.72 / 4.00**，专业前 **10%**；连续两年获校级一等奖学金。

主修课程：数据结构、操作系统、计算机网络、数据库系统、软件工程。

## 专业技能 {#skills .skills}

- **Java 后端**：熟悉集合、泛型、线程池与 JVM 基础；使用 Spring Boot、MyBatis 开发 REST API。
- **数据存储**：掌握 MySQL 索引、事务与执行计划分析；使用 Redis 实现缓存、限流与幂等控制。
- **AI 应用**：使用 Python、FastAPI 构建 RAG 流程；理解向量检索、重排、工具调用与效果评估。
- **工程实践**：熟悉 Git、Linux、Docker；使用 JUnit、Testcontainers 编写测试，维护 CI 构建。

## 实习经历 {#internship .entries}

### 栖云科技

```yaml
subtitle: Java 后端开发实习生 · 交易平台组
date: 2026.06 - 2026.09
stack: Spring Boot · MySQL · Redis · RabbitMQ
```

- 参与订单查询与售后接口开发，独立完成 **6 个接口**的需求拆解、编码及联调，补齐参数校验和异常码。
- 针对订单列表慢查询，结合 EXPLAIN 优化联合索引并消除 N+1 查询；在 **10 万条测试数据、50 并发**下，P95 延迟由 **420 ms 降至 170 ms**。
- 为退款回调引入唯一业务键与状态校验，配合消息重试处理重复通知；新增 **18 个集成测试**，覆盖重复消费、超时和回滚路径。

## 项目经历 {#projects .entries}

### CampusHub 校园活动预约平台

```yaml
subtitle: 后端负责人 · 3 人协作
date: 2026.03 - 2026.06
stack: Java 21 · Spring Boot · MySQL · Redis · Docker
```

- 实现活动发布、预约与签到；负责数据模型、鉴权和预约模块，交付 **22 个 API**。
- 使用 Redis Lua 原子预占名额，数据库唯一约束防止重复预约；设计超时释放与定时核对，补偿缓存和数据库之间的状态差异。
- 用 Testcontainers 验证竞态与补偿；本地 **200 并发、1,000 个名额**压测未见超卖。

### DocPilot 技术文档问答助手

```yaml
subtitle: 独立开发
date: 2026.07 - 2026.09
stack: Python · FastAPI · pgvector · RAG · Tool Calling
```

- 实现解析、切分、混合检索与重排，支持流式输出和引用溯源；证据不足时拒答。
- 整理 **80 条人工标注问答**，固定文档与模型后比较检索方案，Recall@5 从 **68% 提升至 84%**；记录失败样例，迭代切分策略。
- 封装只读检索工具，加入参数校验、超时与调用上限；用结构化日志定位各阶段耗时。

## 荣誉与其他 {#additional .lines}

**竞赛与荣誉**　校程序设计竞赛二等奖（2025）；校优秀学生（2024、2025）。

**英语与协作**　CET-6：562 分；可阅读英文技术文档，习惯通过 Issue、PR 与设计说明记录协作。
