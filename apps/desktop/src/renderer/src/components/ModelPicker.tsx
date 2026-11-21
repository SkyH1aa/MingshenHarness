import {
  Check,
  ChevronDown,
  ChevronRight,
  GripVertical,
  KeyRound,
  Server,
  Star,
} from "lucide-react";
import { type MouseEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ModelConfig, ProviderView } from "../../../shared/domain";
import { imageOutputProviders, textOutputProviders } from "../../../shared/model-capabilities";
import { tr, useLocale } from "../i18n/index";
import { revealPanelItem } from "../lib/floating-panel";
import {
  orderCatalogProviders,
  starredCatalogModels,
  starredModelLabel,
} from "../lib/model-catalog";
import { useFloatingPanel } from "../lib/use-floating-panel";
import { useProviderOrderDrag } from "../lib/use-provider-order-drag";
import { ModelCatalogFeedback, useModelCatalog } from "./ModelCatalogPreferences";

export interface ModelSelection {
  providerId: string;
  configId: string;
}

interface ModelPickerProps {
  providers: ProviderView[];
  value: ModelSelection | null;
  onChange: (selection: ModelSelection, model: ModelConfig) => void;
  disabled?: boolean;
  className?: string;
  inlineProvider?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  onClear?: () => void;
  purpose?: "text" | "image";
}

