<p align="center">
  <img src="web/public/logo.svg" width="96" alt="HuaBu Canvas logo">
</p>

<h1 align="center">HuaBu 画布</h1>

<p align="center">
  <strong>面向视觉创作工作流的开源画布工作台</strong>
</p>

<p align="center">
  <a href="https://github.com/Skl-00/huabu-infinite-canvas"><img src="https://img.shields.io/github/stars/Skl-00/huabu-infinite-canvas?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="https://github.com/Skl-00/huabu-infinite-canvas/tags"><img src="https://img.shields.io/github/v/tag/Skl-00/huabu-infinite-canvas?style=flat-square&label=version" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-f97316?style=flat-square" alt="License"></a>
  <a href="https://vite.dev/"><img src="https://img.shields.io/badge/Vite-7-646cff?style=flat-square&logo=vite&logoColor=white" alt="Vite"></a>
  <a href="https://reactrouter.com/"><img src="https://img.shields.io/badge/React_Router-7-ca4245?style=flat-square&logo=reactrouter&logoColor=white" alt="React Router"></a>
</p>

<p align="center">
  <a href="docs/content/docs/overview/quick-start.mdx">快速开始</a> ·
  <a href="docs/content/docs/overview/features.mdx">功能说明</a> ·
  <a href="docs/content/docs/canvas/canvas-node-manual.mdx">画布操作</a> ·
  <a href="docs/content/docs/development/local-development.mdx">本地开发</a> ·
  <a href="SECURITY.md">安全报告</a> ·
  <a href="canvas-agent/README.md">Canvas Agent</a> ·
  <a href="plugins/infinite-canvas">Codex 插件</a>
</p>

HuaBu 画布把提示词、参考素材、生成配置、生成结果和可复用资产组织在同一个画布工作流中。项目以浏览器本地存储为默认边界，支持用户配置 OpenAI 兼容渠道，也可以连接本地 Canvas Agent，让 Codex 读取和操作当前画布。

本仓库基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 的开源源码底座继续开发。HuaBu 的产品层、交互、工作区结构和后续能力会独立演进；本项目不复制闭源产品的代码、品牌、账号体系或私有接口。

> [!WARNING]
> 项目仍处于持续开发阶段。浏览器本地数据格式、节点协议和页面结构可能调整。真实 AI 生成能力取决于你配置的渠道、模型和调用脚本；仓库不会把未验证的 Provider 能力写成已完成能力。

## 当前能力

- 画布项目：创建、重命名、复制、删除、导入、导出和多工作画布管理。
- 画布操作：拖拽、缩放、框选、多选、复制粘贴、撤销重做、小地图、背景和连线设置。
- 节点工作流：文本、图片、视频、音频、生成配置、分组和插件节点。
- AI 调用：用户自配 OpenAI 兼容渠道，支持图片、文本、视频和音频能力，以及自定义调用脚本。
- 生成记录：保留生成参数、参考素材、结果节点和失败/重试状态，便于继续迭代。
- 提示词与资产：搜索提示词来源，收藏提示词、图片和其他可复用素材，并插回画布。
- 本地 Agent：通过 Canvas Agent 和 `infinite-canvas` MCP 让 Codex 读取或操作画布。
- 插件系统：通过插件扩展节点类型、渲染、检查器、迁移和可选的生成能力。

## 快速开始

### 本地开发

```bash
git clone git@github.com:Skl-00/huabu-infinite-canvas.git
cd huabu-infinite-canvas/web
bun install
bun run dev
```

默认访问 `http://localhost:3000`。当前本地验收使用的端口可以通过 Vite 参数调整。

### Docker

```bash
git clone git@github.com:Skl-00/huabu-infinite-canvas.git
cd huabu-infinite-canvas
docker compose up -d
```

也可以直接构建镜像：

```bash
docker build -t huabu-canvas .
docker run --rm -p 3000:3000 huabu-canvas
```

首次打开后，在设置中填入自己的 Base URL、API Key 和模型名称。项目默认从浏览器直连你配置的 OpenAI 兼容接口；API Key 和画布数据不会上传到本仓库。

## 文档

- [快速开始](docs/content/docs/overview/quick-start.mdx)
- [功能说明](docs/content/docs/overview/features.mdx)
- [画布节点操作手册](docs/content/docs/canvas/canvas-node-manual.mdx)
- [画布快捷键](docs/content/docs/canvas/canvas-shortcuts.mdx)
- [Canvas Agent 与 MCP](docs/content/docs/development/local-codex-canvas.mdx)
- [插件开发](plugins/infinite-canvas/README.md)
- [项目进度与待办](docs/content/docs/progress/todo.mdx)

## 数据与兼容边界

默认情况下，项目、资产、生成记录和配置保存在浏览器本地。WebDAV 是可选的用户配置能力，不代表项目提供云端账号或托管存储。

`infinite-canvas` 作为 MCP 名称、插件命名空间、localForage 数据库名、导入导出标识和部分包名保留，用于兼容已有数据与工具链。这些技术名称不等同于产品品牌。

## 参与项目

请在 [HuaBu 画布仓库](https://github.com/Skl-00/huabu-infinite-canvas) 提交可复现的 Issue、功能建议、文档改进或代码贡献。公开 Issue 不要包含 API Key、个人数据、私密业务资料或安全漏洞细节；安全问题请遵循 [SECURITY.md](SECURITY.md)。

## 开源协议与来源

本项目使用 [MIT License](LICENSE)。上游底座来源为 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)，上游许可证和来源说明继续保留。提示词来源见[第三方提示词来源文档](docs/content/docs/overview/third-party-prompt-repositories.mdx)。
