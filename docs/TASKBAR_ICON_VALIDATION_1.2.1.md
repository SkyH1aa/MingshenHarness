# Windows 任务栏图标修复记录

版本保持 1.2.1。本次不生成安装包。

## 原因与修复

本机历史 `Electron.lnk` 与 `Mingshen Harness Dev.lnk` 都登记了旧的
`com.mingshen.harness.experimental` AppUserModelID。前者仍指向原生 `electron.exe`，
没有自定义图标。仅修改窗口图标、快捷方式图标或实验 EXE 的图标，不能消除重复身份。

实验版改用固定的 `com.mingshen.harness.experimental.desktop`；正式版 ID 不变。
原生 Electron 开发调试另用 `com.mingshen.harness.development.electron`，防止后续调试
重新污染正常实验版。实验版通知 CLSID 固定，窗口和开始菜单入口使用相同身份。
保留原图标、版本和本地数据目录，不清除 Windows 全局图标缓存，不删除其他程序的入口。

## 专项验证

- `pnpm typecheck` 和生产构建通过。
- 通知服务 13 项单元测试通过，19 项打包资源预检通过。
- 连续两次独立启动、退出、再启动，原生窗口属性均返回新 AppUserModelID 和批准的 ICO 路径。
- 使用 `WM_GETICON` 读取实际窗口的大小图标并导出 PNG，核对为已确定的原子图标。
- 正常实验版快捷方式读取确认：新 ID、专用 EXE、正确 ICO；旧 Electron 入口仍为旧 ID。
- 实际 Windows 通知创建、COM 快捷回复回到原会话、角标清除通过。

使用 `node scripts/taskbar-restart-smoke.mjs` 可复验两次干净启动；
`node scripts/notification-smoke.mjs --native` 可复验原生通知。
原生窗口图标读取并不等于自动截取 Windows 任务栏本身，本次未执行整机重启或全面测试。
