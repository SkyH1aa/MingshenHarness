-- Run migrations/0003_zip_updates.sql once before publishing ZIP updates.
-- Run manually in the Supabase SQL Editor as the project owner.
-- ZIP hash, size, sidecars and embedded installer verified locally on 2026-11-19.
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
  '1.3.3',
  'https://github.com/SkyH1aa/MingshenHarness/releases/download/V1.3.3/MingshenHarness-1.3.3-x64.zip',
  $notes$1.3.3 更新公告

- 三模式工作台：CodeAgent与WorkAgent共用会话、历史和工作目录，可在任务结束后切换；ChatAgent使用独立分组对话页，仅开放联网搜索、网页读取和主动上传附件的只读问答。
- WorkAgent办公增强：支持Word旧稿局部编辑与精细排版、结构化Excel创建和编辑、PPT旧稿文字/表格/备注受控修改，以及设计预设和商务版式。Office已安装且条件允许时可选重算与渲染检查，未验证项明确标注。
- 专业技能：补齐124个Work物理来源入口，保留同名PDF的不同版本，新增PPT Master与ASD-STE100适配；来源默认可发现，正文按需加载，不等同于124个独立原创技能。
- 本地插件市场：内置SkillCreator、PluginCreator与Harness接口适配技能，支持开发、校验、手动安装、启停和更新；Skills与插件可自动发现，也可手动引用，单扩展文件上限提高至20000。
- CodeAgent工程增强：按需技能、连续失败换策略、大工具输出分页读取、受控文件检查点，以及代码索引、诊断、测试、Lint和类型检查闭环。
- 自动消息队列：主界面三模式最多保存10条后续消息和附件，上一任务正常完成后按加入顺序自动发送；可编辑和删除，停止、失败或重启后保留并暂停。
- 后台SubAgent协作：移除固定10分钟总运行期限，主Agent派发后可继续工作，再收集结果；取消及单次请求超时仍生效。
- 光轨与快捷Chat：优化布局、任务区和状态动效，支持小窗置顶、自定义快捷键与占用检测；修复警示图标撑高及输入框自行跳转预览。同步双语文档，schema9迁移保留已有数据。$notes$,
  now(),
  true,
  'zip',
  '39039e54ec234f0c23ce629a6cb81aac5f26f979a264ff6f60f390f245d12d90',
  318504814
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
