# WebDAV Durable Generation 同步反方审查

## 高风险点

### 1. 把 hydrated blob URL 写入远端清单

任务 store 为了渲染会补回 `blob:` URL。同步前必须清空已有 storageKey 对应的 data URL、媒体 URL，避免清单膨胀和把本地临时 URL 当成可恢复地址。

### 2. 同步任务时遗漏结果媒体

只同步 run JSON 不够。统一域必须经过现有 `collectStorageKeys`，让任务中的参考图、视频、音频和生成结果媒体进入文件上传/下载流程。

### 3. 恢复时只更新 React 内存

同步恢复必须写入四个 durable IndexedDB store，并随后调用各 store 的 load 函数。只调用 Zustand `setState` 会在刷新后丢失。

### 4. 远端旧数据覆盖本地新任务

合并必须按 `id + updatedAt`，不能用数组顺序或远端优先。未知/缺少时间的记录不得覆盖有时间的本地记录。

### 5. 凭据通过旧任务字段泄露

当前 run 的 request 已经是冻结参数，不应包含 API Key；同步前仍要做字段级净化，禁止把 channel config、脚本正文或 Authorization 头混入 generation-runs。

### 6. 兼容旧版工作台记录

不能删除原有 image/video log 域，否则升级后用户既有历史会丢失。新增 durable 域应与旧域并存，直到明确迁移策略。

## 通过条件

- 新增域有单元/浏览器证据；
- 旧域测试不回归；
- 同步数据在远端 manifest 中可读、可合并、可恢复；
- 不宣称跨设备验证，除非实际用两个独立存储上下文完成验收。
