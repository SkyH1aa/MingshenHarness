# Mingshen Harness 1.3.6

> 发布状态：本地 1.3.6 源码和随包文档包含素材批量管理、提示词联动清理、参考图、拖放导入、后台生图、500 MiB 导入/导出预算及导出进度。本页是发布说明草案，不表示已上传或发布；安装器未运行，安装、升级和卸载未验收。发布 SQL 使用本地最终 ZIP 的 SHA-256 和字节数，公开 HTTPS 直链保留占位，由维护者上传并在执行前替换。完整结果与未覆盖范围见验证记录。

本地打包产物位于 `apps/desktop/release-artifacts/`：

### 当前本地包

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `MingshenHarness-1.3.6-x64.exe` | 见旁置元数据/文件属性 | Windows 文件版本与产品版本均为 `1.3.6` |
| `MingshenHarness-1.3.6-x64.zip` | 见 `.json` 中的 `size` | SHA-256 与字节数见安装包旁的 `.sha256` 和 `.json` |

Windows 文件版本与产品版本均为 `1.3.6`。ZIP 仅含根条目 `MingshenHarness-1.3.6-x64.exe`，其大小和 SHA-256 与外部安装器完全一致；ZIP sidecar 与 JSON 元数据必须对应当前最终 ZIP。对当前源码或随包文档的任何后续修改都要求重新打包，不能沿用先前版本的 SHA/大小。

## 中文发布草案

**Mingshen Harness 1.3.6：本地生图画布库与参考图**

Mingshen Harness 1.3.6 将生图工作台的画布从临时工作区条目升级为本地工程库。新建或导入的画布保存在应用数据目录，关闭标签后仍可从“我的画布”重新打开；画布库支持搜索、重命名、复制、删除和定位文件，并明确区分导入图片素材与导入画布工程。

素材栏支持对搜索结果批量选择、加入当前画布、导出单个 ZIP 或确认删除；删除素材会清除该素材绑定的生成提示词记录和旧工作区备份，但不改变当前正负提示词。最多可选 200 张，ZIP 内源图片数据合计限制为 500 MiB，导出过程中显示已处理素材数和字节进度；任一素材仍被保存或打开的画布引用时，整批删除会被取消。

本轮重点是把画布内容、图片素材和当前打开标签拆成三个清晰层次。关闭标签不再等同于删除工程，复制画布不会重复复制共享图片；主进程按合法画布标识定位文件，Renderer 不提交任意本地路径。旧版工作区中的画布会在首次使用时迁移，并保留原设置备份。

也可以把图片文件直接拖入生图工作台，快速导入本地素材库；手动导入和拖放沿用同一套格式与大小校验，单图 25 MiB、每批最多 20 张且合计不超过 500 MiB。此路径不会自动加入参考图，画布工程仍通过独立入口导入。

生图工作台新增“使用参考图”，默认关闭并随工作区保存。开启后可按勾选顺序预览、移除并发送最多前三张参考图，超过三张时只使用前三张；也可手动上传 PNG、JPEG、WebP、GIF 作为参考，文件会进入本地素材库并自动选中。GIF 和 WebP 都会只取第一帧并转换为 PNG 后发送，转换后的参考图仍受单图 25 MiB 限制，素材库原文件不变，APNG 暂不支持。没有参考图时继续使用 OpenAI Images 兼容 `/images/generations` JSON 请求；启用参考图后，单图和多图都改用 `/images/edits` multipart。网关不支持编辑、多图或相关参数时会明确报错，不会静默退回无参考生成。只有用户主动开启并明确选择的图片才会发给所选图片供应商，Renderer 只提交受控素材 ID，主进程负责校验、去重和读取。

生成请求发出后可切换到 ChatAgent 或 Mingshen 工作站继续工作。应用保持运行期间，生图工作台会在后台等待供应商响应，并把生成图片保存至素材库和当前画布；切换工作面不会取消请求。用户仍可在生图工作台主动取消，退出应用则结束尚未完成的请求。

