import { BookOpen, Box, LoaderCircle, Power, Puzzle, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import type { ExtensionImportResult, ExtensionView } from "../../../shared/domain";
import { tr } from "../i18n/index";
import { useDialog } from "./DialogProvider";
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
                "\u4ECE\u672C\u5730\u76EE\u5F55\u5BFC\u5165 Codex \u517C\u5BB9\u6269\u5C55\u3002\u5BFC\u5165\u540E\u4FDD\u5B58\u72EC\u7ACB\u526F\u672C\uFF0C\u4E0D\u8DDF\u968F\u6E90\u76EE\u5F55\u540C\u6B65\uFF1B\u4F1A\u8BDD\u4E2D\u6309\u9700\u5F15\u7528\u3002",
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
              <p>
                {tr(
                  "\u9009\u62E9\u5305\u542B SKILL.md \u6216 .codex-plugin/plugin.json \u7684\u76EE\u5F55\u3002",
                )}
              </p>
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

      <section className="settings-block">
        <div className="settings-block__heading">
          <div>
            <h3>{tr("Plugin Hook \u6267\u884C")}</h3>
            <p>
              {tr(
                "MCP \u7C7B\u578B Hook \u53EF\u76F4\u63A5\u8FD0\u884C\u3002Shell Hook \u9ED8\u8BA4\u5173\u95ED\uFF0C\u5F00\u542F\u540E\u4ECD\u8981\u6C42\u9879\u76EE\u5DF2\u4FE1\u4EFB\uFF0C\u5E76\u5728\u6BCF\u6B21\u6267\u884C\u524D\u5355\u72EC\u5BA1\u6279\u3002",
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
                "\u652F\u6301\u591A\u7EA7 SKILL.md\u3001YAML frontmatter \u591A\u884C description\u3001\u76EE\u5F55\u5185\u811A\u672C\u4E0E\u8D44\u6E90\uFF0C\u4EE5\u53CA Codex Plugin manifest\u3002MCP \u5DE5\u5177\u53EF\u76F4\u63A5\u6267\u884C\uFF1BShell Hook \u9ED8\u8BA4\u5173\u95ED\uFF0C\u542F\u7528\u540E\u4ECD\u9700\u9010\u6B21\u5BA1\u6279\u3002",
              )}
            </p>
          </div>
        </div>
        <div className="support-matrix">
          <span>SKILL.md</span>
          <strong>{tr("\u5DF2\u652F\u6301")}</strong>
          <span>Plugin manifest</span>
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
