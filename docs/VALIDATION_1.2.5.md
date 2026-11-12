# Mingshen Harness 1.2.5 验证记录

核对日期：2026-11-05（Asia/Shanghai）。应用版本1.2.5，协议修订`2026-11-04.3`、数据库schema6不变。

## 范围与原因

用户反馈供应商/模型菜单超出屏幕无法选择，其他下拉列表有同类情况；部分新安装用户未出现三协议及同意后的使用手册。

模型菜单原来根据整个窗口设置固定最大高度，没有扣除触发按钮到窗口边缘的距离；`window`捕获scroll后无条件关闭菜单，内部滚动也会触发。Skills引用及CTX弹层也缺少基于实际位置的高度约束，命令/提及列表可能被composer父容器裁剪。

首次同意原来只比较`legal.acceptedVersion`，没有核对`legal.consent`中的三项记录；同意后立即展示手册仅存在于renderer临时状态，中途关闭/重载可丢失。未同意时的文档跳转也存在引用模式与同意模式混用的UI分支。无法凭本地夹具证明所有内测者的具体故障来源；保留旧用户数据的重装继承同意记录属于预期行为，不应通过清空数据来强制制造首次状态。

## 实现

- 新增`floating-panel.ts`计算上下可用空间、边距、宽度和maxHeight；`use-floating-panel.ts`统一定位、resize/父级scroll/输入区ResizeObserver及清理。内部滚动不关闭浮层，不影响外部页面。上方弹层使用bottom锚定，内容少时仍贴近触发点。
- ModelPicker改为外层实际限高滚动；供应商仍折叠分组。方向键、Home/End聚焦可见项，Enter选择后回触发按钮，Esc先关闭模型菜单、不关闭设置；仅滚动列表自身，不使用会改变祖先阅读位置的scrollIntoView。
- Skills引用面板header/search/footer保留，body可缩小并滚动；CTX按可用高度滚动。`/`和`@`使用body portal及统一定位，命令选择只调整列表自身滚动；`@`移除只取前八项的截断，仍遵守enabled/role/hidden筛选。
- DesktopController核对当前政策版本及三项true记录；缺项/旧形状不当作已同意。保留现有完整记录兼容，普通版本升级不重置同意。IPC在服务未就绪时明确失败，不以undefined表示成功。
- 同意后`legal.manualPending=true`，实际读取手册后才能执行`finish-onboarding`清状态；renderer重载或进程重启恢复pending手册。点击开始使用/关闭完成后不再自动显示，手动打开文档仍可用。既有完整consent且无pending字段按已完成处理。
- 未同意时始终保留三checkbox/五秒门槛，不因文档事件或内部引用变成可关闭的手册模式；没有自动勾选、代答或绕过。启动状态/本地文档失败有明确重试，accept busy防止重复提交。
- 中英文三协议适用版本、手册、更新日志、README/SECURITY/NOTICE、SDK、实验/打包提示和本地发布SQL模板同步1.2.5。协议正文、生效日期、修订和schema不变；未执行云端SQL。打包检查新增文档版本断言及ASAR不得含用户DB/同意记录的断言。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| `node scripts/v125-smoke.mjs` | 真实Electron8组通过，无未捕获renderer异常，使用独立OS临时profile，不访问用户数据库或真实Key |
| 首次与重启 | 全新profile的IPC拦截、三项checkbox/五秒、文档事件不可跳过、同意后1.2.5手册；完整退出重启恢复手册，完成后再次退出重启与renderer reload均无自动弹窗 |
| 异常状态 | 调试器仅在测试进程注入state/policy读取失败，界面可见且重试成功；临时数据库缺一项consent时不能被版本标记放行，恢复完整记录正常进入且不重复提示 |
| 长模型列表 | 1040×680内18供应商、末项28模型；真实CDP滚轮后仍展开，End/Enter能选择Model28；父设置页滚动和窗口缩放重新定位，Esc不关闭设置 |
| 其他菜单 | 高输入框下24Skills引用、CTX、斜杠菜单和16自定义Agent提及可见/可滚动/可选择；日夜主题及中英文截图已查看 |
| `node scripts/settings-focus-smoke.mjs` | 10组通过，包含3秒刷新、连续输入、Key/模型真实保存、光标/选区、中文IME及10份内嵌文档版本 |
| `node scripts/conversation-actions-smoke.mjs` | 11组通过，含斜杠过滤/键盘、技能插件引用、CTX、Plan、分支、手动压缩停止/503及紧凑英文布局 |
| `node scripts/compaction-smoke.mjs` | 9组通过，全局/会话/备用模型选择和持久化、85%边界、工具组、停止、HTTP503/双失败、本地SSE续跑 |
| `node scripts/desktop-smoke.mjs` | 通用桌面21项通过，含三协议/五秒/手册导航、中英文设置、关闭/托盘、原生沙箱实际写文件、503脱敏及隔离浏览器；只读更新RPC得到服务器1.2.4，本地1.2.5正确显示最新 |
| `node scripts/chat-scroll-smoke.mjs` | 19项通过，包含暂停/一次回底部/恢复跟随、键盘、内容收缩和多次切换会话；未改变既有滚动规则 |
| `pnpm.cmd test` | 50测试文件通过、2跳过；270项通过、8环境项跳过；新增定位5项及consent生命周期1项 |
| 静态检查/构建 | Biome160文件、main/renderer两套TypeScript和main/preload/renderer生产构建通过 |
| 打包/图标 | 路径/EPERM复制/Windows原生兼容/实验图标14项测试通过；用户入口`.\package-win.cmd --check`核对22资源、全部生产依赖及版本通过 |