生成素材现在会保留可信的生成提示词记录，把用户原始正面与负面提示词、供应商修订提示词分开保存。素材卡可把提示词重新导入当前工作区，每次都会先询问是否覆盖；取消不会改动现有内容，生成时明确为空白的负面提示词可经确认后清除当前负面字段，旧记录则保留当前负面字段。外部导入、旧版本或记录不完整时会明确提示无法可靠恢复，不猜测或拆分未知文本，也不清空当前提示词。素材选择栏支持全选搜索结果、清空选择、批量加入画布、ZIP 导出和确认后批量删除；可选最多 200 张，ZIP 内源图片合计上限为 500 MiB，并显示导出进度。删除会同步清理素材记录和迁移备份中的提示词；任一所选图片仍被保存或打开的画布引用时整批取消。

有效生成图片的尺寸与请求不一致时，仍按真实宽高保存并显示警告，不再丢弃已经成功返回的图片。

Windows 安装布局也已优化：内置提示词和技能资源改打入 `app.asar`，避免 NSIS 逐个复制上万个独立小文件；需要实际路径的 LSP、原生沙箱和插件 SDK 仍外置。安装器保留 electron-builder 默认的 7z 暂存解压及复制重试流程；没有用缺少该重试路径的 ZIP 直解来换取未经实测的速度承诺。打包后校验会从 ASAR 回读完整提示词树并逐文件比较 SHA-256。实际安装时间仍受杀毒扫描、磁盘和系统策略影响，本轮没有以用户机器完成安装耗时 A/B 测试。

本地插件的 `BeforeModelRequest` prompt Hook 新增请求内位置与格式控制。`position` 可选 `before` / `after`，`format` 可选 `context` / `plain`，默认仍为旧版 `before + context`。需要把声明文本直接跟在本轮请求原文后且不显示插件标题时，可配置 `position: "after"` 与 `format: "plain"`；例如原文 `xxxx` 后可直接跟随 `123abc`。这是对发往模型的请求内容排版，而不是在响应之后追加。工具结果轮次会保持完整 call/result 配对，按协议在工具结果内容之后添加普通用户文本块或独立 user 尾消息，不会把文本插到调用与结果之间。`plain` 仍为普通用户优先级内容，不提升为 system 指令或扩大权限。文本按每次请求临时附加，不写入会话历史。

测试启动流程现明确连接主界面而不是短时启动动画窗口，首次协议确认后可继续完整自动化场景；正常用户的首次协议确认要求保持不变。

具体交付与未覆盖范围必须以下列验证记录为准：

- [1.3.6 验证记录](VALIDATION_1.3.6.md)
- [生图画布库调研](IMAGE_STUDIO_RESEARCH_1.3.6.md)
- [更新日志](CHANGELOG.md)

1.3.5 中已经完成并记录的桌面体验、桌宠和启动展示保持不变。1.3.6 正式本地包需在本轮完整回归后重新生成；发布 SQL 只能引用该最终 ZIP 的实测 SHA-256、字节数及维护者提供的公开 HTTPS 直链。

## English Draft

**Mingshen Harness 1.3.6: Local Image Studio Canvas Library and References**

Mingshen Harness 1.3.6 turns Image Studio canvases from transient workspace entries into a local project library. New and imported canvases are stored under local application data and can be reopened from **My Canvases** after their tabs close. The library supports search, rename, duplicate, delete and reveal-file actions, and separates importing an image asset from importing a canvas project.

Image files can also be dropped onto Image Studio to import them into the local asset library. Manual import and drag-and-drop share a 25 MiB per-image, 20-files-per-batch and 500 MiB per-batch budget. They are not automatically selected as references, and canvas projects continue to use the separate import command.

Asset batch export accepts up to the 200-item library capacity, caps source image data at 500 MiB and reports processed asset and byte progress while producing the ZIP.

This release separates canvas projects, image assets and open tabs. Closing a tab no longer means deleting a project, and duplicating a canvas does not duplicate shared image binaries. The main process resolves files from validated canvas IDs instead of accepting arbitrary renderer paths. Canvases from the previous workspace format are migrated on first use with a backup of the old value.

