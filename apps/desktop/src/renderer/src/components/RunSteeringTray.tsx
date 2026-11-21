import { MessageSquareMore } from "lucide-react";
import type { RunSteeringState } from "../../../shared/run-steering";
import { tr } from "../i18n/index";
import { runtimeText } from "../i18n/runtime";
import { CopyButton } from "./CopyButton";

export function RunSteeringTray({ state }: { state: RunSteeringState | null }) {
  if (!state?.messages.length) return null;
  return (
    <section
      className="run-steering"
      data-testid="chat-steering-tray"
      aria-label={tr("运行中补充")}
    >
      <header className="run-steering__header">
        <MessageSquareMore size={14} aria-hidden="true" />
        <strong>{tr("运行中补充")}</strong>
        <span>{tr("将在当前回复或工具批次结束后接入。")}</span>
      </header>
      <div className="run-steering__items">
        {state.messages.map((message) => (
          <article
            className="run-steering__item"
            data-testid="chat-steering-message"
            data-status={message.status}
            key={message.id}
          >
            <div className="run-steering__copy">
              <span className={`run-steering__status run-steering__status--${message.status}`}>
                {tr(
                  message.status === "pending"
                    ? "等待接入"
                    : message.status === "delivered"
                      ? "已接入"
                      : "未应用",
                )}
              </span>
              <p>{message.text}</p>
              {message.reason ? <small>{runtimeText(message.reason)}</small> : null}
            </div>
            <CopyButton
              text={message.text}
              label={tr("复制补充内容")}
              className="icon-button icon-button--small"
            />
          </article>
        ))}
      </div>
    </section>
  );
}