专项初期修正了调试器过早require Electron的测试时序、selector引用和错误夹具channel，不把这些测试脚本问题记为产品修复。滚动回归最初在手册正文加载前点击了disabled的开始使用按钮，留下手册遮挡滚轮；脚本改为等待启用及手册实际关闭后，19项通过，没有放宽滚动断言。所有UI验收顺序运行，测试结束退出自身进程并清理自身临时目录。所有模型回归均本地夹具，不验证付费摘要语义质量或外部服务凭据。

## 交付与边界

最新源码构建可通过`.\run-experimental.cmd`启动。用户自行打包入口仍为根目录`.\package-win.cmd`，预期输出`apps\desktop\release-artifacts\MingshenHarness-1.2.5-x64.exe`。本轮未生成、安装或卸载NSIS，不代表跨Windows/企业策略/所有显示缩放组合已认证。BrowserDo/Embiody按既有用户要求免测，没有重新调用；不改用户数据或发布云端版本。

## 同版本补充：运行日志、最近会话与压缩计数

用户追加：全面记录可导出的运行异常，同文件夹默认仅显示最近使用三条，修复压缩后CTX数值/百分比未变。版本仍1.2.5，schema6、政策修订2026-11-04.3不变。

### 实现与原因

- RuntimeLogService以本地JSONL记录错误时间、来源、相关session/run/provider/model ID、状态与限长详情。捕获IPC抛错及失败结果、model-stream、provider列表/测试、审批和摘要每次主备失败（包括被成功备用恢复的尝试）、工具/运行/活动、MCP、更新/依赖、技能市场缓存回退、本地API、通知与主进程/界面异常。正常用户停止不作为模型请求网络错误处理。
- SecretStore保存/解密时注册已知凭据，写入前与导出时脱敏；JSON请求输入字段省略。日志不主动复制整段聊天、附件或源文件。第三方任意文本不能保证不含敏感内容，隐私说明要求分享前审查。没有自动上传。
- 设置 → 运行日志显示位置、容量与保留期限，可选择路径导出JSON。写入/导出/轮换串行；五文件各2MiB、约10MiB上限、30天条目期限、512待写上限和突发省略计数；致命main异常同步写盘。导出不能覆盖日志目录，写入失败不覆盖原操作错误。package afterPack额外拒绝私有runtime日志进入ASAR。
- SessionSidebar把“展开文件夹”和“展开全部会话”分开管理，按lastOpenedAt/updatedAt选三条；搜索遍历全部非归档记录。打开旧会话同步lastOpenedAt到renderer，原文件夹折叠/置顶/父子规则保留。
- 原手动压缩把供应商计数比本地估计多出的部分全部当固定成本，导致大量历史压缩后仍被加回。新增固定prompt/tool基准和比例，压缩成功按有效历史立即重新估算并持久化；旧observation需匹配checkpoint，避免把压缩前用量带回。原文保留，下一真实请求再校准。估算非供应商精确tokenizer；大固定提示仍占上下文。

### 实际结果

| 检查 | 结果 |
| --- | --- |
| `node scripts/runtime-logs-recency-smoke.mjs` | 真实Electron6组通过，独立临时profile/项目和本地HTTP/SSE；实际退出重启后日志保留 |
| 最近会话 | 六条同目录默认三条，展开六条/再收三条，打开旧会话进入近期；三秒后台刷新不重新打开关闭的文件夹；搜索能找到隐藏条目 |
| 手动CTX | 真实模型夹具校准85,000token，手动压缩降至38,651，主页面百分比同步，reload恢复相同数字；原消息保留 |
| 日志真实导出 | 用户按钮经真实IPC导出26条夹具日志，含provider模型列表/连接测试503、主审批503/备用无效裁决、主备摘要503、run_failed、renderer错误；测试密钥和整段历史均未出现 |
| 日志界面 | 中文夜间/英文日间截图已查看，1040×680下路径换行、导出和状态可用，无横向溢出 |
| logger单元 | 脱敏与cause/HTTP状态、JSONL重开、并发导出写入、30天条目与文件过期、约10MiB轮换、无关文件保留、磁盘失败、空导出、禁止覆盖活动日志、同步致命错误通过 |
| `node scripts/compaction-smoke.mjs` | 9组通过：85%下一轮触发、进度reload、全局/会话模型、工具边界续跑、停止、503、主备与双失败；12摘要/18聊天本地请求 |
| `node scripts/context-restore-smoke.mjs` | 6组通过，3次真实启动，仅1本地模型请求，未压缩32.5K计数/时间戳保持；模型切换/分支/旧记录迁移可用 |
| `node scripts/v125-smoke.mjs` | 最终构建8组通过，首次三协议/5秒/手册恢复、三次启动、长供应商/Skills/CTX/命令/Agent菜单及两语言主题回归 |
| `node scripts/conversation-actions-smoke.mjs` | 最终构建11组通过，分支聊天、斜杠菜单/重命名、引用、CTX、手动压缩/停止/503、Plan、归档和紧凑英文布局 |
| 全量单元 | 52测试文件通过、2环境文件跳过；279项通过、8环境项跳过 |
| 静态与构建 | Biome166文件、main/renderer两套TS、main/preload/renderer生产构建通过 |
| 打包清单 | `.\package-win.cmd --check` 22资源及版本1.2.5通过；未生成NSIS |

