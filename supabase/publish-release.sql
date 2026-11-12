-- Run migrations/0003_zip_updates.sql once before publishing ZIP updates.
-- Preserved 1.3.0 package release. This is not the current 1.3.1 source release.
-- Run manually only after uploading the verified 1.3.0 ZIP package.
-- For the 1.2.6 transition release using a web page, use publish-release-1.2.6.sql.
-- Replace REPLACE_WITH_PUBLIC_HTTPS_ZIP_URL with the uploaded public HTTPS ZIP direct link.
-- ZIP hash and size match MingshenHarness-1.3.0-x64.zip.json and the local ZIP on 2026-11-10.
-- Rebuilding or replacing the ZIP requires verifying and updating its hash and size again.

insert into public.mingshen_app_releases (
  version,
  download_page_url,
  notes,
  published_at,
  is_active,
  package_format,
  package_sha256,
  package_size
)
values (
  '1.3.0',
  'REPLACE_WITH_PUBLIC_HTTPS_ZIP_URL',
  $notes$1.3.0 更新公告

• 光轨工作台：新增独立工具轨、会话侧栏、面包屑、执行时间轴和底部状态栏，右侧同时查看文件审查与任务/Agent；保留简约风格，两种风格分别记住项目布局。主界面模型显示供应商名称。
• 完整运行详情：活动、命令、参数、结果、模型诊断及集成状态支持展开、收起和复制，长内容可独立滚动，查看详情时保留阅读位置。
• 文档制作：内置生成可编辑DOCX/PPTX及可选中文字PDF，支持表格、分页、幻灯片、讲者备注和本地图片，无需安装Office或Python，保留审批、版本与取消保护。
• 子Agent模型：按Agent配置独立模型，或继承主会话模型，手动调用与自动委派共用配置。
• 工作区记忆：设置中可手动选择工作文件夹，配置原生/TencentDB后端、记忆分析模型及备用；未配置分析模型时沿用当前主会话模型，切换后端保留两套数据。
• 语义记忆：TencentDB按官方固定版本的通用提示词提取事实、偏好和指令，判断新增、跳过、更新或合并；已确认偏好受保护。主分析失败时备用从原始输入重做，分析调用计入模型用量。
• 工具能力：支持工作区图片与浏览器截图的原生视觉输入、持续命令输入/输出及停止、按行与长行分页读取；最多3个独立内置只读调用并发，子任务可请求父会话执行验证。
• 模型与连接：新模型提供可编辑的参数预填，上下文与输出支持K/M输入；已保存供应商可编辑名称、地址和协议，并保留模型、Key与会话引用。
• 上下文优化：兼容供应商返回的Responses原生状态，保护带图及不透明状态消息；Token Saver新配置默认关闭按轮次提前摘要，保留窗口压力保护及已有配置。
• 兼容修复：完善光轨日夜主题、草稿与重载保护，修复空白图标恢复和Windows ASAR文档依赖误报；同步双语手册及许可，保留现有历史、配置和数据库迁移。$notes$,
  now(),
  true,
  'zip',
  '551d665b93f174bf8f6ea8faa13647838ea22840ee83f66759d23afc98a35d17',
  293630075
)
on conflict (version) do update
set
  download_page_url = excluded.download_page_url,
  notes = excluded.notes,
  published_at = excluded.published_at,
  is_active = true,
  package_format = excluded.package_format,
  package_sha256 = excluded.package_sha256,
  package_size = excluded.package_size
returning
  version,
  download_page_url,
  notes,
  published_at,
  package_format,
  package_sha256,
  package_size;
