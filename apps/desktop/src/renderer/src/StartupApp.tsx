import { useEffect, useState } from "react";
import atomMark from "../../../build/installer-atom-mark.png";
import type {
  StartupPresentationLocale,
  StartupPresentationStage,
} from "../../shared/startup-presentation";

const stageLabels: Record<StartupPresentationLocale, Record<StartupPresentationStage, string>> = {
  "zh-CN": {
    preparing: "正在准备工作环境",
    settings: "正在读取偏好设置",
    services: "正在启动本地服务",
    window: "正在准备工作区",
    ready: "即将进入工作区",
  },
  en: {
    preparing: "Preparing your environment",
    settings: "Loading preferences",
    services: "Starting local services",
    window: "Preparing your workspace",
    ready: "Opening your workspace",
  },
};

export function StartupApp() {
  const [stage, setStage] = useState<StartupPresentationStage>("preparing");
  const [locale, setLocale] = useState<StartupPresentationLocale>("zh-CN");

  useEffect(
    () =>
      window.startupPresentation.onStage((nextStage, nextLocale) => {
        setStage(nextStage);
        setLocale(nextLocale);
      }),
    [],
  );
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.repeat) return;
      event.preventDefault();
      window.startupPresentation.skip();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <main className="startup-presentation" data-stage={stage}>
      <div className="startup-presentation__composition">
        <div className="startup-presentation__identity">
          <div className="startup-presentation__mark" aria-hidden="true">
            <span className="startup-presentation__orbit startup-presentation__orbit--one">
              <span className="startup-presentation__orbit-track" />
            </span>
            <span className="startup-presentation__orbit startup-presentation__orbit--two">
              <span className="startup-presentation__orbit-track" />
            </span>
            <span className="startup-presentation__orbit startup-presentation__orbit--three">
              <span className="startup-presentation__orbit-track" />
            </span>
            <span className="startup-presentation__core">
              <img src={atomMark} alt="" draggable={false} />
            </span>
          </div>
          <div className="startup-presentation__wordmark">
            <span className="startup-presentation__name">Mingshen</span>
            <span className="startup-presentation__product">HARNESS</span>
          </div>
        </div>
        <div className="startup-presentation__status" role="status" aria-live="polite">
          <span className="startup-presentation__indicator" aria-hidden="true" />
          <span>{stageLabels[locale][stage]}</span>
        </div>
      </div>
      <button
        className="startup-presentation__skip"
        type="button"
        onClick={() => window.startupPresentation.skip()}
      >
        {locale === "en" ? "Skip animation" : "跳过动画"}
      </button>
    </main>
  );
}
