-- Run migrations/0003_zip_updates.sql once before publishing ZIP updates.
-- Run manually in the Supabase SQL Editor as the project owner.
-- Replace the HTTPS placeholder with the public GitHub Release ZIP direct link before execution.
-- ZIP size, hash, sidecars, JSON metadata and embedded installer independently verified locally on 2026-11-24.
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
  '1.3.6',
  'https://example.invalid/REPLACE_WITH_PUBLIC_HTTPS_ZIP_URL',
  $notes$1.3.6 更新公告

- 生图工作台支持本地画布管理、参考图、拖放导入和后台生成。
- 素材支持批量加入画布、ZIP 导出、删除及绑定提示词清理。
- 单次图片导入和批量 ZIP 导出使用独立的 500 MiB 图片预算；ZIP 导出显示素材与字节进度。
- 优化 Windows 安装资源布局，减少大量内置提示词和技能文件的单独复制。

保持现有工作区数据、供应商配置和权限边界。$notes$,
  now(),
  true,
  'zip',
  'c9c4b120115e2f66510e9201bf9cfac4a341b667d4e5a9cec98176066254d130',
  374137004
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
