# 画布参考资源真实执行链进度

## 已完成

- Config 聚合改为收集所有输入 Config，并与目标的直接输入统一合并、展开 Group、按节点 ID 去重；不再使用单条隐式 Config 连线特判。
- `@` 引用现在可解析 Config 聚合中的 Group 成员，显式引用只发送选中的资源，普通提示词仍保留。
- 参考栏改为读取同一份连接图编译结果，Config/Group 不再只显示占位节点；移除组内资源沿用整组断开语义。
- 增加 OpenAI multipart、Gemini JSON 和画布视频目标的真实请求体专项测试，覆盖图片、视频、音频参考字段。
- 冻结本轮计划与对抗审查。
- 资源节点识别支持 `content` 或 `storageKey`，不再因恢复后展示 URL 为空而过滤图片、视频、音频。
- 生成上下文在提交前优先按 `storageKey` 读取图片并转换为 Data URL。
- 文本任务冻结参考时不再把持久化图片重新降级为 `blob:` URL，Provider 请求收到可传输的 Data URL。
- 图像源节点、视频源节点和音频源节点的“空节点”判断纳入 `storageKey`。
- 增加真实请求体测试和断线负向测试。

## 当前证据

- `npm run typecheck` 通过。
- `npm test` 通过，`70/70`。
- 生产构建通过。
- 画布参考专项 `6/6` 通过，Config/Group/`@` 和 OpenAI/Gemini 视频请求体均有浏览器证据。
- 画布视频图专项 `1/1` 通过，节点连线编译出的图片、视频、音频同时进入 Provider multipart 请求。
- `git diff --check` 通过（仅有 Git 的行尾转换提示）。
- storage-only 图片的真实 `/responses` 请求体包含 `input_image` 和 `data:image/png;base64,...`。
- storage-only 图片的真实 `/images/edits` multipart 请求体包含参考 PNG 字节和 `image` 字段。
- 断开连接后编译上下文不再包含参考图。
- 三条参考执行专项均通过；原有插件文本中断专项也在最终全量回归中通过。

## 待完成

- 仍需在用户当前浏览器中手动确认 Config/Group 参考栏的移除交互、刷新后的缩略图和移动端布局；自动化已覆盖编译与请求体，不等同于人工视觉验收。
- Agnes 视频本地参考素材继续按协议前置拒绝，公网 URL 和真实免费模型限流边界仍应单独小请求验证，不在本轮批量触发。

## 本轮交付

- 已提交 `9117b43 fix: connect canvas references to generation requests`。
- 已通过 SSH 推送到 `Skl-00/huabu-infinite-canvas` 的 `main`。
- 用户已有的规划截图改动未纳入本轮提交，仍保留在工作树。
