// Shared by the editor, command line and project initialization.
export const starterTemplates = Object.freeze([
  {
    "id": "blank",
    "label": "空白填写模板",
    "subtitle": "一页 · 自己填写",
    "description": "保留填写提示，从自己的信息开始。",
    "directory": "templates/blank",
    "category": "通用起点"
  },
  {
    "id": "campus",
    "label": "奶龙校招样张",
    "subtitle": "一页 · 照片与校徽",
    "description": "教育、实习、项目与技能的完整校招示例。",
    "directory": ".",
    "category": "通用起点"
  },
  {
    "id": "experience",
    "label": "两页工作经验",
    "subtitle": "两页 · 工作经历优先",
    "description": "参考多段工作与项目成果的编排。",
    "directory": "examples/experienced",
    "category": "通用起点"
  },
  {
    "id": "frontend",
    "label": "前端开发样张",
    "subtitle": "一页 · 无照片",
    "description": "页面交互、组件测试与前端性能优化。",
    "directory": "templates/frontend",
    "category": "岗位样张"
  },
  {
    "id": "java-backend",
    "label": "Java 后端样张",
    "subtitle": "一页 · 照片与校徽",
    "description": "接口、事务、缓存与并发一致性。",
    "directory": "templates/java-backend",
    "category": "岗位样张"
  },
  {
    "id": "python-backend",
    "label": "Python 后端样张",
    "subtitle": "一页 · 无照片",
    "description": "异步接口、后台任务与数据处理。",
    "directory": "templates/python-backend",
    "category": "岗位样张"
  },
  {
    "id": "ai-intern",
    "label": "AI 应用开发样张",
    "subtitle": "一页 · 无照片",
    "description": "RAG、工具调用与效果评估。",
    "directory": "templates/ai-intern",
    "category": "岗位样张"
  },
  {
    "id": "data-analyst",
    "label": "数据分析样张",
    "subtitle": "一页 · 无照片",
    "description": "SQL、指标口径、分析报告与可视化。",
    "directory": "templates/data-analyst",
    "category": "岗位样张"
  },
  {
    "id": "qa-engineer",
    "label": "测试开发样张",
    "subtitle": "一页 · 无照片",
    "description": "接口自动化、浏览器回归与性能测试。",
    "directory": "templates/qa-engineer",
    "category": "岗位样张"
  },
  {
    "id": "android",
    "label": "Android 开发样张",
    "subtitle": "一页 · 照片与校徽",
    "description": "移动界面、离线数据与生命周期。",
    "directory": "templates/android",
    "category": "岗位样张"
  }
].map(template => Object.freeze(template)));

export const findStarterTemplate = id => starterTemplates.find(template => template.id === id);
