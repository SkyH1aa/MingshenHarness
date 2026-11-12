# Mingshen Harness 1.2.1 实验版验证记录

日期：2026-11-03。替代此前同名的 1.0.0 记录。本轮不打包安装程序。

当前工作区全量结果见 [1.2.1 全量检查记录](FULL_VALIDATION_1.2.1.md)。下文保留早期构建的历史记录。

> 本文是较早构建的历史验收记录，不是当前工作树全量通过声明。后续已接入原生沙箱、
> Client ID、内置手册和更新检查，以下对应旧状态不代表现状。本次任务完成通知仅做专项
> 验证，见 [通知验证记录](NOTIFICATION_VALIDATION_1.2.1.md)；按用户要求未重新测试
> BrowserDo/Embiody，也未重新运行全量验收。

## 运行和检查

双击 `run-experimental.cmd`，已有构建时直接打开 Electron，不依赖全局 pnpm。
实验数据默认位于 `%LOCALAPPDATA%\MingshenHarnessExperimental`。
自动验收使用独立临时配置，未覆盖个人历史。

| 检查 | 结果 |
| --- | --- |
| 根项目和桌面版本 | 1.2.1 |
| lint / 两套 TypeScript / 生产构建 | 通过 |
| 默认测试 | 26 个文件通过，72 项通过，7 项按环境开关跳过 |
| 启用 MCP 联网测试 | 4 项通过，BrowserDo 页面操作使用独立开关 |
| 启用实际 Docker 测试 | 2 项通过 |
| 两个技能市场联网读取和安装 | 1 项集成测试通过，两个仓库均实际安装技能 |
| 真实 Electron 桌面验收 | 17 项通过 |
| 普通 Node 路径与 Docker junction 测试 | 通过，外部哨兵未被读取或更改 |
| 生产依赖审计 | 0 个已知漏洞 |

默认跳过的网络市场、MCP、Docker 和 BrowserDo 测试不能算通过。分别启用的结果如上；
BrowserDo 页面操作实际另行运行并失败，原因见下文。

## 桌面验收

`scripts/desktop-smoke.mjs` 使用真实 Electron、独立数据库和本地模拟模型。
覆盖首次协议的业务 IPC 限制、文档读取后的五秒门槛、确认后手册、中英文配置、14 个英文
设置分类、英文隐私政策、自定义标题栏、关闭弹窗、托盘偏好、模型流式请求、仅一次写文件
审批、实际文件写入、持久化 diff 和带 Request ID 的 HTTP 503 错误脱敏。
内嵌浏览器注册、实际页面读取、无 Node/应用 IPC 桥和面板尺寸检查也通过。
1040×680 浅色视口没有应用级横向溢出。错误正文保留换行，相对文件超链接在侧栏预览。

实际截图检查并修复了协议被遮暗、英文关闭说明过窄的问题。英文设置扫描没有剩余中文
产品静态文案；用户/模型内容、路径和第三方原始诊断不自动翻译。本地校验错误及活动标签
使用英文映射。源码 UI 检测器未给出正则规则发现，但未执行真实页面对比度和元素级规则，
因此不视作完整视觉或无障碍审计。

## Docker

本机已通过官方签名安装器安装 Docker Desktop 4.97.0，Engine 29.9.2，WSL2。
默认镜像 `mcr.microsoft.com/powershell:lts-alpine` 已拉取，本次 digest：
`sha256:d00c2db9004b4c97c5ee8a512f7a8da295c6bfd79f63966e6d4a0771c929896d`。

审批拒绝后不写文件，批准后在容器内写入工作区。容器根目录只读，没有宿主 `C:/Users`、
Docker socket 或非回环网卡。文件 worker 拒绝 `../../etc/passwd`。独立脚本在普通 Node
创建 Windows junction 后，实际容器命令无法读取工作区外哨兵，哨兵未改变。

这些是具体配置下的测试证据，不证明容器永远无法逃逸。宿主文件工具使用审批和路径检查，
不是整应用 Windows OS 沙箱。MCP、浏览器及用户自己操作的终端有独立边界。缺失 Docker
时受保护命令失败，不静默回退宿主。

Docker 是官方独立安装，不是可随意重打包的嵌入库。其他电脑仍可能需要虚拟化、WSL2、
管理员确认、重启及满足 Docker 订阅许可。

## MCP 与 Embiody

| 服务 | 实际验证 |
| --- | --- |
| Wikipedia | 发现工具并实际搜索，通过 |
| GitHub | 缺少凭据时正确报错；Device Flow 模拟通过，真实账户授权未测试 |
| Notion | 缺少 Token 时正确报错，真实页面读写未测试 |
| Browserbase | 缺少 Key/Project ID 时正确报错，云端浏览器未测试 |
| BrowserDo | 内置 0.9.3，发现 31 工具；实际打开页面失败 |

Embiody 下载通过 SHA256 校验。外层安装器更新服务 COM 注册报错 75003；本机尝试同一
官方离线包中签名有效的 mini_installer，浏览器本体已安装，但官方 0.9.0.5 在本机仍因
Windows SideBySide 激活失败无法启动，日志称找不到依赖程序集 `0.9.0.5`。
BrowserDo `browser_new_window` 超时，不能宣称通过。临时兼容探测文件已移除，未修改
官方二进制或关闭 Windows 安全策略。

Embiody EULA 不允许未经授权重新分发，因此仅提供官方下载安装入口，不塞入 Mingshen 包。
依赖状态会实际查询浏览器窗口，失败显示未就绪。Electron 内嵌 Chromium 不依赖 Embiody。

## 文档和发布配置

README、中文/英文协议、隐私政策及完整手册已写入。公开 Client ID、WPS 手册 URL 留空于
`apps/desktop/src/shared/release.ts`，注册步骤见 `GITHUB_OAUTH_SETUP.md`。
无需先公开源码才能注册或测试 Device Flow。

推荐 Apache-2.0，未替用户最终选择 LICENSE。第三方声明见 `../THIRD_PARTY_NOTICES.md`。
Supabase SQL 使用独立 `mingshen_` 命名，本轮未执行用户云数据库 SQL。客户端自动更新、
诊断上传和清理中尚未接通的部分，不因 SQL 定义存在就视作已运行。

完整边界见 `../SECURITY.md` 和 `SECURITY_VALIDATION_1.2.1.md`。
