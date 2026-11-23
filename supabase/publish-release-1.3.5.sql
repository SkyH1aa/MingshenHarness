-- Run migrations/0003_zip_updates.sql once before publishing ZIP updates.
-- Run manually in the Supabase SQL Editor as the project owner.
-- ZIP size, hash, sidecars, JSON metadata and embedded installer verified locally on 2026-11-23.
-- Download URL supplied by the maintainer; the remote ZIP was not downloaded in this check.
-- Rebuilding or replacing the ZIP requires verifying its hash and byte size again.

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
  '1.3.5',
  'https://github.com/SkyH1aa/MingshenHarness/releases/download/V1.3.5/MingshenHarness-1.3.5-x64.zip',
  $notes$1.3.5 更新公告

- 简约主题：优化工作区层级、留白、焦点反馈与空状态布局。
- 启动展示：新增可关闭、可跳过的原子标识启动动画；正常情况下约5秒，并可在展示期间预热有限的会话索引，不读取正文或密钥。
- 桌面宠物：新增可选桌宠、任务状态面板、快捷Chat、动作互动、待机趣味动作及显示设置；支持拖动、置顶、尺寸和透明度调整。桌宠不接收会话正文、文件内容、工作目录路径、命令参数或审批详情。
- 插件与联网：修复内置插件创建技能和参考资源加载；支持逐次模型请求的prompt-only扩展钩子。联网请求预算提高至90秒，并区分取消、超时和网页服务错误。
- Chat会话：支持跨分组批量归档、恢复和删除；删除前停止任务，失败项保留供重试。
- 保留现有CodeAgent、WorkAgent、ChatAgent、工作站、Skills、消息队列、快捷Chat、Office工具及权限边界。数据库schema、协议修订号和原子应用图标保持不变。$notes$,
  now(),
  true,
  'zip',
  'c7dec5c38ac1af95f737752bd44f82e0605b00fa0e8f736290665e971e9620e1',
  378071417
)
on conflict (version) do update
set
  download_page_url = excluded.download_page_url,
  notes = excluded.notes,
  published_at = excluded.published_at,
  is_active = excluded.is_active,
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