export function ModelPicker({
  providers,
  value,
  onChange,
  disabled = false,
  className = "",
  inlineProvider = false,
  ariaLabel,
  placeholder,
  onClear,
  purpose = "text",
}: ModelPickerProps) {
  const locale = useLocale();
  const catalog = useModelCatalog();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [favoritesExpanded, setFavoritesExpanded] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const purposeProviders =
    purpose === "image" ? imageOutputProviders(providers) : textOutputProviders(providers);
  const ordered = orderCatalogProviders(purposeProviders, catalog.preferences.providerOrder);
  const favorites = starredCatalogModels(ordered, catalog.preferences.starredModelIds);
  const drag = useProviderOrderDrag<HTMLDivElement>({
    providerIds: ordered.map((provider) => provider.id),
    onMove: catalog.moveProvider,
    disabled: !open || !catalog.ready || catalog.saving || ordered.length < 2,
  });
  const position = useFloatingPanel(open, triggerRef, panelRef, {
    minWidth: 350,
    maxHeight: 480,
    anchorComposer: true,
  });

  const selectedProvider = providers.find((provider) => provider.id === value?.providerId);
  const selectedModel = selectedProvider?.models.find((model) => model.id === value?.configId);
  const emptyLabel = placeholder ?? tr("\u9009\u62E9\u6A21\u578B");
  const modelLabel = selectedModel?.displayName ?? emptyLabel;
  const inlineProviderLabel =
    inlineProvider && selectedModel && selectedProvider?.name
      ? locale === "en"
        ? ` (${selectedProvider.name})`
        : `\uFF08${selectedProvider.name}\uFF09`
      : null;

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
      if (
        ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) &&
        (panelRef.current?.contains(event.target as Node) || event.target === triggerRef.current)
      ) {
        event.preventDefault();
        const items = [
          ...(panelRef.current?.querySelectorAll<HTMLButtonElement>(
            "button[data-model-navigate]:not(:disabled)",
          ) ?? []),
        ];
        if (!items.length) return;
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        const item = items[next];
        item?.focus({ preventScroll: true });
        if (item && panelRef.current) revealPanelItem(panelRef.current, item);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const toggleOpen = () => {
    if (disabled) {
      return;
    }
    if (!open && triggerRef.current) {
      setExpanded(new Set(value?.providerId ? [value.providerId] : []));
    }
    setOpen((current) => !current);
  };

  const toggleProvider = (providerId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  };

  const selectModel = (provider: ProviderView, model: ModelConfig) => {
    onChange({ providerId: provider.id, configId: model.id }, model);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };
  const setStar = async (event: MouseEvent<HTMLButtonElement>, model: ModelConfig) => {
    event.stopPropagation();
    if (!catalog.ready || catalog.saving) return;
    const button = event.currentTarget;
    const starred = catalog.preferences.starredModelIds.includes(model.id);
    try {
      await catalog.setStar(model.id, !starred);
      if (!button.isConnected && document.activeElement === document.body) {
        const replacement =
          panelRef.current?.querySelector<HTMLButtonElement>(
            `[data-star-model-id="${CSS.escape(model.id)}"]`,
          ) ??
          panelRef.current?.querySelector<HTMLButtonElement>(".model-picker__favorites-toggle");
        replacement?.focus({ preventScroll: true });
      }
    } catch {
      // The shared preference feedback offers a retry without changing the selection.
    }
  };
  const modelRow = (provider: ProviderView, model: ModelConfig, favorite = false) => {
    const selected = provider.id === value?.providerId && model.id === value?.configId;
    const starred = catalog.preferences.starredModelIds.includes(model.id);
    const label = favorite
      ? starredModelLabel(model.modelId, provider.name, locale)
      : model.displayName;
    const starAction =
      locale === "en"
        ? `${starred ? "Unstar" : "Star"} ${model.modelId} (${provider.name})`
        : `${starred ? "\u53D6\u6D88\u661F\u6807" : "\u661F\u6807"} ${model.modelId}\uFF08${provider.name}\uFF09`;
    return (
      <div className="model-picker__model-row" key={model.id}>
        <button
          className={
            selected ? "model-picker__model model-picker__model--selected" : "model-picker__model"
          }
          type="button"
          aria-pressed={selected}
          data-model-navigate=""
          data-model-config-id={model.id}
          data-provider-id={provider.id}
          title={`${model.modelId} (${provider.name})`}
          onClick={() => selectModel(provider, model)}
        >
          <span>
            <strong>{label}</strong>
            <code>{favorite ? model.displayName : model.modelId}</code>
          </span>
          <span className="model-picker__model-meta">
            {purpose === "image"
              ? locale === "en"
                ? "Image"
                : "图片"
              : `${(model.contextWindow / 1000).toLocaleString(locale === "en" ? "en-US" : "zh-CN")}K`}
          </span>
          <span className="model-picker__selection-mark">
            {selected ? <Check aria-hidden="true" size={15} /> : null}
          </span>
        </button>
        <button
          type="button"
          className="model-star-button"
          data-star-model-id={model.id}
          data-starred={starred}
          aria-pressed={starred}
          title={starAction}
          aria-label={starAction}
          disabled={!catalog.ready}
          aria-disabled={!catalog.ready || catalog.saving}
          onClick={(event) => void setStar(event, model)}
        >
          <Star aria-hidden="true" size={15} fill={starred ? "currentColor" : "none"} />
        </button>
      </div>
    );
  };

  return (
    <div className={`model-picker ${className}`.trim()}>
      <button
        ref={triggerRef}
        className="model-picker__trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={ariaLabel}
        onClick={toggleOpen}
        disabled={disabled}
        title={
          selectedModel
            ? `${selectedProvider?.name ?? ""} / ${selectedModel.displayName} (${selectedModel.modelId})`
            : emptyLabel
        }
      >
        <Server aria-hidden="true" size={14} />
        <span className="model-picker__trigger-copy">
          {!inlineProvider ? (
            <small>{selectedProvider?.name ?? tr("\u4F9B\u5E94\u5546")}</small>
          ) : null}
          <strong>
            {inlineProvider ? (
              <>
                <span className="model-picker__model-name">{modelLabel}</span>
                {inlineProviderLabel ? (
                  <span className="model-picker__inline-provider">{inlineProviderLabel}</span>
                ) : null}
              </>
            ) : (
              modelLabel
            )}
          </strong>
        </span>
        <ChevronDown aria-hidden="true" size={14} />
      </button>

      {open
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              className="model-picker__panel"
              role="dialog"
              aria-label={tr("\u6A21\u578B\u9009\u62E9")}
              style={{ ...position, zIndex: 80 }}
            >
              <ModelCatalogFeedback />
              <section className="model-picker__favorites">
                <button
                  type="button"
                  className="model-picker__favorites-toggle"
                  aria-expanded={favoritesExpanded}
                  data-model-navigate=""
                  onClick={() => setFavoritesExpanded((current) => !current)}
                >
                  {favoritesExpanded ? (
                    <ChevronDown aria-hidden="true" size={14} />
                  ) : (
                    <ChevronRight aria-hidden="true" size={14} />
                  )}
                  <Star aria-hidden="true" size={15} />
                  <strong>{locale === "en" ? "Starred models" : "\u661F\u6807\u6A21\u578B"}</strong>
                  <span>{favorites.length}</span>
                </button>
                {favoritesExpanded ? (
                  <div className="model-picker__favorites-list">
                    {favorites.length ? (
                      favorites.map(({ provider, model }) => modelRow(provider, model, true))
                    ) : (
                      <p>
                        {locale === "en"
                          ? "No starred models."
                          : "\u6682\u65E0\u661F\u6807\u6A21\u578B"}
                      </p>
                    )}
                  </div>
                ) : null}
              </section>
              {onClear ? (
                <button
                  type="button"
                  className="model-picker__clear"
                  data-model-navigate=""
                  aria-pressed={value === null}
                  onClick={() => {
                    onClear();
                    setOpen(false);
                    triggerRef.current?.focus({ preventScroll: true });
                  }}
                >
                  {emptyLabel}
                </button>
              ) : null}
              <div className="model-picker__providers" ref={drag.containerRef}>
                {ordered.map((provider) => {
                  const isExpanded = expanded.has(provider.id);
                  const isCurrentProvider = provider.id === value?.providerId;
                  return (
                    <section
                      className={
                        isCurrentProvider
                          ? "model-picker__provider model-picker__provider--current"
                          : "model-picker__provider"
                      }
                      key={provider.id}
                    >
                      <div
                        className="model-picker__provider-heading provider-order-row"
                        {...drag.rowProps(provider.id)}
                      >
                        <button
                          className="model-picker__provider-toggle"
                          type="button"
                          aria-expanded={isExpanded}
                          data-model-navigate=""
                          onClick={() => toggleProvider(provider.id)}
                        >
                          {isExpanded ? (
                            <ChevronDown aria-hidden="true" size={14} />
                          ) : (
                            <ChevronRight aria-hidden="true" size={14} />
                          )}
                          <span className="model-picker__provider-mark">
                            <Server aria-hidden="true" size={13} />
                          </span>
                          <span className="model-picker__provider-copy">
                            <strong>{provider.name}</strong>
                            <small>
                              <KeyRound aria-hidden="true" size={10} />
                              {provider.keys.length} Key · {provider.models.length}
                              {tr("\u6A21\u578B")}
                            </small>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="provider-order-handle"
                          disabled={!catalog.ready || ordered.length < 2}
                          {...drag.handleProps(provider.id)}
                          aria-label={
                            locale === "en"
                              ? `Reorder ${provider.name}`
                              : `\u6392\u5E8F ${provider.name}`
                          }
                          title={
                            locale === "en"
                              ? "Hold to drag; Alt+Up/Down to reorder"
                              : "\u957F\u6309\u62D6\u52A8\u6392\u5E8F\uFF1BAlt+\u2191/\u2193 \u8C03\u6574\u4F4D\u7F6E"
                          }
                        >
                          <GripVertical aria-hidden="true" size={14} />
                        </button>
                      </div>

                      {isExpanded ? (
                        <div className="model-picker__models">
                          {provider.models.length === 0 ? (
                            <p>
                              {tr("\u8BE5\u4F9B\u5E94\u5546\u5C1A\u672A\u914D\u7F6E\u6A21\u578B")}
                            </p>
                          ) : (
                            provider.models.map((model) => modelRow(provider, model))
                          )}
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
