---
schemaVersion: 0.2.0
locale: zh-CN
person:
  name: 奶龙
  label: 2027 届本科
  target: 测试开发实习生
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


GPA **3.72 / 4.00**，专业前 **10%**；主修课程：软件测试、数据库系统、计算机网络、软件工程。

## 专业技能 {#skills .skills}

- **测试设计**：使用等价类、边界值和状态转换设计用例，关注数据一致性与异常恢复。
- **自动化**：使用 Python、pytest、Playwright 和 HTTP 接口测试，隔离测试数据并定位失败原因。
- **工程与性能**：使用 SQL、Linux、Git 和 CI；理解并发、吞吐、延迟分位数与压力测试边界。

## 实习经历 {#internship .entries}

### 栖云科技

```yaml
subtitle: 测试开发实习生 · 交易质量组
date: 2026.06 - 2026.09
stack: pytest · SQL · CI
```

- 为订单、退款和回调梳理正常与异常路径，补充超时、重复请求和状态回滚用例。
- 将 28 条核心接口用例接入 CI，提供失败日志和数据清理，缩短重复回归操作时间。

## 项目经历 {#projects .entries}

### TradeGuard 交易接口测试框架

```yaml
subtitle: 独立开发
date: 2026.03 - 2026.06
stack: Python · pytest · PostgreSQL
```

- 封装鉴权、请求和数据工厂，参数化校验接口响应与数据库状态，生成失败报告。
- 隔离并行测试数据，增加重试通知、部分成功和数据库回滚测试。
- 固定服务版本与数据，使用 20、50、100 并发记录吞吐和 P95，区分客户端与服务端瓶颈。

### PortalCheck 浏览器回归套件

```yaml
subtitle: 测试开发 · 2 人协作
date: 2026.07 - 2026.09
stack: Playwright · TypeScript · CI
```

- 覆盖登录、搜索、编辑和下载流程，使用稳定定位与显式等待，保存失败截图和追踪。
- 增加移动视口、键盘操作和网络异常场景，连续运行 30 次以排查不稳定用例。

## 荣誉与其他 {#additional .lines}

CET-6：546 分；校软件测试竞赛二等奖；提交问题时提供复现步骤和最小数据。