Image Studio adds **Use reference images**, off by default and saved with the workspace. When enabled, up to the first three selected assets can be previewed, removed and sent in selection order; selecting more than three uses only the first three. PNG, JPEG, WebP and GIF files can also be uploaded as references and enter the local asset library automatically. GIF and WebP references both use only their first frame converted to PNG before sending. The converted reference remains subject to the 25 MiB per-image limit, and the original asset in the library is not replaced. APNG is not supported. Without references, requests continue through the OpenAI Images-compatible `/images/generations` JSON path. With references, both single-image and multi-image requests use `/images/edits` multipart. Unsupported edit, multi-image or related parameters produce an explicit provider error and never silently fall back to reference-free generation. Only images explicitly selected after the user enables references are sent to the selected image provider; the renderer submits controlled asset IDs while the main process validates, deduplicates and reads the files.

After a generation request is sent, you can switch to ChatAgent or the Mingshen workstation and continue working. While the application remains open, Image Studio waits for the provider in the background and saves returned images to the asset library and active canvas. Switching surfaces does not cancel the request. You can still cancel explicitly in Image Studio; application shutdown ends requests that have not completed.

Generated assets now keep a trusted prompt record that stores the user's original positive and negative prompts separately from the provider-revised prompt. An asset card can restore the prompts into the current workspace after an explicit overwrite confirmation; cancelling changes nothing. A generation explicitly made with an empty negative prompt can clear the current negative field after confirmation, while a legacy record keeps it. External imports, old records and incomplete records report that recovery is unavailable instead of guessing or splitting unknown text, and never clear the current prompts. The asset selection bar supports selecting all current search results, clearing the selection, adding selected images to the current canvas, ZIP export and confirmed deletion. Selection can use the 200-item library capacity; source image data in one ZIP is capped at 500 MiB, with processed asset and byte progress. Deletion removes matching prompts from asset records and the legacy workspace backup, and the entire batch is cancelled if any selected image is still referenced by a saved or open canvas.

Valid generated images are saved at their actual dimensions even when a provider returns a different size from the request, with a visible mismatch warning instead of discarding the result.

The Windows install layout was also optimized: built-in prompts and Skill resources are embedded in `app.asar`, preventing NSIS from copying more than 13,000 individual small files one by one. LSP, the native sandbox and the plugin SDK remain external where real filesystem paths are required. The installer retains electron-builder's default staged 7z extraction and copy-retry flow; it does not switch to direct ZIP extraction, which lacks that retry path, for an unmeasured speed claim. Packaging reads the complete prompt tree back from the ASAR and compares each file's SHA-256. Actual installation time still depends on antivirus scanning, storage and Windows policy; no install-time A/B was run on the user's machine.

The local plugin `BeforeModelRequest` prompt hook now supports request-content placement and formatting. `position` accepts `before` / `after`, and `format` accepts `context` / `plain`; the backward-compatible default remains `before + context`. `position: "after"` with `format: "plain"` can append declared text directly after the original request content without a plugin heading, for example `xxxx` followed by `123abc`. This controls placement in the outgoing model request, not text after the response. In tool-result rounds, the host preserves the complete call/result pairing and follows the wire protocol by adding ordinary user text after the tool-result content, either as a text block in the existing user content or as a separate user tail message. It is never inserted between a tool call and its result. Plain text remains ordinary user-priority content, is not promoted to a system instruction and gains no permissions. Hook text is added per request and is not written into conversation history.

The startup smoke test now targets the main interface rather than the short-lived startup presentation, allowing the full scenario to continue after first-use consent. Normal users must still explicitly accept the policies.

The 500 MiB import and batch-export budgets and batch-export progress are part of the current source. The installer must be rebuilt after documentation is frozen; earlier package metadata does not cover this change. The installer has not been run; installation, upgrade and uninstall are not validated, and the release has not been published.

The current files are in `apps/desktop/release-artifacts/`. Use the generated `.sha256` and `.json` sidecars for the exact ZIP size and digest; packaging verifies the EXE's measured size and version resources. This in-app document intentionally does not duplicate checksums that could become stale when bundled documentation changes.

Actual delivery and residual limitations are governed by:

- [1.3.6 validation record](VALIDATION_1.3.6.md)
- [Image Studio canvas research](IMAGE_STUDIO_RESEARCH_1.3.6.md)
- [Changelog](CHANGELOG.en.md)

The completed 1.3.5 desktop-experience work, desktop companion and startup presentation remain historical facts. The 1.3.6 local package must be rebuilt after final validation. A release SQL must use that final ZIP's measured SHA-256, byte size and a public HTTPS direct URL supplied by the maintainer.
