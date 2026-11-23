# 生图画布库调研与 1.3.6 取舍

适用版本：1.3.6。核对日期：2026-11-23。

本文只记录产品研究与实施方向，不是 1.3.6 已完成或通过验证的证据。

## 共同模式

成熟生图或创作工具通常把以下三类对象分开管理：

1. **画布工程**：图层、尺寸、提示词、模型信息和素材引用，可关闭后重新打开。
2. **素材库**：生成图、导入图和可复用资源；工程引用素材，不把所有二进制重复塞进每个画布。
3. **打开标签或运行会话**：表示当前正在编辑或执行的对象，关闭标签不等于删除持久工程。

Mingshen Harness 1.3.4/1.3.5 已有图层、素材、本地导出和可移植工程，但画布仍主要嵌在单一工作区状态中，缺少“我的画布”文件生命周期、关闭与删除分离，以及跨重启重开的明确入口。

## 对照

| 能力 | 成熟产品观察 | 1.3.6 取舍 |
| --- | --- | --- |
| 本地工程列表 | ComfyUI Workflows 从磁盘管理已保存工作流，区分打开、保存、重命名、删除与关闭标签 | 每张画布保存为独立 JSON 工程，顶部标签与“我的画布”分离 |
| 工程与素材分离 | ComfyUI Assets 和 Krea Drive 将生成、导入与组织资源独立于单个画布 | 共享 `image-studio/assets`，画布只保存引用和所需元数据 |
| 打开的会话与持久对象分离 | Runway 区分 Projects、Sessions 与 Assets；删除会话不自动等于删除资产 | 关闭标签只移出打开列表，删除工程必须从画布库显式执行 |
| 历史与生成参数 | Adobe Firefly 保留生成历史；ComfyUI Job History 显示任务状态 | 本轮先完成画布库；完整任务历史和重试作为后续增强 |
| 安全文件操作 | Krea Drive 使用回收/删除语义，成熟工具避免混淆临时关闭和永久删除 | 删除先移入本地回收位置，提交失败时恢复；复制共享素材而非重复保存 |
| 画布编辑 | ComfyUI Layer Editor 提供位置、尺寸、旋转、翻转、透明度、混合、撤销和导出 | 沿用现有图层能力，本轮不伪装新增蒙版或局部重绘 |

## 1.3.6 目标范围

- 独立本地画布工程，支持迁移、列表、打开、关闭、重命名、复制和删除。
- “我的画布”搜索和常用文件操作。
- 导入素材与导入画布拆分，保留既有可移植工程格式兼容。
- 主进程校验画布 ID、文件类型、大小和格式；Renderer 不传任意本地路径。
- 关闭不删除，复制复用共享素材，删除与保存串行化。
- 已保存画布仍引用的素材不得无提示删除。

## 暂不宣称的能力

- 本轮不新增蒙版、局部重绘、混合模式、完整撤销/重做或 PSD 导出。
- 不把现有 OpenAI Images 兼容接口宣传成支持所有模型的高级编辑能力。
- 任务历史、收藏、云同步、回收站恢复界面和生成批次重试需要后续独立设计与验证。
- 静态源码、TypeScript 类型或 UI 截图不能替代真实文件操作、重启恢复、Windows 权限和正式安装验收。

## 一手来源

- [ComfyUI Workflows](https://docs.comfy.org/interface/workflows)
- [ComfyUI Assets](https://docs.comfy.org/interface/assets)
- [ComfyUI Job History](https://docs.comfy.org/interface/job-history)
- [ComfyUI Layer Editor](https://docs.comfy.org/interface/layer-editor)
- [ComfyUI Shortcuts](https://docs.comfy.org/interface/shortcuts)
- [Krea Drive](https://www.krea.ai/krea-drive)
- [Runway Projects, Sessions and Assets](https://help.runwayml.com/hc/en-us/articles/23998498329107-Navigating-and-Project)
- [Adobe Firefly generation history](https://helpx.adobe.com/firefly/using/generation-history.html)
