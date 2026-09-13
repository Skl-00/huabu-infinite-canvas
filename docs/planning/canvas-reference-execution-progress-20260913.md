# 画布参考资源真实执行链进度

## 已完成

- 冻结本轮计划与对抗审查。
- 资源节点识别支持 `content` 或 `storageKey`，不再因恢复后展示 URL 为空而过滤图片、视频、音频。
- 生成上下文在提交前优先按 `storageKey` 读取图片并转换为 Data URL。
- 文本任务冻结参考时不再把持久化图片重新降级为 `blob:` URL，Provider 请求收到可传输的 Data URL。
- 图像源节点、视频源节点和音频源节点的“空节点”判断纳入 `storageKey`。
- 增加真实请求体测试和断线负向测试。

## 当前证据

- `npm run typecheck` 通过。
- `npm test` 通过，`65/65`。
- 生产构建通过。
- `git diff --check` 通过（仅有 Git 的行尾转换提示）。
- storage-only 图片的真实 `/responses` 请求体包含 `input_image` 和 `data:image/png;base64,...`。
- storage-only 图片的真实 `/images/edits` multipart 请求体包含参考 PNG 字节和 `image` 字段。
- 断开连接后编译上下文不再包含参考图。
- 三条参考执行专项均通过；原有插件文本中断专项也在最终全量回归中通过。

## 待完成

- 完成本轮提交并通过 SSH 推送到 `Skl-00/huabu-infinite-canvas`。
- Config/Group、视频参考适配器仍需继续做可见 UI 和真实 Provider 级专项验收；本轮未把这些未验证项宣称为完成。
