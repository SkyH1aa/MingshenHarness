# GitHub OAuth 申请填写说明

Mingshen Harness 1.2.5 使用 GitHub Device Flow。可注册 OAuth App，也可注册启用了 Device Flow 的 GitHub App。无需先公开 GitHub 仓库才可申请或测试；核心条件是有效 Client ID、启用 Device Flow、账号和组织授权。

## 按截图填写

| 字段 | 建议填写 |
| --- | --- |
| Application name | `Mingshen Harness` |
| Homepage URL | `https://github.com/你的GitHub用户名/MingshenHarness`；注册前可先创建空仓库，或用你实际控制的项目主页 |
| Application description | `Local-first Windows AI coding and work agent by 新哲文院算法社. Connects user-configured models and authorized GitHub repositories.` |
| Redirect URI | 当前设备授权不会使用回调；若该表单必须填写，可填 `http://127.0.0.1:4096/github/oauth/callback` 作为预留值。此版本未实现这个回调路由，不要按 Web Flow 使用它 |
| Allow wildcard matching | 不勾选 |
| Enable Device Flow | 必须勾选 |
| Expire user access tokens | 建议保留。当前版本令牌到期后重新授权；尚未实现 GitHub App 刷新令牌生命周期 |

填写 `Homepage URL` 时不要把示例“你的GitHub用户名”原样提交。可以先创建同名空仓库；正式源码发布可以稍后进行。不要使用不属于你的其他软件主页。

## 注册以后

1. 在应用详情中找到 **Client ID**。它是公开应用标识，可用于桌面分发。
2. **Client Secret 不是 Client ID。不要把 Client Secret 发给模型、写入桌面代码或提交仓库。** Device Flow 不需要向用户索取 Client Secret。
3. 打开 Mingshen 的“GitHub 插件”，填 Client ID 并点击“使用浏览器授权”。
4. 软件先显示 `XXXX-XXXX` 格式的验证码和复制按钮，然后打开默认浏览器。在 GitHub 页面输入软件显示的码，确认账户与权限，返回软件等待完成。GitHub 页面不会另发一个码给你。
5. 在 MCP 设置中启用 GitHub，测试工具连接。
6. GitHub App 还需配置仓库权限并安装到目标账户或组织。组织管理员可能需要批准。

切换设置页或关闭再打开设置时，尚未过期的验证码可以恢复并继续等待。临时网络失败可点击“继续等待授权”，也可重新打开授权网页。点击“取消授权”或退出软件后，本次等待结束，需要重新申请验证码；设备码和 Token 都不能发给他人。取消等待不会撤销此前已经完成的 GitHub 授权，撤销请使用 GitHub Settings → Applications。

发行配置位于 `apps/desktop/src/shared/release.ts` 的 `RELEASE_LINKS.githubClientId`，已填写公开 Client ID `Ov23liHKDMKPcqU8e7xd`。该值可随源码发布，不能用 Client Secret 替代。使用手册永久内置，标题栏书本图标及设置 → 关于均可打开，无需配置外部 URL。

## 仓库的锁与许可证

仓库 `SkyH1aa/MingshenHarness` 的锁标志表示 **Private（私有）**。创建仓库、上传代码、注册 OAuth App 都不会自动将它公开。公开意味着所有人可读取代码及历史，因此应先检查历史中没有 API Key、数据库、用户数据等。

准备好公开后，仓库页面进入 **Settings → General → Danger Zone → Change repository visibility → Change to public**，按 GitHub 要求输入仓库名确认。组织策略可能限制此操作。本文只说明步骤，软件不会代你修改仓库可见性。

许可证不是 Settings 内的选项。推荐使用 **Apache License 2.0**：代码页 **Add file → Create new file**，文件名填 `LICENSE`，点击 **Choose a license template**，选择 Apache License 2.0，核对署名后提交。若界面没有模板入口，可从 https://www.apache.org/licenses/LICENSE-2.0.txt 获取完整标准文本作为根目录 `LICENSE`。选择后再把两个 package.json 的 `license` 改为 `Apache-2.0`。仅公开源码不自动授予开源权利；当前仓库仍以根目录实际许可证为准。

## 手动 Token 获取

- 打开 https://github.com/settings/personal-access-tokens/new 建立 fine-grained PAT。
- 选择需要的仓库和最少权限。只读检索一般仅需对应仓库读取权限；创建 Issue/评论 PR 再增加相应写权限。
- 某些 GitHub MCP 功能可能需要更具体的权限、组织批准或 classic PAT，以官方服务返回为准。
- Token 只在创建时显示一次；在 Mingshen 的 PAT 输入框粘贴并验证。不要粘贴到聊天。
- 在 GitHub Settings → Applications 中可撤销 OAuth 授权；在 Personal access tokens 中可撤销 PAT。

参考：https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md
