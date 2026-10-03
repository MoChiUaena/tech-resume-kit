---
schemaVersion: 0.2.0
locale: zh-CN
person:
  name: 奶龙
  label: 2027 届本科
  target: Java 后端开发实习生
  availability: 意向城市：杭州 / 上海 · 每周 5 天 · 可实习 6 个月
  contacts:
    - text: nailong@example.com
      href: mailto:nailong@example.com
    - text: 项目与作品演示
      href: https://example.com/nailong
assets:
  schoolLogo:
    src: assets/images/chengchuan-logo.png
    alt: 澄川理工大学虚构学校标识
  portrait:
    src: assets/images/nailong-avatar.jpg
    alt: 奶龙白底正面头像
notice: 演示样张 · 人物、学校、经历和指标均为虚构。
---

## 教育背景 {#education .entries}

### 澄川理工大学

```yaml
subtitle: 计算机科学与技术 · 本科
date: 2023.09 - 2027.06（预计）
```


GPA **3.72 / 4.00**，专业前 **10%**；主修课程：数据结构、操作系统、计算机网络、数据库系统。

## 专业技能 {#skills .skills}

- **语言基础**：熟悉集合、线程池和 JVM 基础；使用 Spring Boot、MyBatis 开发 REST API。
- **数据与缓存**：理解 MySQL 事务、联合索引和执行计划；使用 Redis 实现缓存与限流。
- **工程实践**：使用 Git、Linux、Docker、JUnit 和 Testcontainers，编写接口与集成测试。

## 实习经历 {#internship .entries}

### 栖云科技

```yaml
subtitle: Java 后端实习生 · 交易平台组
date: 2026.06 - 2026.09
stack: Spring Boot · MySQL · Redis
```

- 完成订单查询与售后接口，补齐参数校验、鉴权和统一异常码，交付 6 个业务接口。
- 优化索引并消除 N+1 查询，在 10 万条测试数据、50 并发下将查询 P95 从 420 ms 降至 170 ms。

## 项目经历 {#projects .entries}

### CampusHub 校园预约平台

```yaml
subtitle: 后端负责人 · 3 人协作
date: 2026.03 - 2026.06
stack: Java · Spring Boot · MySQL · Redis
```

- 设计活动、预约和签到数据模型，实现用户鉴权、活动检索及预约接口。
- 用唯一约束和 Redis 原子操作处理重复预约，增加超时释放与定时核对。
- 使用 Testcontainers 验证并发和回滚，固定 1,000 个名额、200 并发测试未出现超卖。

### NotifyFlow 消息通知服务

```yaml
subtitle: 独立开发
date: 2026.07 - 2026.09
stack: RabbitMQ · MySQL · Docker
```

- 实现消息提交、消费和状态查询，以业务键约束重复请求，并记录每次发送结果。
- 补充重试、失败隔离和人工重放，新增 18 个测试覆盖重复消费、超时及异常回滚。

## 荣誉与其他 {#additional .lines}

CET-6：562 分；校程序设计竞赛二等奖；可阅读英文技术文档。
