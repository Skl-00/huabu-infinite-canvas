# WebDAV Durable Generation 同步进度

## 已完成

- 新增 `generation-runs` WebDAV 同步域。
- 图片、视频、音频、文本任务统一进入该域，按任务 ID 和 `updatedAt` 合并。
- 任务引用的本地媒体继续由现有 storage key 扫描、上传和缺失下载流程处理。
- 恢复远端任务后写回四个 durable IndexedDB store，并触发对应 store reload。
- 同步开始前等待画布、资产和四类任务 store 全部 hydration，避免初始化竞态把任务误判为空。
- WebDAV 进度界面增加生成任务域，中英文完成提示同步更新。
- 同步前清理 storage-backed 的 `dataUrl` / `url`，避免上传 blob URL 或临时地址。

## 已验证

- `npx playwright test tests/webdav-generation.spec.ts`：1/1 通过。
- 专项验证覆盖远端文本任务合并、持久化 store 回读和清单凭据字段审计。
- `npm run typecheck`：通过。

## 仍需验证

- 当前专项测试使用 Playwright 模拟 WebDAV，不等同于真实 NAS/云盘跨设备验证。
- 图片、视频、音频结果媒体跨独立浏览器上下文的完整恢复仍需真实 WebDAV 环境验收。
- 全量类型检查、构建和 Playwright 回归正在执行。
