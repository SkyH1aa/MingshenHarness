import { BookOpen, Box, LoaderCircle, Power, Puzzle, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import type { ExtensionImportResult, ExtensionView } from "../../../shared/domain";
import { tr } from "../i18n/index";
import { useDialog } from "./DialogProvider";
import { LocalPluginMarketplace } from "./LocalPluginMarketplace";
import { SkillMarketplace } from "./SkillMarketplace";
import { TokenSaverSettings } from "./TokenSaverSettings";

interface ExtensionSettingsProps {
  extensions: ExtensionView[];
  onChanged: () => Promise<void>;
  sessionId: string | null;
}

export function ExtensionSettings({ extensions, onChanged, sessionId }: ExtensionSettingsProps) {
  const { confirm } = useDialog();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shellHooksEnabled, setShellHooksEnabled] = useState(false);

  useEffect(() => {
    void window.mingshen.getPluginShellHooksEnabled().then(setShellHooksEnabled);
  }, []);

  const importLocal = async () => {
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const directory = await window.mingshen.chooseExtensionDirectory();
      if (!directory) {
        return;
      }
      const result: ExtensionImportResult = await window.mingshen.importExtensions(directory);
      await onChanged();
      const pieces = [tr("\u5DF2\u5BFC\u5165 {0} \u9879", [result.imported.length])];
      if (result.skipped > 0) {
        pieces.push(tr("\u8DF3\u8FC7 {0} \u9879\u91CD\u590D\u5185\u5BB9", [result.skipped]));
      }
      setNotice(pieces.join("，"));
      if (result.warnings.length > 0) {
        setError(result.warnings.join("\n"));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImporting(false);
    }
  };

  const setEnabled = async (extension: ExtensionView, enabled: boolean) => {
    setBusyId(extension.id);
    setError(null);
    try {
      await window.mingshen.setExtensionEnabled(extension.id, enabled);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (extension: ExtensionView) => {
    const confirmed = await confirm({
      title: tr("\u5220\u9664\u672C\u5730\u6269\u5C55"),
      description: tr(
        "\u5C06\u5220\u9664\u300C{0}\u300D\u7684\u672C\u5730\u526F\u672C\u3002\u6E90\u76EE\u5F55\u4E2D\u7684\u539F\u6587\u4EF6\u4E0D\u4F1A\u53D7\u5230\u5F71\u54CD\u3002",
        [extension.name],
      ),
      confirmLabel: tr("\u5220\u9664\u672C\u5730\u526F\u672C"),
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setBusyId(extension.id);
    setError(null);
    try {
      await window.mingshen.removeExtension(extension.id);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const skills = extensions.filter((extension) => extension.type === "skill");
  const plugins = extensions.filter((extension) => extension.type === "plugin");

  return (
    <div className="settings-page extension-settings">
      <TokenSaverSettings sessionId={sessionId} />
      <section className="settings-block">
        <div className="settings-block__heading extension-settings__heading">
          <div>
            <h3>{tr("\u672C\u5730 Skills \u4E0E Plugins")}</h3>
            <p>
              {tr(
                "从本地目录导入 Mingshen、Codex 或 ZCode 兼容扩展。导入后保存独立副本；开发插件可通过下方本地市场校验、安装和更新。",
              )}
            </p>
          </div>
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => void importLocal()}
            disabled={importing}
          >
            {importing ? (
              <LoaderCircle className="spin" aria-hidden="true" size={14} />
            ) : (
              <Upload aria-hidden="true" size={14} />
            )}
            {tr("\u5BFC\u5165\u76EE\u5F55")}
          </button>
        </div>

        {notice ? <p className="extension-settings__notice">{notice}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}

        <div className="extension-matrix">
          <div className="extension-matrix__summary">
            <span>
              <BookOpen aria-hidden="true" size={14} />
              {skills.length} Skills
            </span>
            <span>
              <Puzzle aria-hidden="true" size={14} />
              {plugins.length} Plugins
            </span>
          </div>

          {extensions.length === 0 ? (
            <div className="extension-empty">
              <Box aria-hidden="true" size={22} />
              <strong>{tr("\u8FD8\u6CA1\u6709\u672C\u5730\u6269\u5C55")}</strong>
              <p>{tr("选择包含 SKILL.md、.mingshen-plugin/plugin.json 或兼容插件清单的目录。")}</p>
            </div>
          ) : (
            <div className="extension-table">
              {extensions.map((extension) => {
                const Icon = extension.type === "skill" ? BookOpen : Puzzle;
                return (
                  <article
                    className={
                      extension.enabled
                        ? "extension-record"
                        : "extension-record extension-record--disabled"
                    }
                    key={extension.id}
                  >
                    <span className="extension-record__icon">
                      <Icon aria-hidden="true" size={16} />
                    </span>
                    <div className="extension-record__main">
                      <div className="extension-record__title">
                        <strong>{extension.name}</strong>
                        <span>{extension.type === "skill" ? "SKILL" : "PLUGIN"}</span>
                      </div>
                      <p>{extension.description || tr("\u672A\u63D0\u4F9B\u63CF\u8FF0")}</p>
                      <div className="extension-record__meta">
                        <span>{extension.skillCount} skills</span>
                        <span>{extension.mcpServerCount} MCP</span>
                        <span>{extension.hookCount} hooks</span>
                        <code title={extension.installedPath}>{extension.installedPath}</code>
                      </div>
                    </div>
                    <div className="extension-record__actions">
                      <button
                        className={
                          extension.enabled ? "switch-button switch-button--on" : "switch-button"
                        }
                        type="button"
                        role="switch"
                        aria-checked={extension.enabled}
                        aria-label={
                          extension.enabled
                            ? tr("\u7981\u7528\u6269\u5C55")
                            : tr("\u542F\u7528\u6269\u5C55")
                        }
                        disabled={busyId === extension.id}
                        onClick={() => void setEnabled(extension, !extension.enabled)}
                      >
                        {busyId === extension.id ? (
                          <LoaderCircle className="spin" aria-hidden="true" size={13} />
                        ) : (
                          <Power aria-hidden="true" size={13} />
                        )}
                      </button>
                      <button
                        className="icon-button icon-button--danger"
                        type="button"
                        title={tr("\u5220\u9664\u672C\u5730\u526F\u672C")}
                        aria-label={tr("\u5220\u9664 {0}", [extension.name])}
                        disabled={busyId === extension.id}
                        onClick={() => void remove(extension)}
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <LocalPluginMarketplace onChanged={onChanged} />

      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("Plugin Hook \u6267\u884C")}</h3>
            <p>
              {tr(
                "UserPromptSubmit \u53EA\u6CE8\u5165\u58F0\u660E\u5F0F\u4E0A\u4E0B\u6587\uFF0CInterrupt \u53EA\u4EA7\u751F\u58F0\u660E\u5F0F\u6D3B\u52A8\u901A\u77E5\uFF1BMCP \u4E0E Shell \u52A8\u4F5C\u4EC5\u5728\u5F53\u524D CodeAgent/WorkAgent \u5DF2\u5F15\u7528\u8BE5\u63D2\u4EF6\u3001\u5BBF\u4E3B\u6267\u884C\u3001\u5B8C\u5168\u8BBF\u95EE\u4E14\u9879\u76EE\u5DF2\u4FE1\u4EFB\u7684\u4E3B\u4F1A\u8BDD\u4E2D\u5C1D\u8BD5\uFF0C\u5E76\u5728\u6BCF\u6B21\u6267\u884C\u524D\u5355\u72EC\u5BA1\u6279\u3002\u8BF7\u6C42\u6279\u51C6\u3001Docker\u3001ChatAgent \u4E0E\u5B9E\u9645 SubAgent \u4E0D\u4F1A\u6267\u884C\u3002",
              )}
            </p>
          </div>
        </div>
        <label className="setting-row setting-row--interactive">
          <span className="setting-row__label">
            <Power aria-hidden="true" size={16} />
            <span>
              <strong>{tr("\u542F\u7528 Shell Hook")}</strong>
              <small>
                {tr(
                  "\u53EA\u5BF9\u5F53\u524D\u5DF2\u9009\u62E9\u4E14\u5DF2\u4FE1\u4EFB\u7684\u63D2\u4EF6\u9879\u76EE\u751F\u6548",
                )}
              </small>
            </span>
          </span>
          <input
            type="checkbox"
            checked={shellHooksEnabled}
            onChange={(event) => {
              const enabled = event.target.checked;
              setShellHooksEnabled(enabled);
              void window.mingshen.setPluginShellHooksEnabled(enabled);
            }}
          />
        </label>
      </section>

      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("\u517C\u5BB9\u8303\u56F4")}</h3>
            <p>
              {tr(
                "支持多级 SKILL.md、YAML frontmatter、Skill 资源、命令、MCP 与生命周期 Hook。开发清单使用 .mingshen-plugin/plugin.json，并兼容 Codex、ZCode 和根目录 plugin.json；执行仍受现有权限、信任与审批约束。",
              )}
            </p>
          </div>
        </div>
        <div className="support-matrix">
          <span>SKILL.md</span>
          <strong>{tr("\u5DF2\u652F\u6301")}</strong>
          <span>.mingshen-plugin</span>
          <strong>{tr("已支持")}</strong>
          <span>Codex / ZCode manifest</span>
          <strong>{tr("\u5DF2\u652F\u6301")}</strong>
          <span>{tr("\u5185\u5BB9\u54C8\u5E0C\u53BB\u91CD")}</span>
          <strong>{tr("\u5DF2\u652F\u6301")}</strong>
          <span>{tr("MCP \u58F0\u660E")}</span>
          <strong>{tr("\u53EF\u6267\u884C")}</strong>
          <span>Shell hooks</span>
          <strong>{tr("\u663E\u5F0F\u542F\u7528\u5E76\u5BA1\u6279")}</strong>
        </div>
      </section>

      <SkillMarketplace onInstalled={onChanged} />
    </div>
  );
}
