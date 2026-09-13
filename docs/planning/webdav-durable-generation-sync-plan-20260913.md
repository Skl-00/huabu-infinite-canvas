# WebDAV Durable Generation 同步计划

## 日期

2026-09-13

## 目标

将新的图片、视频、音频、文本 durable run 纳入现有 WebDAV 同步，保留任务事实、参考素材和本地结果媒体；不把 API Key、模型脚本或含凭据 URL 写入远端清单。

## 实施范围

- 新增 `generation-runs` 同步域，统一保存四类 run。
- 复用现有媒体键扫描、上传、下载和缺失媒体恢复逻辑。
- 合并规则按任务 ID 和 `updatedAt`，不静默覆盖本地较新任务。
- 恢复时直接写入对应 IndexedDB store，再触发各 run store 的 durable reload。
- 保留旧版图片/视频工作台日志域，兼容已有 WebDAV 数据。
- 在 WebDAV 进度界面显示新同步域，并更新中英文文案。

## 验收标准

- 四类 durable run 均进入远端 `generation-runs` manifest。
- run 中引用的图片、视频、音频本地媒体一并上传；另一浏览器同步后可恢复任务与媒体。
- 同步数据不含 API Key、脚本正文和 `Authorization` 值。
- 远端较旧记录不会覆盖本地较新记录；远端新增记录可合并到本地。
- 同步失败时域状态明确显示，不影响其他域已有数据。
- 类型检查、构建、全量 Playwright 和差异审计通过。
