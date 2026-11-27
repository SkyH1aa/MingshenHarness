-- Prerequisites: migrations/0001_init.sql and migrations/0003_zip_updates.sql.
-- Run manually in the Supabase SQL Editor as the project owner.
-- Fill v_download_url with the public HTTPS ZIP direct link before execution.
-- An empty URL deliberately aborts the transaction; no release is published.
-- Verified locally on 2026-11-27 against the newly rebuilt ZIP and its embedded installer.
-- Rebuilding or replacing the ZIP requires recalculating its byte size and SHA-256.
-- ON CONFLICT replaces and reactivates the existing 1.3.7 release, if present.
-- Clients already on 1.3.7 need the rebuilt installer manually; same-version updates are not automatic.

begin;

do $release$
declare
  v_download_url text := '';
begin
  v_download_url := btrim(v_download_url);
  if v_download_url = '' then
    raise exception '请先填写 v_download_url：1.3.7 更新 ZIP 的公开 HTTPS 下载直链。';
  end if;
  if v_download_url !~* '^https://[^[:space:]]+$'
     or char_length(v_download_url) > 2048 then
    raise exception '下载直链须为不含空白、最多 2048 字符的公开 HTTPS URL。';
  end if;

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
    '1.3.7',
    v_download_url,
    $notes$1.3.7 更新公告

- 生图工作台新增独立 OpenAI Images 协议，支持最多 3 个并发请求，每项等待预算 600 秒；远程图片可预览、确认保存或在默认浏览器打开。
- 完善断流重试、统一运行状态、幂等发送、事件续接和准确停止，保留已完成工具结果，减少长任务重复执行。
- 补齐桌面 IPC、旧 HTTP API、/v1 及后台工具、插件 Hook、办公检查的失败诊断；日志最多保留 30 天 / 15 MiB，新增留存统计和已知遗漏提示。
- 修复生图画布滚轮反复报警、旧 Electron 控制台接口及重复 IPC 错误记录，改进诊断隐私处理。
- 新增全局一键已读，完善管理策略、工具结果校验、任务认领、Office/PDF 交付回执及本地 API、SDK、CLI、ACP。

升级前请备份数据目录，数据库为 schema 11。已安装 1.3.7 的用户需手动运行本次新版安装器。$notes$,
    now(),
    true,
    'zip',
    '6c0af48b0f21f7081a3a3ec47e508851091e0e59bc4b04fe437f4ad680bd71d2',
    374330516
  )
  on conflict (version) do update
  set
    download_page_url = excluded.download_page_url,
    notes = excluded.notes,
    published_at = excluded.published_at,
    is_active = excluded.is_active,
    package_format = excluded.package_format,
    package_sha256 = excluded.package_sha256,
    package_size = excluded.package_size;
end;
$release$;

select
  version,
  download_page_url,
  notes,
  published_at,
  package_format,
  package_sha256,
  package_size
from public.mingshen_app_releases
where version = '1.3.7';

commit;
