-- Run migrations/0003_zip_updates.sql once before publishing ZIP updates.
-- Publish manually after uploading the verified 1.3.1 Windows x64 ZIP.
-- Replace REPLACE_WITH_PUBLIC_HTTPS_ZIP_URL with this ZIP's public HTTPS direct link.
-- Verified against the local ZIP, .zip.json and .zip.sha256 on 2026-11-11.
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
  '1.3.1',
  'REPLACE_WITH_PUBLIC_HTTPS_ZIP_URL',
  $notes$1.3.1 更新公告

- 供应商与模型：设置和聊天模型菜单支持长按拖动供应商排序；所有模型选择入口统一提供可折叠的星标模型组，显示“模型ID（供应商名）”。排序和收藏自动保存，重启后保留。
- 批量会话管理：设置中按工作文件夹和归档状态筛选，支持跨页勾选并批量归档、恢复或删除主会话及其子会话，逐项显示处理结果。
- 草稿持久保存：新会话、已有会话及子会话保存未发送文字、格式状态和附件，切换、正常退出及重启后可恢复；发送成功后仅清除对应版本的草稿。
- 格式粘贴：输入框支持直接预览Markdown、LaTeX和数学公式，可切回原文编辑，在设置中开启或关闭；实际发送保留原始内容。
- 文档工具：DOCX增加原生可编辑公式、Markdown、脚注、目录、页眉页脚和受控模板填充；DOCX/PPTX支持原生图表与内嵌数据工作簿，PDF支持离线Markdown与公式排版。
- 界面与性能：修复文件栏无法滚动、光轨标题与按钮重叠、长错误及详情开合导致对话偏移的问题；折叠工具详情按需渲染，减少长历史的重复处理。
- 项目诊断：未配置适用的检查器时跳过自动检查，避免虚假成功记录；已配置诊断器的启动和真实检查失败继续明确显示。
- 同步双语手册与更新日志，保留既有历史数据、配置、数据库迁移及权限保护。$notes$,
  now(),
  true,
  'zip',
  'd1f65003f805f2c854c2095d097a0f70ff9d67953ab55e06f32854793b6e6dd3',
  293688365
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
