# Supabase 初始化

## 1. 执行 SQL

在 Supabase SQL Editor 中按顺序手动执行：

1. `migrations/0001_init.sql`
2. `migrations/0002_optional_pg_cron.sql`，仅在项目允许 `pg_cron` 时执行
3. `migrations/0003_zip_updates.sql`，1.2.6 ZIP 更新必需，已部署项目可直接追加；不改旧 RPC 的返回字段

不要在客户端执行这些文件。

## 2. 发布新版本

只通过 SQL Editor、服务端任务或 Supabase Dashboard 写入发布记录。`anon` 角色不能直接写表。

当前源码为1.3.1，维护者已于2026-11-11自行打包。对应发布文件为 [publish-release-1.3.1.sql](publish-release-1.3.1.sql)，已核对本地ZIP、`.zip.json`和`.zip.sha256`，填入实际哈希与字节大小；执行前只需将下载地址占位符换为该ZIP的公开HTTPS直链。下方仍为结构示例，不能原样执行。`publish-release.sql` 保留1.3.0历史公告和元数据，不是当前发布文件。新包须重新核对元数据，不能沿用旧包哈希。历史过渡版1.2.6的 `publish-release-1.2.6.sql` 保留下载网页（`page`，哈希/大小为空）示例；执行前需部署0003并确认链接中的安装包版本。不要将分享网页标记为ZIP直链。

```sql
insert into public.mingshen_app_releases (
  version,
  download_page_url,
  notes,
  published_at,
  is_active, package_format, package_sha256, package_size
)
values (
  '1.3.1',
  'REPLACE_WITH_PUBLIC_HTTPS_ZIP_URL',
  '修复 ...',
  now(),
  true, 'zip', 'REPLACE_WITH_64_CHARACTER_ZIP_SHA256', 1 -- replace hash and byte size
);
```

`version` 必须严格符合 `x.x.x`，每段 1 到 3 位数字。1.2.7 起 `download_page_url` 沿用字段名但填写公开 HTTPS ZIP 直链。`package_format='zip'` 必须附 ZIP 的 SHA-256；`package_size` 是实际字节数。当前完整可重复执行文件见 `publish-release-1.3.1.sql`；不要原样执行任何下载地址或哈希占位符。`package-win.cmd` 在生成 EXE 后自动生成 ZIP、哈希和 JSON，已有 EXE 可用 `node scripts/create-update-zip.cjs <EXE路径>`。

1.3.1 ZIP为293688365字节，SHA-256为`d1f65003f805f2c854c2095d097a0f70ff9d67953ab55e06f32854793b6e6dd3`，对应`MingshenHarness-1.3.1-x64.zip`，仅下载直链待填写。`publish-release.sql`继续保留2026-11-10实际1.3.0 ZIP哈希及293630075字节大小。相同版本重新发布不会触发已安装同版本客户端的升级提示。本轮只生成发布文件，没有执行云端SQL或上传包。

停用错误发布：

```sql
update public.mingshen_app_releases
set is_active = false
where version = '1.3.1'; -- replace with the exact incorrect release version
```

1.2.6 客户端优先通过 `public.mingshen_get_latest_release_v2()` 获取最新一条记录，404 时回退旧 RPC；旧客户端四字段接口保留，不允许直接查询表。

## 3. 客户端调用

更新检查：

```http
POST /rest/v1/rpc/mingshen_get_latest_release_v2
apikey: <publishable-key>
Content-Type: application/json

{}
```

正常返回数组，最多一条记录。

日志和崩溃报告分别调用：

- `public.mingshen_submit_telemetry(...)`
- `public.mingshen_submit_crash_report(...)`

两个 RPC 都要求客户端生成稳定的 `client_event_id` UUID。重复提交同一事件不会重复写入。

允许的 `metadata` 键：

- `error_family`
- `module`
- `os_build`
- `arch`
- `locale`
- `feature`
- `tool`
- `http_status`
- `duration_ms`

不得写入 prompt、回答、代码、命令、绝对路径、供应商 URL、API Key 或原始崩溃 dump。客户端即使提交这些字段，RPC 也会拒绝未知 metadata 键；`diagnostic_summary` 和 `redacted_stack` 仍必须由客户端先脱敏。

## 4. 保留期

诊断数据默认保留 30 天。

- 执行 `0002_optional_pg_cron.sql` 后，每天 03:17 自动清理。
- 不启用 `pg_cron` 时，可在后台任务或维护窗口调用 `public.mingshen_purge_expired_diagnostics()`。

## 5. 验证

使用 publishable key 调用两个 `mingshen_get_latest_release` / `mingshen_get_latest_release_v2` 应各返回最多一条；旧网页记录为 `page`，ZIP记录附哈希和大小。自动安装须用户确认，不绕过 Windows 安全提示；完整流程见 `docs/SUPABASE_DEPLOY.md`。

以下请求应失败或返回空权限错误：

```http
GET /rest/v1/mingshen_app_releases?select=*
apikey: <publishable-key>
```

`mingshen_telemetry_events` 和 `mingshen_crash_reports` 同样不能直接 SELECT。
