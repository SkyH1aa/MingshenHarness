-- Publish 1.2.6 using a download page, as agreed for the transition release.
-- Run migrations/0003_zip_updates.sql once before this script.
-- The URL below is the existing share page supplied by the maintainer.
-- Confirm it hosts 1.2.6, or replace it with the correct 1.2.6 page before running.
-- For 1.2.7+ ZIP direct downloads, use publish-release.sql instead.

insert into public.mingshen_app_releases (
  version, download_page_url, notes, published_at, is_active,
  package_format, package_sha256, package_size
)
values (
  '1.2.6',
  'https://1828041119.share.123pan.cn/123pan/oTfUjv-UDtH3',
  $notes$1.2.6 更新公告

1. 会话导航：子 Agent 默认收进主会话，箭头展开/折叠，右键打开操作菜单；默认显示最近三个主会话，增量搜索、分页和虚拟列表优化大量历史加载。
2. 任务工作台：展示真实待办、完成状态与 Agent 任务树；计划支持编辑、依赖、断点、暂停、恢复及跨会话项目计划库。
3. Agent 配置：新增代码审查、审查子任务、运维排障、排障子任务、灵感创作和头脑风暴，合计十个内置配置；全部已启用自建 Agent 均可选择并查看简介。
4. 代码能力：本地多语言索引提供定义、引用、调用及导入证据；读取缓存与并发去重；代码任务加入显式测试、Lint、类型检查及最多三轮失败反馈。
5. 执行协调：同类操作可限本会话批量批准；并发写入冲突由用户选择并重新检查。保留工具边界恢复点，不确定副作用须核实后继续。
6. 阅读体验：返回底部与恢复自动跟随合并为一个侧边箭头，上滑暂停跟随，减少正文遮挡。
7. 更新机制：本版起具备后台 ZIP 下载、SHA-256/大小校验、安全解压、进度、取消和重试；会话结束后退出并启动安装器。1.2.7 起使用 ZIP 直链，Windows 安全提示保留。
8. 数据与文档：永久保留旧版本本地数据库逐级升级，保留历史、配置、同意记录与密文凭据；当前 schema 7，失败回滚。同步中英文内嵌文档，无新增自动云端收集。$notes$,
  now(), true,
  'page', null, null
)
on conflict (version) do update set
  download_page_url = excluded.download_page_url,
  notes = excluded.notes,
  published_at = excluded.published_at,
  is_active = excluded.is_active,
  package_format = excluded.package_format,
  package_sha256 = excluded.package_sha256,
  package_size = excluded.package_size
returning version, download_page_url, notes, published_at,
  package_format, package_sha256, package_size;
