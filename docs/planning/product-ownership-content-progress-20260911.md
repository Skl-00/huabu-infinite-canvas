# HuaBu 产品内容重建进度

更新时间：2026-09-11

## 当前状态

- [x] 已确认运行底座为 `basketikun/infinite-canvas`，不改动协议和兼容键。
- [x] 已创建 HuaBu 自有 GitHub 仓库 `Skl-00/huabu-infinite-canvas`。
- [x] 已完成本轮边界审查：只替换用户可见产品内容，不机械替换技术命名。
- [x] Web 页面用户可见品牌统一为 HuaBu。
- [x] 根 README 重写为 HuaBu 产品说明。
- [x] 文档首页、导航和支持入口改为项目参与与反馈说明。
- [x] 运行测试、类型检查、构建和差异检查。
- [x] 提交并推送本轮内容重建。

本轮提交：`62de0fa`（已推送到 `Skl-00/huabu-infinite-canvas` 的 `main`）。

## 保留边界

以下名称属于运行协议、包名或数据兼容边界，本轮保留：

- `infinite-canvas` MCP 名称和插件命名空间。
- `@basketikun/canvas-agent`、`@basketikun/canvas-proxy` 等已发布包名。
- `infinite-canvas` localForage 数据库、存储键和导入导出格式。
- 上游 MIT License 与底座来源说明。
- 第三方提示词仓库来源链接。

## 验收重点

- 用户打开 Web 或文档站时首先看到 HuaBu，而不是上游产品名。
- README 不再包含上游赞助商、原作者联系方式、原社区群或上游产品宣传。

## 本轮验证

- Web `npm run typecheck`：通过。
- Web `npm test`：10/10 通过。
- Web `npm run build`：通过。
- Docs `npm run types:check`：通过。
- Docs `npm run build`：通过；保留既有 NFT tracing 警告。
- `git diff --check`：通过。
- 任何真实能力、已知限制和未完成能力都按当前代码事实描述。
