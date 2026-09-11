# HuaBu Infinite Canvas 底座执行进度

更新时间：2026-09-11

## 当前状态

- [x] 已确认用户要求：以 `basketikun/infinite-canvas` 真实源码作为底座。
- [x] 已核对上游 commit：`d213a74614e0e4bd8a26383d1e1e907249e9c61b`，v0.18.0。
- [x] 已创建独立工作副本：`D:\codex\HuaBuInfiniteCanvas`。
- [x] 已冷保存执行计划和反方审查。
- [x] 上游依赖安装与基线构建（npm peer 冲突下用 `--legacy-peer-deps` 安装，未改 lockfile；typecheck/build 已通过）。
- [x] 上游实际启动和浏览器基线验收。
- [x] 四个交互问题第一轮修复并完成浏览器验收。
- [ ] HuaBu 能力映射与最小纵切迁移。
- [x] 底座第一轮对抗性回归验收。

## 保护边界

- `D:\codex\HuaBuNova` 不作为新底座，不覆盖、不删除。
- `D:\codex\HuaBu` 保持原状，除非后续明确批准迁移。
- 新副本保留 upstream Git 历史和远程，暂不公开 fork 或推送。

## 已验证证据

- 工具栏点击 `文本` 一次后，画布节点数量从 0 变为 1。
- 空白画布右键后出现 `选择节点` 创建菜单；点击菜单中的 `文本` 后立即出现第二个节点。
- 输出手柄拖到输入手柄后出现 1 条真实连接；刷新页面后仍为 1 条。
- 反向从输入手柄拖到另一节点的输出手柄也能形成 1 条连接，方向按语义归一化。
- 390px 视口下 `document.body.scrollWidth === innerWidth`，本轮浏览器控制台无 error。
- 截图：`canvas-after-fixes.png`。

## 当前已知边界

- 上游 `npm ci` 的 lockfile 与当前 package manifest 存在既有不同步，并且 Pro Components peer 声明仍要求 antd 5；本轮未静默修改依赖声明或锁文件。
- 尚未把 Nova 的多场景、资产版本、CapCut 交付和 Provider 作业迁入新底座；这些能力进入下一阶段映射，不以旧运行时覆盖上游架构。
