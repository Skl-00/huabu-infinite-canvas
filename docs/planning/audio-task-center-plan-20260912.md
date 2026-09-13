# 音频任务中心计划

## 目标

把已经持久化的 `AudioRun` 接入 `/tasks`，使音频任务可以在刷新后统一查看、刷新恢复、重新保存、失败重试和下载结果，并与图片/视频任务中心保持一致的可恢复边界。

## 实施顺序

1. 新增独立的音频任务详情与列表视图，不复制 Provider 请求逻辑。
2. 接入 `initializeAudioRuns`、`resaveAudioRun`、`retryAudioRun` 和 `resumeAudioRun`。
3. 在任务类型切换中增加音频入口，并保留 URL 查询参数选择任务。
4. 增加音频任务的浏览器回归：结果、失败重试、刷新恢复、凭据不泄露和窄屏布局。
5. 运行类型检查、定向测试、全量回归、构建和差异审计。

## 反方审查

- 任务中心不能重新调用 Provider；所有动作必须复用 `audio-runner`。
- `interrupted` 没有可验证远端续查协议时只能允许“重新保存/核对”，不能伪装成自动恢复。
- 结果 URL 为空或媒体丢失时，下载和素材操作必须禁用，并保留错误信息。
- 重试必须受全局音频串行约束，不能绕过 `startAudioRun`。
- 任务页只能显示脱敏任务事实，不渲染 API Key、完整配置或隐藏凭据。
- 旧 URL `?kind=video`、`?run=` 和移动端返回行为必须保持兼容。

## 验收标准

- `/tasks?kind=audio` 能查看 durable audio runs。
- 成功任务可播放和下载；失败任务可用冻结请求重试。
- 刷新后任务仍可读，任务中心不产生重复 Provider 请求。
- `npm run typecheck`、音频定向 E2E、全量 Playwright、build 和 `git diff --check` 通过。