新增smoke最初两次因测试表达式缺括号和设置按钮selector不匹配中止，均为测试脚本问题，修正后6组完整通过；没有放宽产品断言。既有压缩/审批smoke需显式点“展开全部”才能选择六条以上测试会话，保持原来的后续断言。所有UI检查顺序运行且关闭自己的进程/清理自己的临时目录，不使用用户会话、私人凭据或外部付费模型，不重复BrowserDo/Embiody实测。

## 同版本补充：后台审批 Windows 通知

用户追加：请求批准面板出现时，软件可能不在前台，要求如完成通知一样使用Windows通知并提供批准/拒绝快捷按钮。版本保持1.2.5，不生成安装包。

实现位于ApprovalNotifications，复用CompletionNotifications唯一的全局激活分发。broker真实待审批驱动后台通知，当前前台会话只保留inline；最小化/托盘/查看其他会话后可提醒。自动模型审核中不弹竞争通知，失败转人工可提醒。每请求最多一次当前状态提醒，通知动作按tag映射并核对request/run/session/toolCall及审核状态；批准仅allow_once，拒绝带反馈，正文只打开会话。既有完全访问/本会话规则/隔离/Hook边界不变。请求已处理/停止/移除/重新自动审核时清路由，重复激活或重启旧通知不能决定下一请求。Windows不可用、关闭、失败和用户忽略均不放行操作。

通知设置新增approvalEnabled默认true、旧配置兼容。可单独关闭审批通知，或用nativeEnabled总开关；沿用预览与声音开关。摘要限长并脱敏，通知不附完整detail/reviewInput；隐私和手册说明本机锁屏/通知历史的暴露。错误进入新runtime日志。通知内容随当前中英文，外观随Windows；设置页保持应用日夜主题。

| 检查 | 结果 |
| --- | --- |
| 新通知/broker/完成通知单元 | 29项通过，包含并发逐条裁决、前后台/隐藏/最小化、重复回调、停止/删除/替换ID/重启旧tag、自动审核转人工、独立开关/旧设置、脱敏、发送/决定失败不放行及单一激活分发 |
| `node scripts/approval-notification-smoke.mjs` | 6组真实Electron/Windows检查通过，独立OS临时profile/项目、本地SSE |
| 原生批准/拒绝 | Windows历史XML存在两个原生按钮；读取实际XML参数后经COM激活；批准真实受保护工具写入指定文件，权限仍request_approval；拒绝不生成文件且结果回原会话 |
| 原生过期/前台 | 停止清通知，旧COM action不能决定同会话新请求；当前前台会话无重复toast，随后最小化产生可操作提醒 |
| 原生隐私/设置 | 英文Approve once/Reject、无标题/路径预览、silent=true、独立开关清通知/路由并保持pending；真实英文设置checkbox可见并持久化 |
| 既有通知回归 | `node scripts/notification-smoke.mjs --native`通过，完成通知XML、原生COM快捷回复、原模型续跑、未读数清除、中英文设置和新版内嵌手册均正常 |
| 最终静态/单元 | Biome168文件、两套TypeScript通过；53文件通过/2环境文件跳过，292项通过/8环境项跳过 |
| 构建/打包 | main/preload/renderer生产构建、22资源版本预检通过；版本1.2.5，未生成NSIS |

原生探针第一次读取中文使用默认控制台编码出现乱码，统一UTF8输出后验证通过；应用实际通知内容未因此改写。COM回调验证不等于人工点击Windows横幅，横幅显示/声音仍由系统通知、勿扰和组织策略控制。所有UI测试串行并退出自身进程；不访问真实用户DB/Key，不调用付费服务，不重新测试BrowserDo/Embiody。相关中英文手册/更新日志/隐私和README/交接已更新，政策修订及schema不变。
