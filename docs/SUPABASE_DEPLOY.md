# Supabase 部署与版本发布

## 1. 首次部署

1. 登录 Supabase 项目控制台。
2. 打开 `SQL Editor`。
3. 复制并执行 `supabase/migrations/0001_init.sql`。
4. 执行 `supabase/migrations/0003_zip_updates.sql`，启用 1.2.6 的 ZIP 更新元数据和 v2 RPC；已部署 0001 的项目只需补执行 0003。
5. 如果项目支持 `pg_cron`，再执行 `supabase/migrations/0002_optional_pg_cron.sql`。
6. 不执行 `0002` 时，需要另行定期执行 `public.mingshen_purge_expired_diagnostics()`。

不要把 SQL 文件放进客户端应用执行。所有 DDL 和发布数据都应通过 Supabase 控制台、服务端程序或受保护的管理员流程写入。

## 2. 验证首次部署

在 SQL Editor 中检查对象：

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('mingshen_app_releases', 'mingshen_telemetry_events', 'mingshen_crash_reports');

select proname
from pg_proc
join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
where nspname = 'public'
  and proname in (
    'mingshen_get_latest_release',
    'mingshen_get_latest_release_v2',
    'mingshen_submit_telemetry',
    'mingshen_submit_crash_report',
    'mingshen_purge_expired_diagnostics'
  );
```

验证匿名读取入口时，1.2.6 优先调用 `mingshen_get_latest_release_v2()`；云端未部署 v2 且返回 404 时回退旧 RPC。两者均只返回数值最大的一个已生效版本，不能直接读取 `mingshen_app_releases`：

```sql
select * from public.mingshen_get_latest_release();
select * from public.mingshen_get_latest_release_v2();
```

不要给 `anon` 授予 `public.mingshen_app_releases`、`mingshen_telemetry_events` 或 `mingshen_crash_reports` 的直接 `SELECT` 权限。

## 3. 发布新版本

本地源码当前为 **1.3.3**；维护者已于2026-11-19自行完成 **1.3.3** 打包，并提供GitHub Releases ZIP直链。使用 [supabase/publish-release-1.3.3.sql](../supabase/publish-release-1.3.3.sql) 发布该包：ZIP实际哈希和大小已与`.zip.json`、`.zip.sha256`核对，ZIP内安装器与旁置EXE内容一致，下载地址已填入维护者提供的直链。本轮未重新下载远端ZIP或执行云端SQL，发布是否生效需维护者执行后核对RPC。旧1.3.2/1.3.1/1.3.0 SQL保留各自历史公告和实际元数据。重新打包后须重新核对元数据，不能将旧包哈希/大小配上新版本号。发布记录需包含以下字段并手动执行：

历史过渡版 **1.2.6** 使用 `supabase/publish-release-1.2.6.sql`：执行 0003 后填 `package_format='page'`，哈希及大小为 `null`，旧客户端仍在默认浏览器打开下载网页。脚本保留维护者提供的分享页，执行前确认其中安装包已换为对应版本，或替换为正确地址。安装 1.2.6 或更新版本后，后续 ZIP 自动更新才由新客户端处理；不要把分享网页标成 `zip`。

- `version`：严格三段 `x.x.x`，每段 1–3 位数字，例如 `1.3.3`
- `download_page_url`：沿用旧字段名，ZIP 更新填公开 HTTPS ZIP 下载直链，不是网页；可经最多五次 HTTPS 重定向，不可带 URL 用户名/密码或指向私网
- `notes`：简短发布说明
- `package_format`：`zip`；旧网页记录维持 `page`
- `package_sha256`：ZIP 文件的 64 位 SHA-256，不是内部 EXE 的哈希，必填
- `package_size`：ZIP 的实际字节数（上限 2 GiB）；必须与本次上传的文件一致
- `published_at`：发布日期，默认 `now()`；未来时间尚不对用户生效

脚本使用 `on conflict (version)`，同版本重复执行会更新发布信息，不会产生重复记录。

当前`publish-release-1.3.3.sql`已填入实际ZIP的SHA-256 `39039e54ec234f0c23ce629a6cb81aac5f26f979a264ff6f60f390f245d12d90`及318504814字节大小，下载链接为`SkyH1aa/MingshenHarness`仓库`V1.3.3` Release下的`MingshenHarness-1.3.3-x64.zip`。ZIP根目录只有319403978字节的同版本安装EXE，内容与旁置EXE一致，安装器ProductVersion为1.3.3。本次只核对本地产物，没有重新下载远端ZIP。旧版本SQL保留对应哈希/大小，不要混用。客户端只提示严格更高的版本，已安装1.3.2及更早版本的用户会在有效发布1.3.3后收到更新提示；同版本重新打包不会触发更新提示。

发布后验证：

```sql
select * from public.mingshen_get_latest_release_v2();
```

## 4. 生成 ZIP 与发布文件

用户自行打包时执行：

```powershell
.\package-win.cmd
```

该入口按当前源码版本1.3.3生成 EXE 后自动生成同名 ZIP、`.zip.sha256` 和 `.zip.json`，输出至 `apps/desktop/release-artifacts`。2026-11-19维护者自行生成的1.3.3安装包已核对，旧版本产物继续保留。本轮生成发布SQL只读取核对已有产物，没有重新打包、上传或写入云端。生成新安装包后也可单独执行：

```powershell
node scripts/create-update-zip.cjs "apps/desktop/release-artifacts/MingshenHarness-1.3.3-x64.exe"
```

1.3.3 ZIP 根目录必须只有 `MingshenHarness-1.3.3-x64.exe`，无额外脚本、EXE、链接或嵌套安装器目录。上传 **ZIP** 到支持直链下载的服务，再把 JSON 中的版本、ZIP 哈希和大小填入对应发布 SQL。客户端不会猜下载网页中的按钮，不需要下载 `.sha256/.json` 旁文件，也不携带 Supabase Key、模型 Key 或浏览器 Cookie 下载。

打包后在仓库根目录查看1.3.3发布元数据：

```powershell
Get-Content .\apps\desktop\release-artifacts\MingshenHarness-1.3.3-x64.zip.json
```

发布后若 RPC 仍返回较高的测试版本（例如 `8.8.8`），需由维护者确认并停用该测试记录；客户端按数值选择最高生效版本，不会用 `1.3.3` 覆盖它。

1.2.6 用户逐次确认后后台下载/校验/解压，等待活跃会话结束、关闭数据库后启动安装器。取消/失败不执行，重启不自动执行旧缓存。旧客户端的四字段 RPC 不变，仍会把 ZIP URL 交给浏览器；旧网页记录在新客户端中仍为手动更新。SHA-256 检查不等于代码签名，ZIP 不能保证绕过 Windows SmartScreen 或组织风控。

只使用 `mingshen_` 命名表/RPC，不修改其他应用的 `apprelease`，无需给客户端开放整张表。发布后可在 SQL Editor 执行 `select * from public.mingshen_get_latest_release_v2();` 核对最多一条及哈希/大小。

## 5. 诊断数据

以下是 SQL 接口的接收约束。更新在首次同意协议后启动检查，每 24 小时检查，设置 → 关于可手动检查。诊断上传仍未启用；执行迁移只部署接口，不会自动上传用户数据。

客户端上报只允许写入脱敏后的：

- 匿名安装 ID
- 应用版本
- Windows 版本
- 错误代码
- 脱敏堆栈
- 模块和时间戳

不会上传 prompt、回答、代码、绝对路径、命令、API Key、供应商 URL 或原始崩溃 dump。

默认留存期为 30 天。执行可选的 pg_cron 迁移后，每天自动清理过期记录。
