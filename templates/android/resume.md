---
schemaVersion: 0.2.0
locale: zh-CN
person:
  name: 奶龙
  label: 2027 届本科
  target: Android 开发实习生
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


GPA **3.72 / 4.00**，专业前 **10%**；主修课程：数据结构、操作系统、移动应用开发、计算机网络。

## 专业技能 {#skills .skills}

- **移动基础**：使用 Kotlin、协程和 Flow，理解生命周期、线程切换与权限处理。
- **界面与数据**：使用 Jetpack Compose、ViewModel、Room 和 Retrofit，组织界面状态与本地缓存。
- **质量与协作**：使用 Git、JUnit 和 Android 测试工具，关注无网、旋转、重启及异常状态。

## 实习经历 {#internship .entries}

### 星桥软件

```yaml
subtitle: Android 实习生 · 移动客户端组
date: 2026.06 - 2026.09
stack: Kotlin · Compose · Retrofit
```

- 完成消息列表与详情页，处理分页、下拉刷新、错误重试和网络取消。
- 补充加载与空数据状态，在页面旋转和重复进入场景验证状态保留与请求次数。

## 项目经历 {#projects .entries}

### CampusPocket 校园日程应用

```yaml
subtitle: 独立开发
date: 2026.03 - 2026.06
stack: Kotlin · Compose · Room · WorkManager
```

- 实现日程创建、搜索和提醒，以 Room 保存数据，并为后台同步设置重试策略。
- 使用 Flow 组织列表状态，验证进程重启、离线编辑及联网后的同步结果。
- 编写 18 个单元测试和 6 条界面用例，覆盖重复保存、删除撤销与权限拒绝。

### ReadTrail 离线阅读器

```yaml
subtitle: 客户端开发 · 2 人协作
date: 2026.07 - 2026.09
stack: Kotlin · Coroutines · Retrofit
```

- 实现文章检索、收藏和离线阅读，记录阅读进度，区分缓存命中与网络刷新。
- 用分页和图片缓存改善滚动体验，在固定 300 篇文章的测试集中分析内存与掉帧。

## 荣誉与其他 {#additional .lines}

CET-6：552 分；校移动应用设计竞赛二等奖；可提供应用演示和测试记录。
