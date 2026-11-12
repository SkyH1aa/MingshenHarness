<p align="center">
  <img src="apps/desktop/build/icon.png" width="88" height="88" alt="Mingshen Harness 原子图标" />
</p>

# Mingshen Harness

**Windows 本地优先的 AI 编程与工作 Agent。**

连接自己的模型供应商，把对话、代码编辑、工具执行、并行 Agent 和文档制作放在同一个桌面工作台中。会话与项目记忆保存在本机，模型和扩展服务由你选择。

**版本 1.3.2** · **Windows 10/11 x64** · **简体中文 / English**

[快速开始](#快速开始) · [模型配置](#模型配置) · [开发与构建](#开发与构建) · [文档](#文档) · [许可](#许可)

由新哲文院算法社维护，发布者 Ming。

## 功能概览

| 能力 | 支持内容 |
| --- | --- |
| 自选模型 | Messages、Responses、Chat Completions、Gemini 原生四种协议；多供应商、多 Key、模型星标与供应商排序 |
| 并行任务 | 十个内置 Agent、自建角色、只读 Plan、子 Agent 模型配置、任务树、可编辑计划与暂停续跑 |
| 代码工作台 | 文件编辑与 diff、本地代码索引、LSP、Formatter、Git 撤销恢复、快照与 worktree |
| 长对话 | 上下文自动压缩、主备压缩模型、Token Saver、CTX 用量与供应商缓存诊断 |
| 文档与公式 | Office/PDF 附件读取、离线中英文 OCR、DOCX/PPTX/PDF 制作、Markdown、模板、图表与 Word 原生可编辑公式 |
| 项目记忆 | 按工作区选择原生 Memory 或 TencentDB 本地核心，管理偏好、任务日记与模型提取的语义记忆 |
| 工具与扩展 | 文件/命令/图片工具、内嵌 Chromium、Skills/插件、stdio/HTTP MCP、GitHub 集成与可选本地 API/SDK |
| 日常使用 | 会话按文件夹分组、搜索与批量归档、自动保存草稿、双界面与日夜主题、托盘及 Windows 原生通知 |

### 1.3.2 新增

- **Gemini 原生协议**：直接使用 Google GenerateContent，支持流式输出、工具调用、图片/音频/PDF 输入、模型发现与连接测试。
- **Gemini / DeepSeek 缓存适配**：稳定请求前缀，保留符合条件的原生推理和签名续接状态，展示供应商报告的缓存用量。
- **Word 表格原生公式**：DOCX 单元格支持多段、富文本、Markdown 和可编辑公式，PDF 支持对应排版。

完整变更见[更新日志](docs/CHANGELOG.md)，配置与适配细节见[供应商缓存说明](docs/PROVIDER_CACHING.md)和[文档工具说明](docs/DOCUMENT_TOOLS.md)。

## 快速开始

### 使用安装版

1. 运行发布者提供的 Windows x64 安装包。
2. 首次启动时阅读三份协议与内置使用手册。
3. 在“设置 → 供应商与模型”添加自己的服务地址、API Key 和模型。
4. 选择工作文件夹，创建会话并开始任务。

安装版无需另装开发用 Node.js/pnpm。项目命令、stdio MCP 和外部运行时按各自依赖配置。应用不提供免费模型额度或 ChatGPT 订阅；界面中的 `Chatgpt Pro` 仅为可编辑的示例供应商名称。

### 从源码运行

需要 **Windows 10/11 x64、Node.js 24+、pnpm 11+**，仓库固定包管理器为 `pnpm@11.25.0`。获取源码后，在仓库根目录运行：

```powershell
pnpm install --frozen-lockfile
node scripts/provision-native-runtime.mjs
pnpm dev
```

准备脚本会下载并校验固定版本的原生 Windows 沙箱执行器。该 EXE 不随源码提交，新克隆需要执行上述准备步骤；来源与哈希见[运行时说明](apps/desktop/resources/native/PROVENANCE.md)。它只用于沙箱执行，不使用用户的 Codex 账户或模型服务。

需要运行构建后的实验版时：

```powershell
pnpm build
.\run-experimental.cmd
```

实验版使用独立数据目录 `%LOCALAPPDATA%\MingshenHarnessExperimental`。源码变更后请先重新构建，从托盘正常退出旧实例再启动；启动器在已有构建时不会自动重建。

### 执行环境

受保护模式可选择 Windows 原生 MXC 或 Docker。MXC 需要兼容的较新 Windows 11；Windows 10/旧版 Windows 11 使用 Docker。隔离不可用时，受保护操作会停止，不会静默改在宿主执行。

Docker Desktop、WSL2 和 Embiody 属于按需配置的外部依赖，不包含在安装包中。完整要求见[使用手册](docs/USER_GUIDE.md)和[安全说明](SECURITY.md)。

## 模型配置

每个供应商选择一种协议，应用自动追加请求端点。Base URL 不要重复填写完整请求路径。

| 协议 | 典型 Base URL | 鉴权 |
| --- | --- | --- |
| OpenAI Responses | 供应商提供的 `/v1` 地址 | 通常为 `Authorization: Bearer` |
| Chat Completions | 供应商提供的 `/v1` 地址 | 通常为 `Authorization: Bearer` |
| Anthropic Messages | 供应商提供的 `/v1` 地址 | 通常为 `x-api-key` |
| Google Gemini 原生 GenerateContent | `https://generativelanguage.googleapis.com/v1beta` | `x-goog-api-key` |

Gemini 的 Chat Completions 兼容接口使用 `https://generativelanguage.googleapis.com/v1beta/openai`，与原生协议分开配置。DeepSeek 的官方路径按协议区分，完整地址、推理续接及缓存条件见[供应商缓存说明](docs/PROVIDER_CACHING.md)。

每个模型可以配置上下文窗口、输出上限、输入模态、工具能力和思考等级。供应商长按拖动排序、模型星标会同步到聊天、新建会话、子 Agent、审批、压缩和记忆分析等模型选择入口。

“模型体系”控制适配规则，不转换 API 协议。第三方网关需确认支持对应字段透传。Gemini / DeepSeek 默认使用隐式前缀缓存，不自动创建收费显式缓存资源；命中率由模型、请求、缓存有效期和供应商路由共同决定。

## 工作区与项目记忆

会话按工作文件夹组织，可搜索、分支、归档和批量管理。待发送文字、格式状态和附件自动保存草稿，切换会话或正常重启后恢复；发送被接收、手动清空或删除会话时移除相应草稿。

输入框可显示粘贴的 Markdown 和 LaTeX 格式，同时保留原文用于编辑及发送。设置 → 外观与语言可关闭此显示方式。“简约”和“光轨”共用会话与功能，界面风格在重载或重启后生效。

设置 → 项目指令与信任可按工作区选择：

| 记忆后端 | 本地目录 | 自动维护 |
| --- | --- | --- |
| 原生 Memory | `.harness-memory/` | 偏好、任务日记摘要、检索与归档 |
| TencentDB 本地核心 | `.harness-tencent-memory/` | 记忆分析模型提取语义记忆，再判断存储、跳过、更新或合并 |

TencentDB 可配置分析主备模型；主模型留空时使用当前主会话模型。提取与冲突判断提示复用固定上游版本的通用 `chat` 模板，宿主校验结果后原子保存。分析失败不会改存完整回答或规则摘录，切换后端保留两套目录。

该集成使用 TencentDB Agent Memory 的本地核心，不接入腾讯云记忆服务，也不等同于完整上游产品。固定版本、原文提示来源、集成范围与许可见[第三方说明](THIRD_PARTY_NOTICES.md)。

## 数据与安全

会话、配置、草稿和工作记录默认保存在本机。凭据通过系统 `safeStorage` 保存；普通会话、附件和项目记忆不属于凭据加密。数据库保留历史迁移，启动时自动升级旧数据；重要升级前应备份完整数据。

聊天、上下文压缩、自动审批、记忆分析及其备用模型会按配置向对应供应商发送所需内容，并可能产生 API 用量。Gemini 签名和 DeepSeek API 实际返回的明文推理可能随会话保存；外部 MCP 和扩展也有各自的数据边界。运行日志支持用户主动脱敏导出，不自动上传。

文件、命令和扩展操作仍需按权限执行。审批是操作授权，worktree 用于工作目录分离，两者都不能代替进程隔离。持续命令工具使用管道，不支持完整 PTY；定时任务需要应用保持运行。

请阅读[安全说明](SECURITY.md)和[隐私政策](docs/PRIVACY_POLICY.md)，并按任务需要配置模型、扩展及工作区权限。

## 开发与构建

应用使用 Electron、React、TypeScript 和 SQLite，包管理器为 pnpm。

### 源码检查

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

固定任务基线可用 `node scripts/harness-eval.mjs`，默认仅运行临时工作区中的合成夹具，不调用模型。桌面专项和真实服务测试的执行条件见对应验证记录。

### Windows 打包

```powershell
# 仅检查环境、必需资源、依赖与版本
.\package-win.cmd --check

# 构建解包程序，不生成安装器
.\package-win.cmd --dir

# 生成正式 Windows 安装器及 ZIP 更新材料
.\package-win.cmd
```

脚本自动寻找 Node.js/pnpm，仅为当前进程补齐 PATH。已配置好环境时也可使用 `pnpm package:win`。完整打包会准备图标与固定沙箱、构建应用、校验必需资源和第三方哈希，并在 afterPack 再次检查。

当前目标为未签名、当前用户安装的 x64 NSIS，输出目录为 `apps/desktop/release-artifacts/`：

```text
MingshenHarness-1.3.2-x64.exe
MingshenHarness-1.3.2-x64.zip
MingshenHarness-1.3.2-x64.zip.sha256
MingshenHarness-1.3.2-x64.zip.json
```

构建缓存位于 `%LOCALAPPDATA%\MingshenHarness\BuildCache\windows-1.3.2-*`。遇到 `EPERM`、`EACCES`、`EBUSY` 时，排查方法见[开发交接与打包指南](AGENT.md)。

自行分发时需核对 [release.ts](apps/desktop/src/shared/release.ts)、GitHub OAuth 和 Supabase 更新服务配置。发布材料使用本次 ZIP 实际生成的哈希与大小；`supabase/` 中的历史发布 SQL 只适用于对应旧包。配置方法见[GitHub OAuth 指南](docs/GITHUB_OAUTH_SETUP.md)和[更新服务部署指南](docs/SUPABASE_DEPLOY.md)。

### 仓库结构

```text
apps/desktop/
  src/main/             主进程、模型、Agent、工具、存储与隔离
  src/preload/          typed IPC 桥接
  src/renderer/         React 界面
  src/shared/           共享类型、配置与发布信息
  resources/            提示词、文档 worker、LSP、SDK 与第三方运行资源
  build/                正式 PNG / ICO 图标
docs/                   双语手册、协议、更新日志与验证记录
scripts/                构建、资源准备、检查、桌面验证与合成夹具
supabase/               更新服务迁移和历史发布 SQL
third_party/            固定 TencentDB 上游源码、适配及许可
```

`resources/lsp/`、`resources/tencentdb-memory/`、正式图标与合成测试夹具属于仓库资源。原生沙箱 EXE 则由准备脚本恢复。[.gitignore](.gitignore) 已排除依赖、构建产物、本地项目记忆、数据库和环境密钥。

开发前请阅读 [AGENT.md](AGENT.md)，了解代码位置、版本约束、数据保护及验证方法。[DESIGN.md](DESIGN.md) 记录界面约定。

### 问题反馈

提交 Issue 时请提供应用版本、Windows 版本、复现步骤、预期行为和实际结果。供应商兼容问题请同时注明协议和模型 ID，可附脱敏日志或截图；请移除 API Key、账户信息、私人路径及对话内容。

验证记录区分本地合成服务、真实集成和未覆盖范围，源码检查通过不代表所有供应商、Windows 配置或安装升级流程已经验收。当前版本证据见[1.3.2 验证记录](docs/VALIDATION_1.3.2.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [使用手册](docs/USER_GUIDE.md) / [English](docs/USER_GUIDE.en.md) | 安装、设置、会话、工具与扩展 |
| [更新日志](docs/CHANGELOG.md) / [English](docs/CHANGELOG.en.md) | 各版本完整变更 |
| [1.3.2 验证](docs/VALIDATION_1.3.2.md) / [1.3.1 验证](docs/VALIDATION_1.3.1.md) | 实际命令、通过项、失败重跑及未覆盖范围 |
| [文档工具](docs/DOCUMENT_TOOLS.md) | 原生公式、富内容表格、Markdown、模板及格式限制 |
| [供应商缓存](docs/PROVIDER_CACHING.md) | 协议、缓存、原生状态与官方来源 |
| [安全说明](SECURITY.md) / [第三方许可](THIRD_PARTY_NOTICES.md) | 信任边界、依赖、来源与许可 |
| [GitHub OAuth](docs/GITHUB_OAUTH_SETUP.md) / [更新服务](docs/SUPABASE_DEPLOY.md) | 账户集成和分发配置 |
| [服务协议](docs/TERMS_OF_SERVICE.md) / [隐私政策](docs/PRIVACY_POLICY.md) / [免责协议](docs/DISCLAIMER.md) | 内嵌用户协议，修订号 `2026-11-04.3` |
| [开发交接](AGENT.md) / [界面约定](DESIGN.md) | 维护入口、代码结构、数据保护与验证边界 |

## 许可

当前项目许可标记为 **`UNLICENSED`**，尚未提供根项目开源许可证。源码公开展示不代表已授予使用、修改或分发授权；正式许可安排以维护者后续发布的许可证为准。

第三方组件分别遵循自己的许可；社团名称、产品名称和图标的使用权不随源码仓库访问权限自动授予。
