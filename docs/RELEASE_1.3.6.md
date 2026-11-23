# Mingshen Harness 1.3.6

> 发布状态：1.3.6 x64 安装器与更新 ZIP 已在本地生成并核验，尚未安装或验收升级、卸载，也尚未发布。本页为发布草案；没有公开 ZIP 直链，因此未生成或执行 1.3.6 发布 SQL。完整结果与未覆盖范围见验证记录。

本地打包产物位于 `apps/desktop/release-artifacts/`：

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `MingshenHarness-1.3.6-x64.exe` | 379,034,508 字节 | `0f767921cde4cbb826eaa74b7a7a8a679e7051947570be8873db72e096317906` |
| `MingshenHarness-1.3.6-x64.zip` | 378,102,275 字节 | `b989ad93ca44a5438d2d524064d7e0b78981fe9a6fd60ba0c7247eba98163a7b` |

## 中文发布草案

**Mingshen Harness 1.3.6：本地生图画布库**

Mingshen Harness 1.3.6 将生图工作台的画布从临时工作区条目升级为本地工程库。新建或导入的画布保存在应用数据目录，关闭标签后仍可从“我的画布”重新打开；画布库支持搜索、重命名、复制、删除和定位文件，并明确区分导入图片素材与导入画布工程。

本轮重点是把画布内容、图片素材和当前打开标签拆成三个清晰层次。关闭标签不再等同于删除工程，复制画布不会重复复制共享图片；主进程按合法画布标识定位文件，Renderer 不提交任意本地路径。旧版工作区中的画布会在首次使用时迁移，并保留原设置备份。

有效生成图片的尺寸与请求不一致时，仍按真实宽高保存并显示警告，不再丢弃已经成功返回的图片。

本地插件的 `BeforeModelRequest` prompt Hook 新增请求内位置与格式控制。`position` 可选 `before` / `after`，`format` 可选 `context` / `plain`，默认仍为旧版 `before + context`。需要把声明文本直接跟在本轮请求原文后且不显示插件标题时，可配置 `position: "after"` 与 `format: "plain"`；例如原文 `xxxx` 后可直接跟随 `123abc`。这是对发往模型的请求内容排版，而不是在响应之后追加。工具结果轮次会保持完整 call/result 配对，按协议在工具结果内容之后添加普通用户文本块或独立 user 尾消息，不会把文本插到调用与结果之间。`plain` 仍为普通用户优先级内容，不提升为 system 指令或扩大权限。文本按每次请求临时附加，不写入会话历史。

测试启动流程现明确连接主界面而不是短时启动动画窗口，首次协议确认后可继续完整自动化场景；正常用户的首次协议确认要求保持不变。

具体交付与未覆盖范围必须以下列验证记录为准：

- [1.3.6 验证记录](VALIDATION_1.3.6.md)
- [生图画布库调研](IMAGE_STUDIO_RESEARCH_1.3.6.md)
- [更新日志](CHANGELOG.md)

1.3.5 中已经完成并记录的桌面体验、桌宠、启动展示和正式包元数据保持不变。1.3.6 的本地安装器与 ZIP 元数据已完成核对；尚无公开 ZIP 直链，因此暂不生成发布 SQL。

## English Draft

**Mingshen Harness 1.3.6: Local Image Studio Canvas Library**

Mingshen Harness 1.3.6 turns Image Studio canvases from transient workspace entries into a local project library. New and imported canvases are stored under local application data and can be reopened from **My Canvases** after their tabs close. The library supports search, rename, duplicate, delete and reveal-file actions, and separates importing an image asset from importing a canvas project.

This release separates canvas projects, image assets and open tabs. Closing a tab no longer means deleting a project, and duplicating a canvas does not duplicate shared image binaries. The main process resolves files from validated canvas IDs instead of accepting arbitrary renderer paths. Canvases from the previous workspace format are migrated on first use with a backup of the old value.

Valid generated images are saved at their actual dimensions even when a provider returns a different size from the request, with a visible mismatch warning instead of discarding the result.

The local plugin `BeforeModelRequest` prompt hook now supports request-content placement and formatting. `position` accepts `before` / `after`, and `format` accepts `context` / `plain`; the backward-compatible default remains `before + context`. `position: "after"` with `format: "plain"` can append declared text directly after the original request content without a plugin heading, for example `xxxx` followed by `123abc`. This controls placement in the outgoing model request, not text after the response. In tool-result rounds, the host preserves the complete call/result pairing and follows the wire protocol by adding ordinary user text after the tool-result content, either as a text block in the existing user content or as a separate user tail message. It is never inserted between a tool call and its result. Plain text remains ordinary user-priority content, is not promoted to a system instruction and gains no permissions. Hook text is added per request and is not written into conversation history.

The startup smoke test now targets the main interface rather than the short-lived startup presentation, allowing the full scenario to continue after first-use consent. Normal users must still explicitly accept the policies.

Source regression, type checking, lint, production build, resource preflight, isolated Electron smoke, and local NSIS/ZIP packaging have passed. The artifacts have not been installed; upgrade and uninstall are not validated, and the release has not been published.

The locally verified artifacts in `apps/desktop/release-artifacts/` are `MingshenHarness-1.3.6-x64.exe` (379,034,508 bytes, SHA-256 `0f767921cde4cbb826eaa74b7a7a8a679e7051947570be8873db72e096317906`) and `MingshenHarness-1.3.6-x64.zip` (378,102,275 bytes, SHA-256 `b989ad93ca44a5438d2d524064d7e0b78981fe9a6fd60ba0c7247eba98163a7b`).

Actual delivery and residual limitations are governed by:

- [1.3.6 validation record](VALIDATION_1.3.6.md)
- [Image Studio canvas research](IMAGE_STUDIO_RESEARCH_1.3.6.md)
- [Changelog](CHANGELOG.en.md)

The completed 1.3.5 desktop-experience work, desktop companion, startup presentation and package metadata remain historical facts. A public ZIP URL was not supplied, so a 1.3.6 release SQL has not been generated.
