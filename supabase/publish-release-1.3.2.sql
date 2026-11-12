-- Run migrations/0003_zip_updates.sql once before publishing ZIP updates.
-- Run manually in the Supabase SQL Editor as the project owner.
-- ZIP hash, size, sidecars and embedded installer verified locally on 2026-11-12.
-- Download URL supplied by the maintainer; remote ZIP not downloaded in this check.
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
  '1.3.2',
  'https://github.com/SkyH1aa/MingshenHarness/releases/download/V1.3.2/MingshenHarness-1.3.2-x64.zip',
  $notes$1.3.2 更新公告

- Gemini 原生协议：新增 GenerateContent 与 x-goog-api-key 鉴权，支持原生流式响应、思考、工具调用、图片/音频/PDF输入、分页模型发现和连接测试。
- Gemini 与 DeepSeek 适配：新增模型体系配置，保留接口实际返回的推理续接状态、不透明签名及工具顺序；兼容隐式缓存与缓存用量统计，不自动创建收费显式缓存。
- 文档工具：DOCX/PDF 表格单元格支持多段文字、行内格式、Markdown、列表、代码、引用和公式；DOCX 表格公式可在 Word 中原生编辑，模板填充同样支持。
- 状态与数据保护：Token Saver 保留原生状态消息和工具配对，未完成或异常响应不执行工具；新增 schema8 迁移，保留已有供应商、Key、模型、会话、消息和设置。
- Windows 构建：修复迁移目录后 Electron 运行时缺失及实验版启动路径问题，打包前自动准备并检查运行时。
- 同步双语手册、更新日志及隐私说明。缓存命中取决于供应商、请求和路由，不保证固定命中率。$notes$,
  now(),
  true,
  'zip',
  '14883fad61715f6f7a03f3a334dead291f983e14f1056c971fd7c84d0e173a23',
  293723586
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
