---
schemaVersion: 0.2.0
locale: zh-CN
person:
  name: 奶龙
  label: 2027 届本科
  target: 前端开发实习生
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


GPA **3.72 / 4.00**，专业前 **10%**；主修课程：数据结构、计算机网络、软件工程、人机交互。

## 专业技能 {#skills .skills}

- **前端基础**：使用 HTML、CSS 和 TypeScript，理解浏览器渲染、事件循环与网络缓存。
- **应用开发**：使用 React、路由和状态管理完成页面开发，处理表单校验、请求取消与异常状态。
- **质量与协作**：使用 Vitest、Playwright 和 Git；关注键盘操作、响应式布局及性能指标。

## 实习经历 {#internship .entries}

### 栖云科技

```yaml
subtitle: 前端开发实习生 · 商家平台组
date: 2026.06 - 2026.09
stack: React · TypeScript · Vite
```

- 独立完成商品编辑和库存查询页面，覆盖加载、空数据、校验失败和服务异常四类状态。
- 抽取表单控件与请求封装，新增 16 个组件测试和 8 条浏览器用例，覆盖提交与返回编辑路径。

## 项目经历 {#projects .entries}

### CampusBoard 校园活动看板

```yaml
subtitle: 前端负责人 · 3 人协作
date: 2026.03 - 2026.06
stack: React · TypeScript · TanStack Query
```

- 完成活动检索、报名和个人中心，使用 URL 保存筛选状态，刷新后保留查询条件。
- 为快速切换筛选加入请求取消与缓存，避免旧结果覆盖新页面；用浏览器测试验证竞态。
- 对长列表采用分页和图片懒加载，在固定 500 条数据、模拟移动网络下将首屏加载由 2.8 秒降至 1.6 秒。

### PocketUI 轻量组件库

```yaml
subtitle: 独立开发
date: 2026.07 - 2026.09
stack: TypeScript · CSS · Vitest
```

- 实现按钮、输入框、对话框等 8 个组件，统一主题变量，并提供用法与交互状态示例。
- 补齐对话框焦点管理、键盘关闭及表单错误提示，验证窄屏和键盘操作。

## 荣誉与其他 {#additional .lines}

CET-6：562 分；校网页设计竞赛二等奖；通过代码审查和组件文档记录协作。
