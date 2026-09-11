# HuaBu Infinite Canvas 底座第一轮验收

日期：2026-09-11
工作目录：`D:\codex\HuaBuInfiniteCanvas`
应用地址：`http://127.0.0.1:3011/`

## 检查结果

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 上游生产构建 | 通过 | `npm run build` |
| TypeScript | 通过 | `npm run typecheck` |
| 工具栏即时创建 | 通过 | 点击 `aria-label="文本"` 一次，节点数为 1 |
| 背景右键创建菜单 | 通过 | 空白处右键出现 `选择节点` |
| 菜单即时创建 | 通过 | 菜单点击 `文本` 后节点数为 2 |
| 输出到输入连线 | 通过 | `[data-connection-id]` 数量为 1 |
| 连线刷新持久化 | 通过 | 刷新后 `[data-connection-id]` 数量仍为 1 |
| 反向手柄连线 | 通过 | 反向拖拽后 edge path 方向从源节点指向目标节点 |
| 移动端宽度 | 通过 | 390px 下 body scrollWidth 为 390 |
| 控制台错误 | 通过 | 本轮脚本收集到 0 条 console error |
| 主页提示词社区入口 | 通过 | 点击 `进入提示词社区` 后进入 `/prompts` |
| 主页文案渲染 | 通过 | 不再显示旧 `<canvas>` / `<content>` 标记 |
| diff 格式 | 通过 | `git diff --check` |

## 本轮改动

- 连接手柄使用 Pointer Events 完成拖拽收尾，避免只依赖 mouseup 导致连接丢失。
- 连接方向按源/目标手柄归一化，配置节点仍保持目标语义。
- 空白画布右键直接打开上游注册表驱动的 `NodeCreateMenu`。
- 创建菜单通过 portal 以 fixed surface 显示，避免随画布缩放而变形或裁切。
- 工具栏继续直接调用上游 `createNode`，不再引入二次点击状态。
- 编辑输入框右键不被节点上下文菜单拦截。
- 修复上游现存的 antd 6 `Modal.styles.content` 类型错误。

## 证据文件

- `docs/planning/canvas-after-fixes.png`
- `docs/planning/upstream-baseline.png`
- `docs/planning/audit-1440x960-home.png`
- `docs/planning/audit-390x844-home.png`
- `docs/planning/audit-1440x960-canvas.png`
- `docs/planning/audit-1440x960-config.png`
- `docs/planning/audit-390x568-config.png`

## 未宣称事项

本验收证明上游底座及画布交互链路可运行，不证明任何真实第三方 Provider 已生成成功，也不证明 Nova 的业务能力已经迁移完成。
