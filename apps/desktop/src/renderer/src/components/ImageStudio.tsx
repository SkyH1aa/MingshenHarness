import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCheck,
  Copy,
  Download,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Images,
  Layers3,
  LoaderCircle,
  Maximize2,
  MessageSquareText,
  Minus,
  PanelRight,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import type { ProviderView } from "../../../shared/domain";
import {
  alignImageStudioDimension,
  emptyImageStudioWorkspace,
  IMAGE_STUDIO_MAX_ASSETS,
  IMAGE_STUDIO_MAX_DIMENSION,
  IMAGE_STUDIO_MAX_DOCUMENTS,
  IMAGE_STUDIO_MAX_EXPORT_BYTES,
  IMAGE_STUDIO_MAX_GIF_FRAMES,
  IMAGE_STUDIO_MAX_IMPORT_BYTES,
  IMAGE_STUDIO_MAX_LAYERS,
  IMAGE_STUDIO_MAX_REFERENCE_IMAGES,
  IMAGE_STUDIO_MAX_SINGLE_BYTES,
  IMAGE_STUDIO_MIN_DIMENSION,
  type ImageStudioAspectRatio,
  type ImageStudioAsset,
  type ImageStudioCanvas,
  type ImageStudioCanvasSummary,
  type ImageStudioExportProgress,
  type ImageStudioGenerationSettings,
  type ImageStudioGenerationWarning,
  type ImageStudioLayer,
  type ImageStudioQuality,
  type ImageStudioResolution,
  type ImageStudioWorkspace,
  imageStudioAssetPromptRestore,
  imageStudioPresetDimensions,
  selectImageStudioReferenceIds,
  withinImageStudioByteBudget,
} from "../../../shared/image-studio";
import { isVisionTextModel } from "../../../shared/model-capabilities";
import { useLocale } from "../i18n";
import { encodeGif } from "../lib/gif-encoder";
import { promoteImageStudioReferenceIds } from "../lib/image-studio-reference";
import {
  downloadBlob,
  downloadCanvasPng,
  renderCanvasPng,
  renderGifSource,
  safeExportName,
} from "../lib/image-studio-rendering";
import {
  ImageStudioUrlCache,
  ImageStudioWorkspaceQueue,
  mergeAssetResult,
  mergeGeneratedResult,
  mergeRemovedAssets,
} from "../lib/image-studio-workspace";
import { useDialog } from "./DialogProvider";
import { ModelPicker } from "./ModelPicker";

export interface ImageStudioProps {
  active: boolean;
  providers: ProviderView[];
  onOpenProviderSettings?: () => void;
}

interface LayerInteraction {
  type: "pan" | "move" | "resize";
  startX: number;
  startY: number;
  initialX: number;
  initialY: number;
  initialWidth: number;
  initialHeight: number;
  layerId: string | null;
}

interface CanvasBundle {
  format: string;
  version: 1;
  canvas: ImageStudioCanvas;
  assets: Array<{ id: string; name: string; dataUrl: string }>;
}

const CANVAS_BUNDLE_FORMAT = ["ming", "shen", "image", "canvas"].join(".");
const assetUrlPromises = new Map<string, Promise<string>>();
const assetUrlValues = new ImageStudioUrlCache(32 * 1024 * 1024);
const workspaceQueue = new ImageStudioWorkspaceQueue((workspace) =>
  window.mingshen.saveImageStudioWorkspace(workspace),
);
const imageQualityOptions: Array<{ value: ImageStudioQuality; zh: string; en: string }> = [
  { value: "auto", zh: "自动", en: "Auto" },
  { value: "low", zh: "低", en: "Low" },
  { value: "medium", zh: "中", en: "Medium" },
  { value: "high", zh: "高", en: "High" },
  { value: "xhigh", zh: "极高", en: "Very high" },
  { value: "max", zh: "最高", en: "Maximum" },
];
const imageResolutionOptions: Array<{ value: ImageStudioResolution; label: string }> = [
  { value: "1k", label: "1k" },
  { value: "2k", label: "2k" },
  { value: "4k", label: "4k" },
  { value: "auto", label: "自动" },
];
const imageAspectRatios: Array<{ value: ImageStudioAspectRatio; ratio?: string }> = [
  { value: "1:1", ratio: "1 / 1" },
  { value: "2:3", ratio: "2 / 3" },
  { value: "3:2", ratio: "3 / 2" },
  { value: "4:3", ratio: "4 / 3" },
  { value: "3:4", ratio: "3 / 4" },
  { value: "16:9", ratio: "16 / 9" },
  { value: "9:16", ratio: "9 / 16" },
  { value: "21:9", ratio: "21 / 9" },
  { value: "9:21", ratio: "9 / 21" },
  { value: "auto" },
];
const imageMimeTypes: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function imageFileMimeType(file: File): string | null {
  if (["image/gif", "image/jpeg", "image/png", "image/webp"].includes(file.type)) return file.type;
  const extension = /\.[^.]+$/.exec(file.name)?.[0]?.toLowerCase() ?? "";
  return imageMimeTypes[extension] ?? null;
}

function hasFileTransfer(event: ReactDragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeWorkspace(value: ImageStudioWorkspace | null): ImageStudioWorkspace {
  if (value?.version !== 1) throw new Error("图片工作台数据格式无效。");
  return value;
}

async function loadAssetUrl(id: string): Promise<string> {
  const cached = assetUrlValues.get(id);
  if (cached) return cached;
  const pending = assetUrlPromises.get(id);
  if (pending) return pending;
  const request = window.mingshen
    .getImageStudioAssetData(id)
    .then((result) => {
      if (assetUrlPromises.get(id) === request) {
        assetUrlValues.set(id, result.dataUrl);
        assetUrlPromises.delete(id);
      }
      return result.dataUrl;
    })
    .catch((error) => {
      if (assetUrlPromises.get(id) === request) assetUrlPromises.delete(id);
      throw error;
    });
  assetUrlPromises.set(id, request);
  return request;
}

function forgetAssetUrl(id: string): void {
  assetUrlValues.delete(id);
  assetUrlPromises.delete(id);
}

function useAssetUrl(id: string | null): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    id ? (assetUrlValues.get(id) ?? null) : null,
  );
  useEffect(() => {
    let active = true;
    if (!id) {
      setUrl(null);
      return;
    }
    const cached = assetUrlValues.get(id);
    if (cached) {
      setUrl(cached);
      return;
    }
    setUrl(null);
    void loadAssetUrl(id).then(
      (next) => {
        if (active) setUrl(next);
      },
      () => {
        if (active) setUrl(null);
      },
    );
    return () => {
      active = false;
    };
  }, [id]);
  return url;
}

function AssetThumbnail({
  asset,
  selectedOrder,
  onToggle,
  onAdd,
  onImportPrompt,
  onDownload,
  onDelete,
  downloadBusy,
  disabled,
}: {
  asset: ImageStudioAsset;
  selectedOrder: number | null;
  onToggle: () => void;
  onAdd: () => void;
  onImportPrompt: () => void;
  onDownload: () => void;
  onDelete: () => void;
  downloadBusy: boolean;
  disabled: boolean;
}) {
  const en = useLocale() === "en";
  const tx = (zh: string, english: string) => (en ? english : zh);
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const url = useAssetUrl(visible ? asset.id : null);
  const restorablePrompt = imageStudioAssetPromptRestore(asset);
  const promptState = restorablePrompt
    ? restorablePrompt.replacesNegativePrompt
      ? tx("可恢复正向与负向提示词", "Positive and negative prompts saved")
      : tx("可恢复正向提示词，负向需保留", "Positive prompt saved; current negative will be kept")
    : asset.source === "generated"
      ? tx("生成提示词记录不完整", "Generated prompt record is incomplete")
      : tx("无生成提示词可恢复", "No generated prompt is available");

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible(entries.some((entry) => entry.isIntersecting));
      },
      { rootMargin: "180px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={selectedOrder === null ? "image-asset" : "image-asset image-asset--selected"}
      data-testid="image-asset"
      data-asset-id={asset.id}
    >
      <button
        type="button"
        className="image-asset__select"
        aria-pressed={selectedOrder !== null}
        title={asset.name}
        disabled={disabled}
        onClick={onToggle}
      >
        <span className="image-asset__preview">
          {url ? <img src={url} alt="" draggable={false} /> : <ImageIcon aria-hidden="true" />}
          {selectedOrder !== null ? <b>{selectedOrder + 1}</b> : null}
        </span>
        <span className="image-asset__name">{asset.name}</span>
        <small>
          {asset.width}×{asset.height} · {(asset.size / 1024 / 1024).toFixed(1)} MiB
        </small>
        <small
          className={
            restorablePrompt
              ? "image-asset__prompt-state"
              : "image-asset__prompt-state image-asset__prompt-state--missing"
          }
          data-testid="image-asset-prompt-state"
        >
          {promptState}
        </small>
      </button>
      <div className="image-asset__actions">
        <button
          type="button"
          data-testid="image-asset-import-prompt"
          title={`${tx("导入提示词", "Import prompts")} · ${promptState}`}
          aria-label={tx(`导入 ${asset.name} 的提示词`, `Import prompts from ${asset.name}`)}
          disabled={disabled}
          onClick={onImportPrompt}
        >
          <MessageSquareText aria-hidden="true" size={14} />
        </button>
        <button
          type="button"
          data-testid="image-asset-download"
          title={tx("保存原图到本地", "Save original image")}
          aria-label={tx(`保存 ${asset.name} 到本地`, `Save ${asset.name} locally`)}
          disabled={disabled}
          onClick={onDownload}
        >
          {downloadBusy ? (
            <LoaderCircle className="spin" aria-hidden="true" size={14} />
          ) : (
            <Download aria-hidden="true" size={14} />
          )}
        </button>
        <button
          type="button"
          title={tx("加入当前画布", "Add to current canvas")}
          aria-label={tx("加入当前画布", "Add to current canvas")}
          onClick={onAdd}
        >
          <Plus aria-hidden="true" size={14} />
        </button>
        <button
          type="button"
          title={tx("删除素材", "Delete asset")}
          aria-label={tx("删除素材", "Delete asset")}
          disabled={disabled}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" size={14} />
        </button>
      </div>
    </div>
  );
}

function ReferenceAssetPreview({
  asset,
  order,
  onRemove,
  disabled,
}: {
  asset: ImageStudioAsset;
  order: number;
  onRemove: () => void;
  disabled: boolean;
}) {
  const en = useLocale() === "en";
  const url = useAssetUrl(asset.id);
  return (
    <figure className="image-reference-preview__item" data-testid="image-reference-item">
      <div className="image-reference-preview__media">
        {url ? <img src={url} alt="" draggable={false} /> : <ImageIcon aria-hidden="true" />}
        <b>{order}</b>
        <button
          type="button"
          className="image-reference-preview__remove"
          data-testid="image-reference-remove"
          disabled={disabled}
          title={en ? "Remove from selection" : "从选择中移除"}
          aria-label={en ? `Remove ${asset.name} from selection` : `从选择中移除 ${asset.name}`}
          onClick={onRemove}
        >
          <X aria-hidden="true" size={11} />
        </button>
      </div>
      <figcaption title={asset.name}>{asset.name}</figcaption>
      {asset.mimeType === "image/gif" || asset.mimeType === "image/webp" ? (
        <small title={en ? "Uses the first frame as PNG" : "以首帧 PNG 作为参考"}>
          {en ? "PNG · first frame" : "PNG · 首帧"}
        </small>
      ) : null}
    </figure>
  );
}

function CanvasLayerImage({
  layer,
  selected,
  onPointerDown,
}: {
  layer: ImageStudioLayer;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const url = useAssetUrl(layer.assetId);
  return (
    <div
      className={
        selected ? "image-canvas-layer image-canvas-layer--selected" : "image-canvas-layer"
      }
      data-layer-id={layer.id}
      style={{
        left: layer.x,
        top: layer.y,
        width: layer.width,
        height: layer.height,
        opacity: layer.opacity,
        transform: `rotate(${layer.rotation}deg)`,
        zIndex: layer.zIndex + 1,
      }}
      onPointerDown={onPointerDown}
    >
      {url ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        <span className="image-canvas-layer__loading" />
      )}
      {selected ? <i className="image-canvas-layer__resize" data-resize-handle /> : null}
    </div>
  );
}

export function ImageStudio({ active, providers, onOpenProviderSettings }: ImageStudioProps) {
  const en = useLocale() === "en";
  const tx = (zh: string, english: string) => (en ? english : zh);
  const { confirm } = useDialog();
  const [workspace, setWorkspace] = useState<ImageStudioWorkspace>(() =>
    emptyImageStudioWorkspace(),
  );
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<ImageStudioExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generationWarnings, setGenerationWarnings] = useState<ImageStudioGenerationWarning[]>([]);
  const [promptPreview, setPromptPreview] = useState<{
    text: string;
    sourcePrompt: string;
    sourceName?: string;
  } | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [assetsExpanded, setAssetsExpanded] = useState(
    () => typeof window === "undefined" || !window.matchMedia("(max-width: 920px)").matches,
  );
  const [libraryView, setLibraryView] = useState<"assets" | "canvases">("assets");
  const [canvasProjects, setCanvasProjects] = useState<ImageStudioCanvasSummary[]>([]);
  const [renamingCanvasId, setRenamingCanvasId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [inspectorExpanded, setInspectorExpanded] = useState(
    () => typeof window === "undefined" || !window.matchMedia("(max-width: 920px)").matches,
  );
  const [frameDelay, setFrameDelay] = useState(350);
  const [imageDropActive, setImageDropActive] = useState(false);
  const [imageCountDraft, setImageCountDraft] = useState("1");
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const bundleInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<LayerInteraction | null>(null);
  const mounted = useRef(false);
  const loadedRef = useRef(false);
  const loadVersion = useRef(0);
  const workspaceRef = useRef(workspace);
  const busyRef = useRef<string | null>(null);
  const activeRequestId = useRef<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelRenameRef = useRef<string | null>(null);
  const imageDropDepth = useRef(0);

  useEffect(() => {
    if (!renamingCanvasId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingCanvasId]);

  const currentDocument =
    workspace.documents.find((document) => document.id === workspace.activeDocumentId) ?? null;
  const selectedLayer =
    currentDocument?.layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const selectedAssets = workspace.selectedAssetIds
    .map((id) => workspace.assets.find((asset) => asset.id === id))
    .filter((asset): asset is ImageStudioAsset => Boolean(asset));
  const referenceAssetIds = selectImageStudioReferenceIds(selectedAssets.map((asset) => asset.id));
  const referenceAssets = referenceAssetIds
    .map((id) => workspace.assets.find((asset) => asset.id === id))
    .filter((asset): asset is ImageStudioAsset => Boolean(asset));
  const referenceOverflow = Math.max(0, selectedAssets.length - IMAGE_STUDIO_MAX_REFERENCE_IMAGES);
  const filteredAssets = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const newestFirst = [...workspace.assets].reverse();
    if (!query) return newestFirst;
    return newestFirst.filter(
      (asset) =>
        asset.name.toLocaleLowerCase().includes(query) ||
        asset.prompt?.toLocaleLowerCase().includes(query),
    );
  }, [search, workspace.assets]);
  const filteredCanvasProjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return canvasProjects;
    return canvasProjects.filter((project) => project.name.toLocaleLowerCase().includes(query));
  }, [canvasProjects, search]);

  useEffect(() => {
    setImageCountDraft(String(workspace.generation.imageCount));
  }, [workspace.generation.imageCount]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
      const requestId = activeRequestId.current;
      activeRequestId.current = null;
      if (requestId)
        void window.mingshen.cancelImageStudioRequest(requestId).catch(() => undefined);
      if (loadedRef.current) void workspaceQueue.flush().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const version = loadAttempt;
    loadVersion.current = version;
    setLoadError(null);
    void workspaceQueue
      .run(async () => {
        const [workspace, projects] = await Promise.all([
          window.mingshen.getImageStudioWorkspace(),
          window.mingshen.listImageStudioCanvases(),
        ]);
        return { workspace: normalizeWorkspace(workspace), projects };
      })
      .then(
        ({ workspace: next, projects }) => {
          if (!active || loadVersion.current !== version) return;
          workspaceRef.current = next;
          loadedRef.current = true;
          setWorkspace(next);
          setCanvasProjects(projects);
          setLoaded(true);
        },
        (cause) => {
          if (active && loadVersion.current === version)
            setLoadError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    return () => {
      active = false;
    };
  }, [loadAttempt]);

  useEffect(() => {
    if (!loaded) return;
    const ids = new Set(workspace.assets.map((asset) => asset.id));
    for (const id of new Set([...assetUrlValues.keys(), ...assetUrlPromises.keys()]))
      if (!ids.has(id)) forgetAssetUrl(id);
  }, [loaded, workspace.assets]);

  useEffect(() => {
    const compact = window.matchMedia("(max-width: 920px)");
    const mobile = window.matchMedia("(max-width: 680px)");
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setAssetsExpanded(false);
        setInspectorExpanded(false);
      }
    };
    compact.addEventListener("change", onChange);
    mobile.addEventListener("change", onChange);
    return () => {
      compact.removeEventListener("change", onChange);
      mobile.removeEventListener("change", onChange);
    };
  }, []);

  const toggleAssets = () => {
    if (!assetsExpanded && window.matchMedia("(max-width: 680px)").matches)
      setInspectorExpanded(false);
    setAssetsExpanded((current) => !current);
  };

  const toggleInspector = () => {
    if (!inspectorExpanded && window.matchMedia("(max-width: 680px)").matches)
      setAssetsExpanded(false);
    setInspectorExpanded((current) => !current);
  };

  const updateGeneration = (
    update:
      | Partial<ImageStudioGenerationSettings>
      | ((current: ImageStudioGenerationSettings) => ImageStudioGenerationSettings),
  ) => {
    updateWorkspace((current) => ({
      ...current,
      generation: {
        ...current.generation,
        ...(typeof update === "function" ? update(current.generation) : update),
      },
    }));
  };

  const chooseResolution = (resolution: ImageStudioResolution) => {
    if (resolution === "auto") {
      updateGeneration({ resolution, aspectRatio: "auto" });
      return;
    }
    if (resolution === "custom") {
      updateGeneration({ resolution, aspectRatio: "custom" });
      return;
    }
    const current = workspaceRef.current.generation;
    const aspectRatio: Exclude<ImageStudioAspectRatio, "auto" | "custom"> =
      current.aspectRatio === "auto" || current.aspectRatio === "custom"
        ? "1:1"
        : current.aspectRatio;
    const dimensions = imageStudioPresetDimensions(resolution, aspectRatio, current.alignTo16);
    updateGeneration({ resolution, aspectRatio, ...dimensions });
  };

  const chooseAspectRatio = (aspectRatio: ImageStudioAspectRatio) => {
    const current = workspaceRef.current.generation;
    if (aspectRatio === "auto") {
      updateGeneration({ aspectRatio, resolution: "auto" });
      return;
    }
    if (aspectRatio === "custom") {
      updateGeneration({ aspectRatio, resolution: "custom" });
      return;
    }
    const resolution: Exclude<ImageStudioResolution, "auto" | "custom"> =
      current.resolution === "auto" || current.resolution === "custom" ? "1k" : current.resolution;
    const dimensions = imageStudioPresetDimensions(resolution, aspectRatio, current.alignTo16);
    updateGeneration({ resolution, aspectRatio, ...dimensions });
  };

  const updateDimension = (field: "width" | "height", value: string) => {
    const current = workspaceRef.current.generation;
    const parsed = Number(value);
    const next = clamp(
      Number.isFinite(parsed) ? Math.round(parsed) : IMAGE_STUDIO_MIN_DIMENSION,
      IMAGE_STUDIO_MIN_DIMENSION,
      IMAGE_STUDIO_MAX_DIMENSION,
    );
    updateGeneration({
      [field]: current.alignTo16 ? alignImageStudioDimension(next) : next,
      resolution: "custom",
      aspectRatio: "custom",
    });
  };

  const showNotice = (text: string) => {
    if (!mounted.current) return;
    setNotice(text);
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 1_200);
  };

  const setOperation = (next: string | null) => {
    busyRef.current = next;
    if (mounted.current) setBusy(next);
  };

  const applyWorkspaceSnapshot = (next: ImageStudioWorkspace) => {
    workspaceRef.current = next;
    if (mounted.current) setWorkspace(next);
  };

  const refreshCanvasProjects = async () => {
    try {
      const projects = await workspaceQueue.run(() => window.mingshen.listImageStudioCanvases());
      if (mounted.current) setCanvasProjects(projects);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const runCanvasMutation = async (
    operation: string,
    action: () => Promise<ImageStudioWorkspace>,
  ): Promise<boolean> => {
    if (busyRef.current || !mounted.current) return false;
    setOperation(operation);
    setError(null);
    try {
      const next = await workspaceQueue.run(action);
      if (!mounted.current) return false;
      applyWorkspaceSnapshot(next);
      setSelectedLayerId(null);
      await refreshCanvasProjects();
      return true;
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      if (busyRef.current === operation) setOperation(null);
    }
  };

  const updateWorkspace = (
    update: ImageStudioWorkspace | ((current: ImageStudioWorkspace) => ImageStudioWorkspace),
  ) => {
    const next = typeof update === "function" ? update(workspaceRef.current) : update;
    if (next === workspaceRef.current) return;
    workspaceRef.current = next;
    if (mounted.current) {
      setError(null);
      setWorkspace(next);
    }
    if (loadedRef.current)
      workspaceQueue.schedule(next, (result) => {
        if (!mounted.current) return;
        if (result.status === "saved") showNotice(en ? "Saved" : "已保存");
        else setError(result.error instanceof Error ? result.error.message : String(result.error));
      });
  };

  const patchDocument = (
    documentId: string,
    patch: Partial<ImageStudioCanvas> | ((document: ImageStudioCanvas) => ImageStudioCanvas),
  ) => {
    updateWorkspace((current) => ({
      ...current,
      documents: current.documents.map((document) => {
        if (document.id !== documentId) return document;
        const next = typeof patch === "function" ? patch(document) : { ...document, ...patch };
        return { ...next, updatedAt: new Date().toISOString() };
      }),
    }));
  };

  const patchLayer = (layerId: string, patch: Partial<ImageStudioLayer>) => {
    if (!currentDocument) return;
    patchDocument(currentDocument.id, (document) => ({
      ...document,
      layers: document.layers.map((layer) =>
        layer.id === layerId ? { ...layer, ...patch } : layer,
      ),
    }));
  };

  const createCanvas = () => {
    const current = workspaceRef.current;
    if (busyRef.current) return;
    if (current.documents.length >= IMAGE_STUDIO_MAX_DOCUMENTS) {
      setError(
        tx(
          `最多同时打开 ${IMAGE_STUDIO_MAX_DOCUMENTS} 张画布。`,
          `You can open up to ${IMAGE_STUDIO_MAX_DOCUMENTS} canvases at once.`,
        ),
      );
      return;
    }
    const now = new Date().toISOString();
    const document: ImageStudioCanvas = {
      id: crypto.randomUUID(),
      name: tx(
        `未命名画布 ${current.documents.length + 1}`,
        `Untitled ${current.documents.length + 1}`,
      ),
      width: 1600,
      height: 1000,
      background: "#101619",
      zoom: 0.7,
      offsetX: 40,
      offsetY: 40,
      layers: [],
      createdAt: now,
      updatedAt: now,
    };
    setSelectedLayerId(null);
    updateWorkspace({
      ...current,
      activeDocumentId: document.id,
      documents: [...current.documents, document],
    });
    void refreshCanvasProjects();
  };

  const closeCanvas = async (canvasId: string) => {
    const closed = await runCanvasMutation("canvas-close", () =>
      window.mingshen.closeImageStudioCanvas(canvasId),
    );
    if (closed)
      showNotice(tx("画布已关闭，工程仍保存在本地", "Canvas closed; project remains saved"));
  };

  const deleteCanvasProject = async (project: ImageStudioCanvasSummary) => {
    if (busyRef.current) return;
    const yes = await confirm({
      title: tx("删除画布", "Delete canvas"),
      description: tx(
        `将永久删除「${project.name}」的本地画布工程；素材文件仍保留在素材库。`,
        `Permanently delete the local canvas project “${project.name}”. Its image assets stay in the library.`,
      ),
      confirmLabel: tx("删除画布", "Delete"),
      tone: "danger",
    });
    if (!yes || !mounted.current) return;
    const deleted = await runCanvasMutation("canvas-delete", () =>
      window.mingshen.deleteImageStudioCanvas(project.id),
    );
    if (deleted) showNotice(tx("画布工程已删除", "Canvas project deleted"));
  };

  const duplicateCanvasProject = async (project: ImageStudioCanvasSummary) => {
    const duplicated = await runCanvasMutation("canvas-duplicate", () =>
      window.mingshen.duplicateImageStudioCanvas(project.id),
    );
    if (duplicated) showNotice(tx("画布副本已创建", "Canvas copy created"));
  };

  const beginCanvasRename = (project: ImageStudioCanvasSummary) => {
    if (!project.available || busyRef.current) return;
    setRenamingCanvasId(project.id);
    setRenameDraft(project.name);
  };

  const cancelCanvasRename = (canvasId: string) => {
    cancelRenameRef.current = canvasId;
    setRenamingCanvasId(null);
    setRenameDraft("");
  };

  const commitCanvasRename = async (project: ImageStudioCanvasSummary) => {
    if (renamingCanvasId !== project.id || cancelRenameRef.current === project.id) {
      cancelRenameRef.current = null;
      return;
    }
    if (!renameDraft.trim()) {
      setError(tx("画布名称不能为空。", "Canvas name cannot be empty."));
      return;
    }
    const renamed = await runCanvasMutation("canvas-rename", () =>
      window.mingshen.renameImageStudioCanvas(project.id, renameDraft),
    );
    if (renamed) {
      setRenamingCanvasId(null);
      setRenameDraft("");
    }
  };

  const revealCanvasFolder = async () => {
    if (busyRef.current) return;
    try {
      await workspaceQueue.run(() => window.mingshen.revealImageStudioCanvasFolder());
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const addAssetsToCanvas = (sourceAssets: ImageStudioAsset[]): number => {
    const current = workspaceRef.current;
    const availableIds = new Set(current.assets.map((asset) => asset.id));
    const assets = sourceAssets.filter(
      (asset, index) =>
        availableIds.has(asset.id) &&
        sourceAssets.findIndex((candidate) => candidate.id === asset.id) === index,
    );
    if (!assets.length) return 0;
    let document = current.documents.find((item) => item.id === current.activeDocumentId) ?? null;
    const hadDocument = Boolean(document);
    if (!document) {
      if (current.documents.length >= IMAGE_STUDIO_MAX_DOCUMENTS) {
        setError(
          tx(
            `最多同时打开 ${IMAGE_STUDIO_MAX_DOCUMENTS} 张画布。`,
            `You can open up to ${IMAGE_STUDIO_MAX_DOCUMENTS} canvases at once.`,
          ),
        );
        return 0;
      }
      const now = new Date().toISOString();
      document = {
        id: crypto.randomUUID(),
        name: tx("未命名画布 1", "Untitled 1"),
        width: 1600,
        height: 1000,
        background: "#101619",
        zoom: 0.7,
        offsetX: 40,
        offsetY: 40,
        layers: [],
        createdAt: now,
        updatedAt: now,
      };
    }
    const availableLayers = Math.max(0, IMAGE_STUDIO_MAX_LAYERS - document.layers.length);
    if (!availableLayers) {
      setError(
        tx(
          `当前画布最多容纳 ${IMAGE_STUDIO_MAX_LAYERS} 个图层。`,
          `A canvas can contain up to ${IMAGE_STUDIO_MAX_LAYERS} layers.`,
        ),
      );
      return 0;
    }
    const selected = assets.slice(0, availableLayers);
    const layers: ImageStudioLayer[] = selected.map((asset, index) => {
      const scale = Math.min(
        (document.width * 0.72) / Math.max(1, asset.width),
        (document.height * 0.72) / Math.max(1, asset.height),
        1,
      );
      const width = Math.max(24, asset.width * scale);
      const height = Math.max(24, asset.height * scale);
      const offset = Math.min(index, 8) * 22;
      return {
        id: crypto.randomUUID(),
        assetId: asset.id,
        x: clamp((document.width - width) / 2 + offset, 0, document.width - width),
        y: clamp((document.height - height) / 2 + offset, 0, document.height - height),
        width,
        height,
        rotation: 0,
        opacity: 1,
        zIndex: document.layers.length + index,
      };
    });
    const nextDocument = {
      ...document,
      layers: [...document.layers, ...layers],
      updatedAt: new Date().toISOString(),
    };
    const documents = hadDocument
      ? current.documents.map((item) => (item.id === nextDocument.id ? nextDocument : item))
      : [...current.documents, nextDocument];
    setSelectedLayerId(layers.at(-1)?.id ?? null);
    updateWorkspace({
      ...current,
      activeDocumentId: nextDocument.id,
      documents,
    });
    if (!hadDocument) void refreshCanvasProjects();
    if (window.matchMedia("(max-width: 680px)").matches) setAssetsExpanded(false);
    if (selected.length < assets.length)
      setError(
        tx(
          `只添加了前 ${selected.length} 张图片；当前画布最多容纳 ${IMAGE_STUDIO_MAX_LAYERS} 个图层。`,
          `Only the first ${selected.length} images were added; a canvas can contain up to ${IMAGE_STUDIO_MAX_LAYERS} layers.`,
        ),
      );
    return selected.length;
  };

  const addAssetToCanvas = (asset: ImageStudioAsset) => {
    addAssetsToCanvas([asset]);
  };

  const importImageFiles = async (files: File[], asReference = false) => {
    if (!files.length || busyRef.current) return;
    setError(null);
    setOperation("import");
    try {
      if (files.length > 20)
        throw new Error(tx("每次最多导入 20 张图片。", "Import up to 20 images."));
      const total = files.reduce((sum, file) => sum + file.size, 0);
      if (!withinImageStudioByteBudget(total, IMAGE_STUDIO_MAX_IMPORT_BYTES))
        throw new Error(
          tx("本次图片合计不能超过 500 MiB。", "The import must not exceed 500 MiB."),
        );
      const payload = await Promise.all(
        files.map(async (file) => {
          const mimeType = imageFileMimeType(file);
          if (!mimeType)
            throw new Error(
              tx(
                `${file.name} 不是支持的图片格式。`,
                `${file.name} is not a supported image format.`,
              ),
            );
          if (file.size > IMAGE_STUDIO_MAX_SINGLE_BYTES)
            throw new Error(
              tx(`${file.name} 超过单图 25 MiB 限制。`, `${file.name} exceeds 25 MiB.`),
            );
          return {
            name: file.name,
            dataUrl: await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve(
                  String(reader.result).replace(/^data:[^;,]*;base64,/, `data:${mimeType};base64,`),
                );
              reader.onerror = () =>
                reject(new Error(tx("读取图片失败。", "Could not read image.")));
              reader.readAsDataURL(file);
            }),
            source: "imported" as const,
          };
        }),
      );
      if (!mounted.current) return;
      await workspaceQueue.run(async () => {
        const next = await window.mingshen.importImageStudioAssets(payload);
        updateWorkspace((current) => {
          const merged = mergeAssetResult(current, next);
          if (!asReference) return merged;
          const existingIds = new Set(current.assets.map((asset) => asset.id));
          const importedIds = next.assets
            .filter((asset) => !existingIds.has(asset.id))
            .map((asset) => asset.id);
          return {
            ...merged,
            generation: {
              ...merged.generation,
              referenceEnabled: true,
            },
            selectedAssetIds: promoteImageStudioReferenceIds(
              current.selectedAssetIds,
              importedIds,
              IMAGE_STUDIO_MAX_GIF_FRAMES,
            ),
          };
        });
      });
      showNotice(
        asReference
          ? files.length > IMAGE_STUDIO_MAX_REFERENCE_IMAGES
            ? tx(
                `已添加 ${files.length} 张素材，前 ${IMAGE_STUDIO_MAX_REFERENCE_IMAGES} 张作为参考图`,
                `Added ${files.length} assets; the first ${IMAGE_STUDIO_MAX_REFERENCE_IMAGES} will be used as references`,
              )
            : tx(`已添加 ${files.length} 张参考图`, `Added ${files.length} references`)
          : tx(`已导入 ${files.length} 张图片`, `${files.length} images imported`),
      );
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (busyRef.current === "import") setOperation(null);
    }
  };

  const importImages = (event: ChangeEvent<HTMLInputElement>, asReference = false) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    void importImageFiles(files, asReference);
  };

  const onImageDragEnter = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    event.stopPropagation();
    imageDropDepth.current += 1;
    if (
      Array.from(event.dataTransfer.items).some((item) => {
        if (item.kind !== "file") return false;
        const file = item.getAsFile();
        return file ? imageFileMimeType(file) !== null : false;
      })
    )
      setImageDropActive(true);
  };

  const onImageDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = busyRef.current ? "none" : "copy";
  };

  const onImageDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasFileTransfer(event)) return;
    event.stopPropagation();
    imageDropDepth.current = Math.max(0, imageDropDepth.current - 1);
    if (imageDropDepth.current === 0) setImageDropActive(false);
  };

  const onImageDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    event.stopPropagation();
    imageDropDepth.current = 0;
    setImageDropActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    const images = files.filter((file) => imageFileMimeType(file) !== null);
    if (!images.length) {
      setError(tx("拖入的文件中没有支持的图片。", "The drop contains no supported images."));
      return;
    }
    void importImageFiles(images);
  };

  const removeAssetsWithConfirmation = async (
    assets: ImageStudioAsset[],
    batch: boolean,
  ): Promise<void> => {
    if (busyRef.current || !assets.length || !mounted.current) return;
    const assetIds = [...new Set(assets.map((asset) => asset.id))];
    const yes = await confirm({
      title: batch
        ? tx(`删除 ${assetIds.length} 张图片素材？`, `Delete ${assetIds.length} image assets?`)
        : tx("删除图片素材", "Delete image"),
      description:
        assetIds.length === 1
          ? tx(
              `将永久删除「${assets[0]?.name ?? "图片"}」及其保存的生成提示词。若图片仍被任一画布引用，删除会整体取消。`,
              `Permanently delete “${assets[0]?.name ?? "image"}” and its saved generation prompts. Deletion is cancelled if any canvas still references it.`,
            )
          : tx(
              `将永久删除所选 ${assetIds.length} 张图片及其保存的生成提示词。只要其中一张仍被任一画布引用，整批删除都会取消。`,
              `Permanently delete the selected ${assetIds.length} images and their saved generation prompts. The entire batch is cancelled if any canvas still references one of them.`,
            ),
      confirmLabel: batch ? tx("批量删除", "Delete selected") : tx("删除素材", "Delete"),
      tone: "danger",
    });
    if (!yes || busyRef.current || !mounted.current) return;
    const operation = batch ? "batch-remove" : `remove-${assetIds[0]}`;
    setOperation(operation);
    setError(null);
    try {
      await workspaceQueue.run(async () => {
        const result = await window.mingshen.removeImageStudioAssets(assetIds);
        const removed = new Set(result.removedAssetIds);
        for (const id of removed) forgetAssetUrl(id);
        updateWorkspace((current) =>
          mergeRemovedAssets(current, result.workspace, result.removedAssetIds),
        );
        showNotice(
          removed.size > 1
            ? tx(`已删除 ${removed.size} 张图片`, `${removed.size} images deleted`)
            : tx("图片已删除", "Image deleted"),
        );
        if (result.warnings.length) setError(result.warnings.join("\n"));
      });
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (busyRef.current === operation) setOperation(null);
    }
  };

  const removeAsset = async (asset: ImageStudioAsset) => {
    await removeAssetsWithConfirmation([asset], false);
  };

  const removeSelectedAssets = async () => {
    const selectedIds = new Set(workspaceRef.current.selectedAssetIds);
    await removeAssetsWithConfirmation(
      workspaceRef.current.assets.filter((asset) => selectedIds.has(asset.id)),
      true,
    );
  };

  const exportSelectedAssets = async () => {
    if (busyRef.current || !mounted.current) return;
    const selectedIds = workspaceRef.current.selectedAssetIds.filter((id) =>
      workspaceRef.current.assets.some((asset) => asset.id === id),
    );
    if (!selectedIds.length) return;
    const operation = "batch-export";
    const requestId = crypto.randomUUID();
    const totalBytes = selectedIds.reduce(
      (sum, id) => sum + (workspaceRef.current.assets.find((asset) => asset.id === id)?.size ?? 0),
      0,
    );
    const unsubscribe = window.mingshen.onImageStudioExportProgress((progress) => {
      if (progress.requestId === requestId && mounted.current) setExportProgress(progress);
    });
    setOperation(operation);
    setExportProgress({
      requestId,
      completedAssets: 0,
      totalAssets: selectedIds.length,
      completedBytes: 0,
      totalBytes,
      phase: "packing",
    });
    setError(null);
    try {
      const path = await workspaceQueue.run(() =>
        window.mingshen.exportImageStudioAssets(selectedIds, requestId),
      );
      if (path && mounted.current) {
        const filename = path.split(/[\\/]/).at(-1) || "images.zip";
        showNotice(tx(`已导出：${filename}`, `Exported: ${filename}`));
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      unsubscribe();
      if (mounted.current) setExportProgress(null);
      if (busyRef.current === operation) setOperation(null);
    }
  };

  const addSelectedAssetsToCanvas = () => {
    if (busyRef.current) return;
    const selectedIds = new Set(workspaceRef.current.selectedAssetIds);
    const assets = workspaceRef.current.assets.filter((asset) => selectedIds.has(asset.id));
    const added = addAssetsToCanvas(assets);
    if (added)
      showNotice(
        added < assets.length
          ? tx(
              `已加入 ${added}/${assets.length} 张；当前画布图层已达上限`,
              `Added ${added}/${assets.length}; the canvas layer limit was reached`,
            )
          : added > 1
            ? tx(`已加入 ${added} 张图片`, `${added} images added`)
            : tx("已加入画布", "Added to canvas"),
      );
  };

  const downloadAsset = async (asset: ImageStudioAsset) => {
    if (busyRef.current) return;
    const operation = `download-${asset.id}`;
    setOperation(operation);
    setError(null);
    try {
      const path = await workspaceQueue.run(() => window.mingshen.exportImageStudioAsset(asset.id));
      if (path && mounted.current) {
        const filename = path.split(/[\\/]/).at(-1) || asset.name;
        showNotice(tx(`已保存：${filename}`, `Saved: ${filename}`));
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (busyRef.current === operation) setOperation(null);
    }
  };

  const importAssetPrompt = async (asset: ImageStudioAsset) => {
    if (busyRef.current || !mounted.current) return;
    const restored = imageStudioAssetPromptRestore(asset);
    if (!restored) {
      setError(
        asset.source === "generated"
          ? tx(
              "该素材的生成提示词记录缺失或不完整，无法可靠恢复。当前正面和负面提示词均未更改；可使用反推提示词。",
              "This asset's generation prompts are missing or incomplete and cannot be restored reliably. Your current positive and negative prompts are unchanged. You can use image-to-prompt instead.",
            )
          : tx(
              "这是外部导入的图片，无法确认其生成提示词。当前正面和负面提示词均未更改；可使用反推提示词。",
              "This image was imported externally, so its generation prompts cannot be verified. Your current positive and negative prompts are unchanged. You can use image-to-prompt instead.",
            ),
      );
      return;
    }
    const before = workspaceRef.current;
    const operation = `prompt-import-${asset.id}`;
    setOperation(operation);
    setError(null);
    try {
      const accepted = await confirm({
        title: tx("覆盖当前工作区提示词？", "Replace workspace prompts?"),
        description: restored.replacesNegativePrompt
          ? restored.negativePrompt === ""
            ? tx(
                `将用「${asset.name}」生成时保存的正面提示词覆盖当前正面提示词。该素材生成时明确未使用负面提示词，确认后会清空当前负面提示词。取消将保留两项内容。`,
                `Replace the positive prompt with the one saved for “${asset.name}”? This image was generated without a negative prompt, so confirming will also clear your current negative prompt. Cancel keeps both fields.`,
              )
            : tx(
                `将用「${asset.name}」生成时保存的正面和负面提示词，覆盖当前工作区的两项提示词。取消将保留当前内容。`,
                `Replace both workspace prompts with the positive and negative prompts saved when “${asset.name}” was generated? Cancel keeps your current text.`,
              )
          : tx(
              `将用「${asset.name}」保存的正面提示词覆盖当前正面提示词。该素材没有可用的负面提示词，当前负面提示词会保留，不会清空。`,
              `Replace the positive prompt with the one saved for “${asset.name}”? No negative prompt is available, so your current negative prompt will be kept, not cleared.`,
            ),
        confirmLabel: tx("覆盖并导入", "Replace and import"),
      });
      if (!accepted || !mounted.current) return;
      const current = workspaceRef.current;
      const currentAsset = current.assets.find((item) => item.id === asset.id);
      const currentRestore = currentAsset ? imageStudioAssetPromptRestore(currentAsset) : null;
      if (
        current.prompt !== before.prompt ||
        current.negativePrompt !== before.negativePrompt ||
        !currentRestore ||
        currentRestore.prompt !== restored.prompt ||
        currentRestore.negativePrompt !== restored.negativePrompt ||
        currentRestore.replacesNegativePrompt !== restored.replacesNegativePrompt
      ) {
        setError(
          tx(
            "确认期间工作区提示词或素材已更改，未覆盖任何内容。请重新导入并确认。",
            "The workspace prompts or asset changed while confirmation was open. Nothing was replaced. Import again to confirm the current text.",
          ),
        );
        return;
      }
      updateWorkspace((latest) => ({
        ...latest,
        prompt: restored.prompt,
        negativePrompt: restored.negativePrompt ?? latest.negativePrompt,
      }));
      setPromptPreview(null);
      setInspectorExpanded(true);
      showNotice(tx("提示词已导入", "Prompts imported"));
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (busyRef.current === operation) setOperation(null);
    }
  };

  const generate = async () => {
    if (busyRef.current) return;
    const snapshot = workspaceRef.current;
    if (!snapshot.imageModel) {
      setError(tx("请先选择图片生成模型。", "Choose an image model first."));
      return;
    }
    const imageModel = snapshot.imageModel;
    if (!snapshot.prompt.trim()) {
      setError(tx("提示词不能为空。", "The prompt cannot be empty."));
      return;
    }
    const requestReferenceIds = snapshot.generation.referenceEnabled
      ? selectImageStudioReferenceIds(snapshot.selectedAssetIds)
      : [];
    if (snapshot.generation.referenceEnabled && requestReferenceIds.length === 0) {
      setError(
        tx(
          "请先勾选素材或上传参考图，或关闭“使用参考图”。",
          "Select or upload a reference image, or turn off Use references.",
        ),
      );
      return;
    }
    setOperation("generate");
    setError(null);
    setGenerationWarnings([]);
    const requestId = crypto.randomUUID();
    activeRequestId.current = requestId;
    try {
      await workspaceQueue.run(async () => {
        if (!mounted.current || activeRequestId.current !== requestId) return;
        const result = await window.mingshen.generateImageStudioImage({
          requestId,
          model: imageModel,
          prompt: snapshot.prompt,
          negativePrompt: snapshot.negativePrompt,
          generation: snapshot.generation,
          addToActiveCanvas: true,
          ...(snapshot.generation.referenceEnabled
            ? { referenceAssetIds: requestReferenceIds }
            : {}),
        });
        if (!mounted.current || activeRequestId.current !== requestId) return;
        updateWorkspace((current) => mergeGeneratedResult(current, result));
        setGenerationWarnings(result.warnings);
        setAssetsExpanded(true);
        setInspectorExpanded(false);
        setSearch("");
        showNotice(
          tx(
            `已生成 ${result.generatedAssets.length} 张并保存到素材库`,
            `Generated ${result.generatedAssets.length} images and saved them to the library`,
          ),
        );
      });
    } catch (cause) {
      if (mounted.current && activeRequestId.current === requestId)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (activeRequestId.current === requestId) {
        activeRequestId.current = null;
        setOperation(null);
      }
    }
  };

  const polish = async () => {
    if (busyRef.current) return;
    const snapshot = workspaceRef.current;
    if (!snapshot.textModel) {
      setError(tx("请先选择语言模型。", "Choose a language model first."));
      return;
    }
    setOperation("polish");
    setError(null);
    const requestId = crypto.randomUUID();
    activeRequestId.current = requestId;
    try {
      const result = await window.mingshen.polishImageStudioPrompt({
        requestId,
        model: snapshot.textModel,
        prompt: snapshot.prompt,
      });
      if (mounted.current && activeRequestId.current === requestId)
        setPromptPreview({ text: result.text, sourcePrompt: snapshot.prompt });
    } catch (cause) {
      if (mounted.current && activeRequestId.current === requestId)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (activeRequestId.current === requestId) {
        activeRequestId.current = null;
        setOperation(null);
      }
    }
  };

  const reversePrompt = async () => {
    if (busyRef.current) return;
    const snapshot = workspaceRef.current;
    if (!snapshot.textModel) {
      setError(tx("请先选择语言模型。", "Choose a language model first."));
      return;
    }
    const source = selectedAssets[0];
    if (!source) {
      setError(tx("请先在素材库选择一张图片。", "Select an image in the library first."));
      return;
    }
    setOperation("reverse");
    setError(null);
    const requestId = crypto.randomUUID();
    activeRequestId.current = requestId;
    try {
      const result = await window.mingshen.reverseImageStudioPrompt({
        requestId,
        model: snapshot.textModel,
        assetId: source.id,
      });
      if (mounted.current && activeRequestId.current === requestId)
        setPromptPreview({
          text: result.text,
          sourcePrompt: snapshot.prompt,
          sourceName: source.name,
        });
    } catch (cause) {
      if (mounted.current && activeRequestId.current === requestId)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (activeRequestId.current === requestId) {
        activeRequestId.current = null;
        setOperation(null);
      }
    }
  };

  const cancelNetworkRequest = () => {
    const requestId = activeRequestId.current;
    if (!requestId) return;
    activeRequestId.current = null;
    setOperation(null);
    void window.mingshen.cancelImageStudioRequest(requestId).catch(() => undefined);
    showNotice(tx("正在取消请求…", "Cancelling request…"));
  };

  const toggleSelectedAsset = (assetId: string) => {
    if (busyRef.current) return;
    updateWorkspace((current) => {
      const selected = current.selectedAssetIds.includes(assetId);
      return {
        ...current,
        selectedAssetIds: selected
          ? current.selectedAssetIds.filter((id) => id !== assetId)
          : [...current.selectedAssetIds, assetId].slice(0, IMAGE_STUDIO_MAX_ASSETS),
      };
    });
  };

  const exportPng = async () => {
    if (!currentDocument || busyRef.current) return;
    setOperation("png");
    setError(null);
    try {
      const blob = await renderCanvasPng(currentDocument, loadAssetUrl);
      downloadCanvasPng(blob, currentDocument);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (busyRef.current === "png") setOperation(null);
    }
  };

  const exportBundle = async () => {
    if (!currentDocument || busyRef.current) return;
    setOperation("bundle-export");
    setError(null);
    try {
      const ids = [...new Set(currentDocument.layers.map((layer) => layer.assetId))];
      const sourceAssets = ids.map((id) => workspace.assets.find((item) => item.id === id));
      if (sourceAssets.some((asset) => !asset))
        throw new Error(tx("画布引用的素材已丢失。", "A canvas asset is missing."));
      if (
        sourceAssets.length > 20 ||
        !withinImageStudioByteBudget(
          sourceAssets.reduce((sum, asset) => sum + (asset?.size ?? 0), 0),
          IMAGE_STUDIO_MAX_EXPORT_BYTES,
        )
      )
        throw new Error(
          tx("画布工程超过导入上限。", "The canvas bundle exceeds the import limit."),
        );
      const assets: CanvasBundle["assets"] = [];
      for (const asset of sourceAssets) {
        if (asset)
          assets.push({ id: asset.id, name: asset.name, dataUrl: await loadAssetUrl(asset.id) });
      }
      const bundle: CanvasBundle = {
        format: CANVAS_BUNDLE_FORMAT,
        version: 1,
        canvas: currentDocument,
        assets,
      };
      downloadBlob(
        new Blob([JSON.stringify(bundle)], { type: "application/json" }),
        `${safeExportName(currentDocument.name)}.${CANVAS_BUNDLE_FORMAT.replaceAll(".", "-")}.json`,
      );
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (busyRef.current === "bundle-export") setOperation(null);
    }
  };

  const importBundle = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busyRef.current) return;
    setOperation("bundle-import");
    setError(null);
    try {
      if (file.size > IMAGE_STUDIO_MAX_IMPORT_BYTES * 1.4)
        throw new Error(tx("画布工程文件超过导入上限。", "The canvas bundle is too large."));
      const bundle = JSON.parse(await file.text()) as CanvasBundle;
      if (
        bundle?.format !== CANVAS_BUNDLE_FORMAT ||
        bundle.version !== 1 ||
        !bundle.canvas ||
        !Array.isArray(bundle.assets) ||
        !Array.isArray(bundle.canvas.layers)
      )
        throw new Error(tx("不是有效的 Mingshen 画布工程。", "Invalid Mingshen canvas bundle."));
      if (workspaceRef.current.documents.length >= IMAGE_STUDIO_MAX_DOCUMENTS)
        throw new Error(
          tx(
            `最多同时打开 ${IMAGE_STUDIO_MAX_DOCUMENTS} 张画布，请先关闭一个标签。`,
            `You can open up to ${IMAGE_STUDIO_MAX_DOCUMENTS} canvases. Close a tab first.`,
          ),
        );
      const bundleIds = new Set(bundle.assets.map((asset) => asset?.id));
      if (
        bundle.assets.length > 20 ||
        bundleIds.size !== bundle.assets.length ||
        bundle.assets.some(
          (asset) => !asset || typeof asset.id !== "string" || typeof asset.dataUrl !== "string",
        ) ||
        bundle.canvas.layers.some((layer) => !layer || !bundleIds.has(layer.assetId))
      )
        throw new Error(tx("画布工程中的素材无效。", "Invalid canvas bundle assets."));
      if (!mounted.current) return;
      await workspaceQueue.run(async () => {
        const before = await window.mingshen.getImageStudioWorkspace();
        const existing = new Set(before.assets.map((asset) => asset.id));
        const imported = bundle.assets.length
          ? await window.mingshen.importImageStudioAssets(
              bundle.assets.map((asset) => ({
                name: asset.name,
                dataUrl: asset.dataUrl,
                source: "imported" as const,
              })),
            )
          : before;
        const added = imported.assets.filter((asset) => !existing.has(asset.id));
        const remap = new Map(bundle.assets.map((asset, index) => [asset.id, added[index]?.id]));
        const now = new Date().toISOString();
        const canvas: ImageStudioCanvas = {
          ...bundle.canvas,
          id: crypto.randomUUID(),
          name: `${bundle.canvas.name} ${tx("导入", "Imported")}`.slice(0, 120),
          layers: bundle.canvas.layers.map((layer) => ({
            ...layer,
            id: crypto.randomUUID(),
            assetId: remap.get(layer.assetId) ?? "",
          })),
          createdAt: now,
          updatedAt: now,
        };
        updateWorkspace((current) => ({
          ...mergeAssetResult(current, imported),
          activeDocumentId: canvas.id,
          documents: [...current.documents, canvas],
        }));
      });
      await refreshCanvasProjects();
      showNotice(tx("画布工程已导入", "Canvas bundle imported"));
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (busyRef.current === "bundle-import") setOperation(null);
    }
  };

  const exportGif = async () => {
    if (busyRef.current) return;
    if (selectedAssets.length < 2) {
      setError(tx("请在素材库按播放顺序选择至少两帧。", "Select at least two frames."));
      return;
    }
    if (selectedAssets.length > IMAGE_STUDIO_MAX_GIF_FRAMES) {
      setError(
        tx(
          `动图最多 ${IMAGE_STUDIO_MAX_GIF_FRAMES} 帧。`,
          `Animated images support up to ${IMAGE_STUDIO_MAX_GIF_FRAMES} frames.`,
        ),
      );
      return;
    }
    setOperation("gif");
    setError(null);
    try {
      const source = await renderGifSource(
        selectedAssets.map((asset) => asset.id),
        clamp(frameDelay, 80, 5_000),
        loadAssetUrl,
      );
      const bytes = encodeGif(source.frames, source.width, source.height, { loop: 0 });
      downloadBlob(
        new Blob([bytes], { type: "image/gif" }),
        `${CANVAS_BUNDLE_FORMAT.replaceAll(".", "-")}-sequence.gif`,
      );
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (busyRef.current === "gif") setOperation(null);
    }
  };

  const setViewportZoom = (nextZoom: number, center?: { x: number; y: number }) => {
    if (!currentDocument || !viewportRef.current) return;
    const zoom = clamp(nextZoom, 0.12, 4);
    const rect = viewportRef.current.getBoundingClientRect();
    const anchor = center ?? { x: rect.width / 2, y: rect.height / 2 };
    const worldX = (anchor.x - currentDocument.offsetX) / currentDocument.zoom;
    const worldY = (anchor.y - currentDocument.offsetY) / currentDocument.zoom;
    patchDocument(currentDocument.id, {
      zoom,
      offsetX: anchor.x - worldX * zoom,
      offsetY: anchor.y - worldY * zoom,
    });
  };

  const fitCanvas = () => {
    if (!currentDocument || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const zoom = clamp(
      Math.min(
        (rect.width - 72) / currentDocument.width,
        (rect.height - 72) / currentDocument.height,
      ),
      0.12,
      2,
    );
    patchDocument(currentDocument.id, {
      zoom,
      offsetX: Math.max(24, (rect.width - currentDocument.width * zoom) / 2),
      offsetY: Math.max(24, (rect.height - currentDocument.height * zoom) / 2),
    });
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!currentDocument) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setViewportZoom(currentDocument.zoom * (event.deltaY > 0 ? 0.9 : 1.1), {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };

  const beginBackgroundPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!currentDocument || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-layer-id], button, input, textarea")) return;
    interaction.current = {
      type: "pan",
      startX: event.clientX,
      startY: event.clientY,
      initialX: currentDocument.offsetX,
      initialY: currentDocument.offsetY,
      initialWidth: 0,
      initialHeight: 0,
      layerId: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const beginLayerMove = (event: ReactPointerEvent<HTMLDivElement>, layer: ImageStudioLayer) => {
    if (!currentDocument || event.button !== 0) return;
    event.stopPropagation();
    setSelectedLayerId(layer.id);
    const resize = Boolean((event.target as HTMLElement).closest("[data-resize-handle]"));
    interaction.current = {
      type: resize ? "resize" : "move",
      startX: event.clientX,
      startY: event.clientY,
      initialX: layer.x,
      initialY: layer.y,
      initialWidth: layer.width,
      initialHeight: layer.height,
      layerId: layer.id,
    };
    viewportRef.current?.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = interaction.current;
    if (!state || !currentDocument) return;
    const dx = (event.clientX - state.startX) / currentDocument.zoom;
    const dy = (event.clientY - state.startY) / currentDocument.zoom;
    if (state.type === "pan") {
      patchDocument(currentDocument.id, {
        offsetX: state.initialX + event.clientX - state.startX,
        offsetY: state.initialY + event.clientY - state.startY,
      });
    } else if (state.layerId && state.type === "move") {
      patchLayer(state.layerId, { x: state.initialX + dx, y: state.initialY + dy });
    } else if (state.layerId) {
      patchLayer(state.layerId, {
        width: Math.max(8, state.initialWidth + dx),
        height: Math.max(8, state.initialHeight + dy),
      });
    }
  };

  const endInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interaction.current) return;
    interaction.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (!loaded) {
    return (
      <section
        className="image-studio image-studio--loading"
        aria-label={tx("生图工作台", "Image Studio")}
        data-testid="image-studio"
      >
        {loadError ? (
          <>
            <span role="alert">
              {tx("载入图片工作台失败：", "Could not load image studio: ")}
              {loadError}
            </span>
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="image-load-retry"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            >
              {tx("重试", "Retry")}
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" aria-hidden="true" size={22} />
            <span>{tx("载入图片工作台…", "Loading image studio…")}</span>
          </>
        )}
      </section>
    );
  }

  const selectedTextModel =
    workspace.textModel &&
    providers
      .find((provider) => provider.id === workspace.textModel?.providerId)
      ?.models.find((model) => model.id === workspace.textModel?.modelId);
  const canvasMutationBusy =
    busy === "canvas-close" ||
    busy === "canvas-delete" ||
    busy === "canvas-duplicate" ||
    busy === "canvas-rename";

  return (
    <section
      className="image-studio"
      aria-label={tx("生图工作台", "Image Studio")}
      data-testid="image-studio"
      data-navigation-busy={active && Boolean(busy)}
      data-navigation-unsaved={active && Boolean(promptPreview)}
      aria-busy={canvasMutationBusy}
      inert={canvasMutationBusy}
      onDragEnter={onImageDragEnter}
      onDragOver={onImageDragOver}
      onDragLeave={onImageDragLeave}
      onDrop={onImageDrop}
    >
      {imageDropActive && !busy ? (
        <div className="image-studio__drop-overlay" role="status" data-testid="image-drop-overlay">
          <span>
            <ArrowUpFromLine aria-hidden="true" size={20} />
            {tx("松开放入图片，导入素材库", "Drop images to add them to the library")}
          </span>
        </div>
      ) : null}
      <header className="image-studio__header">
        <div className="image-studio__title">
          <span className="image-studio__mark">
            <Sparkles aria-hidden="true" size={17} />
          </span>
          <span>
            <strong>{tx("生图工作台", "Image Studio")}</strong>
            <small>{tx("创意、画布与动图", "Ideas, canvas and motion")}</small>
          </span>
        </div>
        <div className="image-studio__model-row">
          <ModelPicker
            providers={providers}
            purpose="image"
            value={
              workspace.imageModel
                ? {
                    providerId: workspace.imageModel.providerId,
                    configId: workspace.imageModel.modelId,
                  }
                : null
            }
            onChange={(selection, model) =>
              updateWorkspace((current) => ({
                ...current,
                imageModel: {
                  providerId: selection.providerId,
                  modelId: model.id,
                },
              }))
            }
            ariaLabel={tx("图片生成模型", "Image model")}
            placeholder={tx("选择图片模型", "Choose image model")}
          />
          <ModelPicker
            providers={providers}
            purpose="text"
            value={
              workspace.textModel
                ? {
                    providerId: workspace.textModel.providerId,
                    configId: workspace.textModel.modelId,
                  }
                : null
            }
            onChange={(selection, model) =>
              updateWorkspace((current) => ({
                ...current,
                textModel: {
                  providerId: selection.providerId,
                  modelId: model.id,
                },
              }))
            }
            ariaLabel={tx("语言模型", "Language model")}
            placeholder={tx("选择语言模型", "Choose language model")}
          />
          {onOpenProviderSettings ? (
            <button className="btn btn--ghost" type="button" onClick={onOpenProviderSettings}>
              {tx("模型设置", "Model settings")}
            </button>
          ) : null}
        </div>
        <div className="image-studio__header-actions">
          <span
            className={
              notice ? "image-studio__save image-studio__save--visible" : "image-studio__save"
            }
          >
            {notice}
          </span>
          {activeRequestId.current ? (
            <button
              className="btn btn--danger"
              type="button"
              data-testid="image-request-cancel"
              onClick={cancelNetworkRequest}
            >
              <X aria-hidden="true" size={15} />
              {tx("取消请求", "Cancel")}
            </button>
          ) : null}
          <button
            className="btn btn--secondary"
            type="button"
            data-testid="image-import"
            disabled={busy !== null}
            onClick={() => fileInputRef.current?.click()}
          >
            <ArrowUpFromLine aria-hidden="true" size={15} />
            {tx("导入图片", "Import")}
          </button>
          <button
            className="btn btn--secondary"
            type="button"
            data-testid="image-canvas-import"
            disabled={busy !== null}
            onClick={() => bundleInputRef.current?.click()}
          >
            <FolderOpen aria-hidden="true" size={15} />
            {tx("导入画布", "Import canvas")}
          </button>
          <button
            className="btn btn--primary"
            type="button"
            data-testid="image-canvas-new"
            onClick={createCanvas}
          >
            <Plus aria-hidden="true" size={15} />
            {tx("新建画布", "New canvas")}
          </button>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            data-testid="image-import-input"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            onChange={importImages}
          />
          <input
            ref={bundleInputRef}
            hidden
            type="file"
            data-testid="image-bundle-input"
            accept=".json,application/json"
            onChange={importBundle}
          />
        </div>
      </header>

      <div
        className={`image-studio__body${assetsExpanded ? " image-studio__body--library-open" : ""}${inspectorExpanded ? " image-studio__body--inspector-open" : ""}`}
      >
        {assetsExpanded || inspectorExpanded ? (
          <button
            type="button"
            className="image-library__scrim"
            aria-label={tx("关闭侧面板", "Close side panel")}
            onClick={() => {
              setAssetsExpanded(false);
              setInspectorExpanded(false);
            }}
          />
        ) : null}
        <aside
          id="image-studio-library"
          data-testid="image-library"
          aria-label={tx("素材库", "Asset library")}
          className="image-library"
          hidden={!assetsExpanded}
        >
          <div className="image-library__heading">
            <button
              type="button"
              className="image-library__collapse"
              aria-expanded={assetsExpanded}
              aria-controls="image-studio-library"
              aria-label={tx("收起素材库", "Collapse library")}
              title={
                assetsExpanded
                  ? tx("收起素材库", "Collapse library")
                  : tx("展开素材库", "Expand library")
              }
              onClick={toggleAssets}
            >
              <Images aria-hidden="true" size={16} />
              {assetsExpanded ? <strong>{tx("素材库", "Library")}</strong> : null}
              <span>{workspace.assets.length}</span>
            </button>
          </div>
          {assetsExpanded ? (
            <>
              <div className="image-library__heading">
                <strong>{tx("素材库", "Library")}</strong>
                <button
                  type="button"
                  className="image-library__collapse icon-button"
                  aria-expanded={assetsExpanded}
                  aria-controls="image-studio-library"
                  aria-label={tx("收起素材库", "Collapse library")}
                  title={tx("收起素材库", "Collapse library")}
                  onClick={toggleAssets}
                >
                  <X aria-hidden="true" size={15} />
                </button>
              </div>
              <div
                className="image-library__tabs"
                role="tablist"
                aria-label={tx("素材视图", "Library view")}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={libraryView === "assets"}
                  className={libraryView === "assets" ? "is-active" : ""}
                  data-testid="image-library-assets-tab"
                  onClick={() => setLibraryView("assets")}
                >
                  <Images aria-hidden="true" size={13} />
                  {tx("图片", "Images")}
                  <span>{workspace.assets.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={libraryView === "canvases"}
                  className={libraryView === "canvases" ? "is-active" : ""}
                  data-testid="image-library-canvases-tab"
                  onClick={() => {
                    setLibraryView("canvases");
                    setError(null);
                    void refreshCanvasProjects();
                  }}
                >
                  <Layers3 aria-hidden="true" size={13} />
                  {tx("我的画布", "My canvases")}
                  <span>{canvasProjects.length}</span>
                </button>
              </div>
              <label className="image-library__search">
                <span className="visually-hidden">
                  {libraryView === "assets"
                    ? tx("搜索素材", "Search assets")
                    : tx("搜索画布", "Search canvases")}
                </span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={
                    libraryView === "assets"
                      ? tx("搜索名称或提示词", "Search name or prompt")
                      : tx("搜索画布名称", "Search canvases")
                  }
                />
              </label>
              {libraryView === "assets" ? (
                <>
                  <div className="image-library__selection">
                    <span>
                      {selectedAssets.length
                        ? tx(
                            `已选 ${selectedAssets.length} 张`,
                            `${selectedAssets.length} images selected`,
                          )
                        : tx("未选择图片", "No images selected")}
                    </span>
                    <div className="image-library__selection-actions">
                      <button
                        type="button"
                        className="icon-button"
                        data-testid="image-assets-select-all"
                        title={tx("全选当前搜索结果", "Select all matching images")}
                        aria-label={tx("全选当前搜索结果", "Select all matching images")}
                        disabled={busy !== null || !filteredAssets.length}
                        onClick={() =>
                          updateWorkspace((current) => ({
                            ...current,
                            selectedAssetIds: [
                              ...new Set([
                                ...current.selectedAssetIds,
                                ...filteredAssets.map((asset) => asset.id),
                              ]),
                            ].slice(0, IMAGE_STUDIO_MAX_ASSETS),
                          }))
                        }
                      >
                        <CheckCheck aria-hidden="true" size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        data-testid="image-assets-clear-selection"
                        title={tx("清空选择", "Clear selection")}
                        aria-label={tx("清空选择", "Clear selection")}
                        disabled={busy !== null || !selectedAssets.length}
                        onClick={() =>
                          updateWorkspace((current) => ({ ...current, selectedAssetIds: [] }))
                        }
                      >
                        <X aria-hidden="true" size={16} />
                      </button>
                    </div>
                  </div>
                  <fieldset className="image-library__batch-actions">
                    <legend className="visually-hidden">
                      {tx("素材批量操作", "Batch image actions")}
                    </legend>
                    <button
                      type="button"
                      data-testid="image-assets-export"
                      title={tx("将所选原图导出为 ZIP", "Export selected originals as ZIP")}
                      disabled={busy !== null || !selectedAssets.length}
                      onClick={() => void exportSelectedAssets()}
                    >
                      <ArrowDownToLine aria-hidden="true" size={14} />
                      {tx("导出", "Export")}
                    </button>
                    <button
                      type="button"
                      data-testid="image-assets-add"
                      title={tx("将所选加入当前画布", "Add selected to current canvas")}
                      disabled={busy !== null || !selectedAssets.length}
                      onClick={addSelectedAssetsToCanvas}
                    >
                      <Layers3 aria-hidden="true" size={14} />
                      {tx("入画布", "Add")}
                    </button>
                    <button
                      type="button"
                      data-testid="image-assets-delete"
                      title={tx(
                        "删除所选素材及保存的提示词",
                        "Delete selected images and saved prompts",
                      )}
                      disabled={busy !== null || !selectedAssets.length}
                      onClick={() => void removeSelectedAssets()}
                    >
                      <Trash2 aria-hidden="true" size={14} />
                      {tx("删除", "Delete")}
                    </button>
                  </fieldset>
                  {busy === "batch-export" && exportProgress ? (
                    <div
                      className="image-library__export-progress"
                      role="status"
                      aria-live="polite"
                      data-testid="image-export-progress"
                    >
                      <div>
                        <span>
                          {exportProgress.phase === "finalizing"
                            ? tx("正在完成 ZIP 文件", "Finalizing ZIP archive")
                            : tx(
                                `正在打包 ${exportProgress.completedAssets}/${exportProgress.totalAssets} 张`,
                                `Packing ${exportProgress.completedAssets}/${exportProgress.totalAssets} images`,
                              )}
                        </span>
                        <span>
                          {(exportProgress.completedBytes / 1024 / 1024).toFixed(1)} /{" "}
                          {(exportProgress.totalBytes / 1024 / 1024).toFixed(1)} MiB
                        </span>
                      </div>
                      <progress
                        max={100}
                        value={
                          exportProgress.phase === "complete"
                            ? 100
                            : exportProgress.phase === "finalizing"
                              ? 96
                              : Math.floor(
                                  (95 * exportProgress.completedAssets) /
                                    Math.max(1, exportProgress.totalAssets),
                                )
                        }
                        aria-label={tx("图片导出进度", "Image export progress")}
                      />
                    </div>
                  ) : null}
                  <div className="image-library__grid">
                    {filteredAssets.map((asset) => (
                      <AssetThumbnail
                        key={asset.id}
                        asset={asset}
                        selectedOrder={
                          workspace.selectedAssetIds.includes(asset.id)
                            ? workspace.selectedAssetIds.indexOf(asset.id)
                            : null
                        }
                        onToggle={() => toggleSelectedAsset(asset.id)}
                        onAdd={() => addAssetToCanvas(asset)}
                        onImportPrompt={() => void importAssetPrompt(asset)}
                        onDownload={() => void downloadAsset(asset)}
                        onDelete={() => void removeAsset(asset)}
                        downloadBusy={busy === `download-${asset.id}`}
                        disabled={busy !== null}
                      />
                    ))}
                    {!filteredAssets.length ? (
                      <button
                        type="button"
                        className="image-library__empty"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <ImageIcon aria-hidden="true" size={22} />
                        <strong>{tx("添加图片素材", "Add image assets")}</strong>
                        <small>
                          {tx("本地导入，不依赖原文件", "Local import, no source path")}
                        </small>
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="image-canvas-library" data-testid="image-canvas-library">
                  <div className="image-canvas-library__toolbar">
                    <span>
                      {tx(
                        `${canvasProjects.length} 个本地工程`,
                        `${canvasProjects.length} local projects`,
                      )}
                    </span>
                    <button
                      type="button"
                      className="icon-button"
                      title={tx("打开画布文件夹", "Open canvas folder")}
                      aria-label={tx("打开画布文件夹", "Open canvas folder")}
                      disabled={busy !== null}
                      onClick={() => void revealCanvasFolder()}
                    >
                      <FolderOpen aria-hidden="true" size={14} />
                    </button>
                  </div>
                  <div className="image-canvas-library__list">
                    {filteredCanvasProjects.map((project) => {
                      const isOpen = workspace.documents.some((item) => item.id === project.id);
                      const isRenaming = renamingCanvasId === project.id;
                      return (
                        <article
                          key={project.id}
                          className={`image-canvas-project${project.available ? "" : " image-canvas-project--unavailable"}`}
                          data-testid="image-canvas-project"
                          data-canvas-id={project.id}
                        >
                          <div className="image-canvas-project__main">
                            <Layers3 aria-hidden="true" size={15} />
                            {isRenaming ? (
                              <input
                                ref={renameInputRef}
                                value={renameDraft}
                                maxLength={120}
                                aria-label={tx("画布名称", "Canvas name")}
                                onChange={(event) => setRenameDraft(event.target.value)}
                                onBlur={() => void commitCanvasRename(project)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    void commitCanvasRename(project);
                                  } else if (event.key === "Escape") {
                                    event.preventDefault();
                                    cancelCanvasRename(project.id);
                                  }
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                className="image-canvas-project__open"
                                disabled={!project.available || busy !== null}
                                title={project.available ? project.name : (project.error ?? "")}
                                onClick={() => {
                                  if (isOpen) {
                                    updateWorkspace((current) => ({
                                      ...current,
                                      activeDocumentId: project.id,
                                    }));
                                  } else {
                                    void runCanvasMutation("canvas-open", () =>
                                      window.mingshen.openImageStudioCanvas(project.id),
                                    );
                                  }
                                }}
                              >
                                <strong>{project.name}</strong>
                                <small>
                                  {project.available
                                    ? `${project.width}×${project.height} · ${tx(`${project.layerCount} 层`, `${project.layerCount} layers`)} · ${new Date(project.updatedAt).toLocaleDateString(en ? "en-US" : "zh-CN")}`
                                    : tx("项目文件无法读取", "Project file unavailable")}
                                </small>
                              </button>
                            )}
                          </div>
                          {isOpen ? (
                            <span className="image-canvas-project__open-state">
                              {tx("已打开", "Open")}
                            </span>
                          ) : null}
                          {!project.available && project.error ? (
                            <p role="status" className="image-canvas-project__error">
                              {project.error}
                            </p>
                          ) : null}
                          <div className="image-canvas-project__actions">
                            {isRenaming ? (
                              <button
                                type="button"
                                className="icon-button"
                                title={tx("取消重命名", "Cancel rename")}
                                aria-label={tx("取消重命名", "Cancel rename")}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => cancelCanvasRename(project.id)}
                              >
                                <X aria-hidden="true" size={13} />
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="icon-button"
                                  title={tx("重命名", "Rename")}
                                  aria-label={tx(
                                    `重命名 ${project.name}`,
                                    `Rename ${project.name}`,
                                  )}
                                  disabled={!project.available || busy !== null}
                                  onClick={() => beginCanvasRename(project)}
                                >
                                  <Pencil aria-hidden="true" size={13} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-button"
                                  title={tx("复制画布", "Duplicate canvas")}
                                  aria-label={tx(
                                    `复制 ${project.name}`,
                                    `Duplicate ${project.name}`,
                                  )}
                                  disabled={!project.available || busy !== null}
                                  onClick={() => void duplicateCanvasProject(project)}
                                >
                                  <Copy aria-hidden="true" size={13} />
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              className="icon-button image-canvas-project__delete"
                              title={tx("删除本地工程", "Delete local project")}
                              aria-label={tx(`删除 ${project.name}`, `Delete ${project.name}`)}
                              disabled={busy !== null}
                              onClick={() => void deleteCanvasProject(project)}
                            >
                              <Trash2 aria-hidden="true" size={13} />
                            </button>
                          </div>
                        </article>
                      );
                    })}
                    {!filteredCanvasProjects.length ? (
                      <div className="image-canvas-library__empty">
                        <Layers3 aria-hidden="true" size={21} />
                        <strong>{tx("还没有本地画布", "No local canvases yet")}</strong>
                        <button type="button" className="btn btn--secondary" onClick={createCanvas}>
                          <Plus aria-hidden="true" size={14} />
                          {tx("新建画布", "New canvas")}
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => bundleInputRef.current?.click()}
                        >
                          <ArrowUpFromLine aria-hidden="true" size={14} />
                          {tx("导入画布", "Import canvas")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </aside>

        <main className="image-workspace">
          <div className="image-workspace__toolbar">
            <div
              className="image-workspace__tabs"
              role="tablist"
              aria-label={tx("画布", "Canvases")}
            >
              {workspace.documents.map((document) => (
                <div
                  className="image-workspace__tab"
                  data-testid="image-canvas-tab"
                  data-canvas-id={document.id}
                  key={document.id}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={document.id === currentDocument?.id}
                    className={document.id === currentDocument?.id ? "is-active" : ""}
                    title={document.name}
                    onClick={() => {
                      setSelectedLayerId(null);
                      updateWorkspace((current) => ({ ...current, activeDocumentId: document.id }));
                    }}
                  >
                    <Layers3 aria-hidden="true" size={14} />
                    <span>{document.name}</span>
                  </button>
                  <button
                    type="button"
                    className="image-workspace__tab-close"
                    title={tx("关闭画布", "Close canvas")}
                    aria-label={tx(`关闭画布 ${document.name}`, `Close canvas ${document.name}`)}
                    disabled={busy !== null}
                    onClick={() => void closeCanvas(document.id)}
                  >
                    <X aria-hidden="true" size={12} />
                  </button>
                </div>
              ))}
            </div>
            <div className="image-workspace__tools">
              <button
                className="icon-button image-workspace__library-toggle"
                type="button"
                data-testid="image-library-toggle"
                title={
                  assetsExpanded
                    ? tx("关闭素材库", "Close asset library")
                    : tx("打开素材库", "Open asset library")
                }
                aria-label={
                  assetsExpanded
                    ? tx("关闭素材库", "Close asset library")
                    : tx("打开素材库", "Open asset library")
                }
                aria-expanded={assetsExpanded}
                aria-controls="image-studio-library"
                onClick={toggleAssets}
              >
                <Images aria-hidden="true" size={15} />
              </button>
              <button
                className="icon-button"
                type="button"
                title={tx("缩小", "Zoom out")}
                aria-label={tx("缩小", "Zoom out")}
                disabled={!currentDocument}
                onClick={() => currentDocument && setViewportZoom(currentDocument.zoom * 0.9)}
              >
                <ZoomOut aria-hidden="true" size={15} />
              </button>
              <span>{Math.round((currentDocument?.zoom ?? 0) * 100)}%</span>
              <button
                className="icon-button"
                type="button"
                title={tx("放大", "Zoom in")}
                aria-label={tx("放大", "Zoom in")}
                disabled={!currentDocument}
                onClick={() => currentDocument && setViewportZoom(currentDocument.zoom * 1.1)}
              >
                <ZoomIn aria-hidden="true" size={15} />
              </button>
              <button
                className="icon-button"
                type="button"
                title={tx("适应画布", "Fit canvas")}
                aria-label={tx("适应画布", "Fit canvas")}
                disabled={!currentDocument}
                onClick={fitCanvas}
              >
                <Maximize2 aria-hidden="true" size={15} />
              </button>
              <button
                className="icon-button"
                type="button"
                title={tx("导出 PNG", "Export PNG")}
                aria-label={tx("导出 PNG", "Export PNG")}
                data-testid="image-export-png"
                disabled={!currentDocument || busy !== null}
                onClick={() => void exportPng()}
              >
                {busy === "png" ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <ArrowDownToLine size={15} />
                )}
              </button>
              <button
                className="icon-button image-workspace__inspector-toggle"
                type="button"
                data-testid="image-inspector-toggle"
                title={
                  inspectorExpanded
                    ? tx("收起设置面板", "Close settings panel")
                    : tx("展开设置面板", "Open settings panel")
                }
                aria-label={
                  inspectorExpanded
                    ? tx("收起设置面板", "Close settings panel")
                    : tx("展开设置面板", "Open settings panel")
                }
                aria-expanded={inspectorExpanded}
                aria-controls="image-studio-inspector"
                onClick={toggleInspector}
              >
                <PanelRight aria-hidden="true" size={15} />
              </button>
            </div>
          </div>

          <div
            ref={viewportRef}
            className={currentDocument ? "image-viewport" : "image-viewport image-viewport--empty"}
            onWheel={onWheel}
            onPointerDown={beginBackgroundPan}
            onPointerMove={onPointerMove}
            onPointerUp={endInteraction}
            onPointerCancel={endInteraction}
          >
            {currentDocument ? (
              <>
                <div
                  className="image-canvas-surface"
                  data-testid="image-canvas"
                  style={{
                    width: currentDocument.width,
                    height: currentDocument.height,
                    background: currentDocument.background,
                    transform: `translate(${currentDocument.offsetX}px, ${currentDocument.offsetY}px) scale(${currentDocument.zoom})`,
                  }}
                >
                  {currentDocument.layers.map((layer) => (
                    <CanvasLayerImage
                      key={layer.id}
                      layer={layer}
                      selected={layer.id === selectedLayerId}
                      onPointerDown={(event) => beginLayerMove(event, layer)}
                    />
                  ))}
                </div>
                <span className="image-viewport__hint">
                  {tx(
                    "拖动画布平移 · 滚轮缩放 · 拖动图片移动",
                    "Drag to pan · wheel to zoom · drag layers",
                  )}
                </span>
              </>
            ) : (
              <button type="button" className="image-viewport__empty" onClick={createCanvas}>
                <Layers3 aria-hidden="true" size={27} />
                <strong>{tx("创建第一张无限画布", "Create your first infinite canvas")}</strong>
                <small>
                  {tx(
                    "自由摆放、缩放和组合本地或生成图片",
                    "Arrange, scale and combine local or generated images",
                  )}
                </small>
              </button>
            )}
          </div>
        </main>

        <aside
          id="image-studio-inspector"
          className="image-inspector"
          aria-label={tx("图片设置", "Image settings")}
          hidden={!inspectorExpanded}
        >
          <section
            className="image-inspector__section image-generation-settings"
            data-testid="image-generation-settings"
          >
            <div className="image-inspector__heading">
              <span>
                <Sparkles aria-hidden="true" size={15} />
                <strong>{tx("生成参数", "Generation settings")}</strong>
              </span>
            </div>
            <fieldset className="image-generation-settings__block">
              <legend className="image-setting-label">{tx("质量", "Quality")}</legend>
              <div className="image-choice-grid image-choice-grid--quality">
                {imageQualityOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={workspace.generation.quality === option.value}
                    className={workspace.generation.quality === option.value ? "is-selected" : ""}
                    onClick={() => updateGeneration({ quality: option.value })}
                  >
                    {en ? option.en : option.zh}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="image-generation-settings__block">
              <div className="image-generation-settings__row">
                <span className="image-setting-label">{tx("尺寸", "Size")}</span>
                <label className="image-setting-toggle">
                  <span>{tx("16 倍数对齐", "Align to 16")}</span>
                  <input
                    type="checkbox"
                    checked={workspace.generation.alignTo16}
                    onChange={(event) => {
                      const alignTo16 = event.target.checked;
                      updateGeneration((current) => ({
                        ...current,
                        alignTo16,
                        width: alignTo16 ? alignImageStudioDimension(current.width) : current.width,
                        height: alignTo16
                          ? alignImageStudioDimension(current.height)
                          : current.height,
                      }));
                    }}
                  />
                </label>
              </div>
              <div className="image-dimension-fields">
                <label className="image-dimension-field">
                  <span>W</span>
                  <input
                    type="number"
                    min={IMAGE_STUDIO_MIN_DIMENSION}
                    max={IMAGE_STUDIO_MAX_DIMENSION}
                    step={workspace.generation.alignTo16 ? 16 : 1}
                    value={workspace.generation.width}
                    disabled={workspace.generation.resolution === "auto"}
                    onChange={(event) => updateDimension("width", event.target.value)}
                  />
                </label>
                <span className="image-dimension-fields__link" aria-hidden="true">
                  ↔
                </span>
                <label className="image-dimension-field">
                  <span>H</span>
                  <input
                    type="number"
                    min={IMAGE_STUDIO_MIN_DIMENSION}
                    max={IMAGE_STUDIO_MAX_DIMENSION}
                    step={workspace.generation.alignTo16 ? 16 : 1}
                    value={workspace.generation.height}
                    disabled={workspace.generation.resolution === "auto"}
                    onChange={(event) => updateDimension("height", event.target.value)}
                  />
                </label>
              </div>
            </div>
            <fieldset className="image-generation-settings__block">
              <legend className="image-setting-label">{tx("分辨率", "Resolution")}</legend>
              <div className="image-choice-grid image-choice-grid--resolution">
                {imageResolutionOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={workspace.generation.resolution === option.value}
                    className={
                      workspace.generation.resolution === option.value ? "is-selected" : ""
                    }
                    onClick={() => chooseResolution(option.value)}
                  >
                    {en && option.value === "auto" ? "Auto" : option.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="image-generation-settings__block">
              <legend className="image-setting-label">{tx("画面比例", "Aspect ratio")}</legend>
              <div className="image-ratio-grid">
                {imageAspectRatios.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={workspace.generation.aspectRatio === option.value}
                    className={
                      workspace.generation.aspectRatio === option.value ? "is-selected" : ""
                    }
                    disabled={workspace.generation.resolution === "auto"}
                    onClick={() => chooseAspectRatio(option.value)}
                  >
                    {option.ratio ? (
                      <span
                        className="image-ratio-grid__shape"
                        style={{ aspectRatio: option.ratio }}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span>{option.value === "auto" ? (en ? "Auto" : "自动") : option.value}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="image-setting-toggle image-setting-toggle--wide">
              <span>
                <strong>{tx("透明背景", "Transparent background")}</strong>
                <small>{tx("仅在所选模型支持时生效", "Only available on supported models")}</small>
              </span>
              <input
                type="checkbox"
                checked={workspace.generation.transparentBackground}
                onChange={(event) =>
                  updateGeneration({ transparentBackground: event.target.checked })
                }
              />
            </label>
            <fieldset className="image-generation-settings__block">
              <legend className="image-setting-label">{tx("图片数量", "Image count")}</legend>
              <div className="image-choice-grid image-choice-grid--count">
                {Array.from({ length: 10 }, (_, index) => index + 1).map((count) => (
                  <button
                    key={count}
                    type="button"
                    aria-label={en ? `${count} ${count === 1 ? "image" : "images"}` : `${count} 张`}
                    aria-pressed={workspace.generation.imageCount === count}
                    className={workspace.generation.imageCount === count ? "is-selected" : ""}
                    onClick={() => updateGeneration({ imageCount: count })}
                  >
                    {en ? count : `${count} 张`}
                  </button>
                ))}
                <label className="image-generation-settings__custom-count">
                  <span>{tx("自定义", "Custom")}</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    value={imageCountDraft}
                    aria-label={tx("自定义图片数量", "Custom image count")}
                    onChange={(event) => {
                      setImageCountDraft(event.target.value);
                    }}
                    onBlur={() => {
                      const count = Number(imageCountDraft);
                      const normalized = Number.isFinite(count)
                        ? clamp(Math.round(count), 1, 10)
                        : workspaceRef.current.generation.imageCount;
                      setImageCountDraft(String(normalized));
                      updateGeneration({ imageCount: normalized });
                    }}
                  />
                </label>
              </div>
            </fieldset>
            <p className="image-generation-settings__note">
              {tx(
                "质量档位、透明背景与自定义尺寸取决于图片模型支持；不支持时会显示供应商错误，不会静默降级。",
                "Quality, transparency and custom dimensions depend on the image model. Unsupported settings surface the provider error instead of silently falling back.",
              )}
            </p>
          </section>

          <section className="image-inspector__section">
            <div className="image-inspector__heading">
              <span>
                <WandSparkles aria-hidden="true" size={15} />
                <strong>{tx("创意提示词", "Creative prompt")}</strong>
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--compact"
                data-testid="image-polish"
                disabled={!workspace.textModel || !workspace.prompt.trim() || busy !== null}
                onClick={() => void polish()}
              >
                {busy === "polish" ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={14} />
                ) : (
                  <Sparkles aria-hidden="true" size={14} />
                )}
                {tx("润色", "Polish")}
              </button>
            </div>
            <textarea
              className="image-prompt"
              data-testid="image-prompt"
              maxLength={4_000}
              value={workspace.prompt}
              onChange={(event) => {
                const prompt = event.target.value;
                updateWorkspace((current) => ({ ...current, prompt }));
              }}
              placeholder={tx(
                "写下一个初步想法。语言模型可以帮你完善构图、光线、材质与风格。",
                "Start with an idea. A language model can refine composition, light, materials and style.",
              )}
            />
            {promptPreview ? (
              <div className="image-prompt-preview">
                <strong>{tx("建议提示词", "Suggested prompt")}</strong>
                {promptPreview.sourceName ? (
                  <span>
                    {tx(`来源：${promptPreview.sourceName}`, `From: ${promptPreview.sourceName}`)}
                  </span>
                ) : null}
                <textarea
                  className="image-prompt"
                  data-testid="image-prompt-preview"
                  aria-label={tx("建议提示词", "Suggested prompt")}
                  value={promptPreview.text}
                  maxLength={4_000}
                  onChange={(event) => {
                    const text = event.target.value;
                    setPromptPreview((current) => (current ? { ...current, text } : null));
                  }}
                />
                {workspace.prompt !== promptPreview.sourcePrompt ? (
                  <p role="status">
                    {tx(
                      "提示词已更改，请重新生成建议。",
                      "The prompt changed; request a new suggestion.",
                    )}
                  </p>
                ) : null}
                {promptPreview.text.length > 4_000 ? (
                  <p role="status">
                    {tx(
                      "建议超过 4000 字符，请先缩短。",
                      "Shorten the suggestion to 4,000 characters.",
                    )}
                  </p>
                ) : null}
                <div className="image-inspector__actions">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    data-testid="image-prompt-discard"
                    onClick={() => setPromptPreview(null)}
                  >
                    {tx("放弃", "Discard")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    data-testid="image-prompt-apply"
                    disabled={
                      workspace.prompt !== promptPreview.sourcePrompt ||
                      promptPreview.text.length > 4_000
                    }
                    onClick={() => {
                      if (
                        workspaceRef.current.prompt !== promptPreview.sourcePrompt ||
                        promptPreview.text.length > 4_000
                      )
                        return;
                      updateWorkspace((current) => ({ ...current, prompt: promptPreview.text }));
                      setPromptPreview(null);
                    }}
                  >
                    {tx("应用", "Apply")}
                  </button>
                </div>
              </div>
            ) : null}
            <div className="image-reference-control">
              <div className="image-reference-control__header">
                <label className="image-setting-toggle image-setting-toggle--wide image-reference-toggle">
                  <span>
                    <strong>{tx("使用参考图", "Use references")}</strong>
                    <small>
                      {tx(
                        "按素材库勾选顺序取前 3 张，用于结构、风格或角色参考。",
                        "Uses the first 3 selected assets for composition, style or character reference.",
                      )}
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    data-testid="image-reference-toggle"
                    checked={workspace.generation.referenceEnabled}
                    disabled={busy !== null}
                    onChange={(event) => {
                      const referenceEnabled = event.target.checked;
                      updateGeneration({ referenceEnabled });
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn--ghost btn--compact image-reference-control__upload"
                  data-testid="image-reference-upload"
                  disabled={busy !== null}
                  onClick={() => referenceInputRef.current?.click()}
                >
                  <ArrowUpFromLine aria-hidden="true" size={13} />
                  {tx("上传", "Upload")}
                </button>
                <input
                  ref={referenceInputRef}
                  hidden
                  type="file"
                  data-testid="image-reference-input"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  onChange={(event) => void importImages(event, true)}
                />
              </div>
              {workspace.generation.referenceEnabled ? (
                <>
                  <div className="image-reference-preview" data-testid="image-reference-preview">
                    <span className="visually-hidden">{tx("当前参考图", "Active references")}</span>
                    {referenceAssets.length ? (
                      referenceAssets.map((asset, index) => (
                        <ReferenceAssetPreview
                          key={asset.id}
                          asset={asset}
                          order={index + 1}
                          disabled={busy !== null}
                          onRemove={() => toggleSelectedAsset(asset.id)}
                        />
                      ))
                    ) : (
                      <button
                        type="button"
                        className="image-reference-preview__empty"
                        disabled={busy !== null}
                        onClick={() => {
                          setAssetsExpanded(true);
                          if (window.matchMedia("(max-width: 680px)").matches)
                            setInspectorExpanded(false);
                        }}
                      >
                        <Images aria-hidden="true" size={16} />
                        <span>
                          {tx(
                            "从素材库勾选，或上传一张参考图",
                            "Select from the library or upload a reference",
                          )}
                        </span>
                      </button>
                    )}
                  </div>
                  {referenceOverflow ? (
                    <p className="image-reference-overflow" data-testid="image-reference-overflow">
                      {tx(
                        `已选 ${selectedAssets.length} 张，仅前 ${IMAGE_STUDIO_MAX_REFERENCE_IMAGES} 张会参与本次生成。`,
                        `${selectedAssets.length} selected; only the first ${IMAGE_STUDIO_MAX_REFERENCE_IMAGES} will be used.`,
                      )}
                    </p>
                  ) : null}
                </>
              ) : selectedAssets.length ? (
                <button
                  type="button"
                  className="image-reference-hint"
                  disabled={busy !== null}
                  onClick={() => updateGeneration({ referenceEnabled: true })}
                >
                  <ImageIcon aria-hidden="true" size={14} />
                  <span>
                    {tx(
                      `素材库已勾选 ${selectedAssets.length} 张，可启用参考图`,
                      `${selectedAssets.length} library assets selected; enable references`,
                    )}
                  </span>
                </button>
              ) : null}
            </div>
            <label className="field">
              <span>{tx("不希望出现", "Avoid")}</span>
              <input
                data-testid="image-negative-prompt"
                value={workspace.negativePrompt}
                maxLength={2_000}
                onChange={(event) => {
                  const negativePrompt = event.target.value;
                  updateWorkspace((current) => ({ ...current, negativePrompt }));
                }}
                placeholder={tx("可选：元素、风格或质量问题", "Optional exclusions")}
              />
            </label>
            <div className="image-inspector__actions">
              <button
                type="button"
                className="btn btn--secondary"
                data-testid="image-reverse"
                disabled={
                  !workspace.textModel ||
                  !selectedAssets.length ||
                  busy !== null ||
                  (selectedTextModel ? !isVisionTextModel(selectedTextModel) : true)
                }
                title={
                  selectedTextModel && !isVisionTextModel(selectedTextModel)
                    ? tx(
                        "所选语言模型需启用图片输入",
                        "The selected language model needs image input",
                      )
                    : undefined
                }
                onClick={() => void reversePrompt()}
              >
                {busy === "reverse" ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={14} />
                ) : (
                  <ImageIcon aria-hidden="true" size={14} />
                )}
                {tx("反推提示词", "From image")}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                data-testid="image-generate"
                disabled={
                  !workspace.imageModel ||
                  !workspace.prompt.trim() ||
                  busy !== null ||
                  (workspace.generation.referenceEnabled && !referenceAssetIds.length)
                }
                title={
                  workspace.generation.referenceEnabled && !referenceAssetIds.length
                    ? tx("请先勾选或上传参考图", "Select or upload a reference image first")
                    : undefined
                }
                onClick={() => void generate()}
              >
                {busy === "generate" ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={14} />
                ) : (
                  <Sparkles aria-hidden="true" size={14} />
                )}
                {tx("生成图片", "Generate")}
              </button>
            </div>
            {!workspace.imageModel || !workspace.textModel ? (
              <button
                type="button"
                className="image-inspector__provider-hint"
                onClick={onOpenProviderSettings}
              >
                {tx(
                  "配置图片模型和一个语言模型后即可开始。",
                  "Configure an image model and a language model to begin.",
                )}
              </button>
            ) : null}
          </section>

          <section className="image-inspector__section">
            <div className="image-inspector__heading">
              <span>
                <Layers3 aria-hidden="true" size={15} />
                <strong>{tx("画布与图层", "Canvas and layer")}</strong>
              </span>
              {currentDocument ? (
                <button
                  className="icon-button"
                  type="button"
                  title={tx("关闭画布", "Close canvas")}
                  aria-label={tx("关闭画布", "Close canvas")}
                  disabled={busy !== null}
                  onClick={() => void closeCanvas(currentDocument.id)}
                >
                  <X aria-hidden="true" size={14} />
                </button>
              ) : null}
            </div>
            {currentDocument ? (
              <>
                <label className="field">
                  <span>{tx("画布名称", "Canvas name")}</span>
                  <input
                    value={currentDocument.name}
                    maxLength={120}
                    onChange={(event) =>
                      patchDocument(currentDocument.id, { name: event.target.value })
                    }
                  />
                </label>
                <div className="image-field-grid">
                  <label className="field">
                    <span>{tx("宽度", "Width")}</span>
                    <input
                      type="number"
                      min={64}
                      max={8192}
                      value={Math.round(currentDocument.width)}
                      onChange={(event) =>
                        patchDocument(currentDocument.id, {
                          width: clamp(Number(event.target.value) || 64, 64, 8192),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{tx("高度", "Height")}</span>
                    <input
                      type="number"
                      min={64}
                      max={8192}
                      value={Math.round(currentDocument.height)}
                      onChange={(event) =>
                        patchDocument(currentDocument.id, {
                          height: clamp(Number(event.target.value) || 64, 64, 8192),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{tx("背景", "Background")}</span>
                    <input
                      type="color"
                      value={currentDocument.background}
                      onChange={(event) =>
                        patchDocument(currentDocument.id, { background: event.target.value })
                      }
                    />
                  </label>
                </div>
                {selectedLayer ? (
                  <div className="image-layer-controls">
                    <div className="image-layer-controls__order">
                      <button
                        className="icon-button"
                        type="button"
                        title={tx("下移一层", "Send backward")}
                        disabled={selectedLayer.zIndex <= 0}
                        onClick={() =>
                          patchDocument(currentDocument.id, (document) => ({
                            ...document,
                            layers: document.layers.map((layer) => {
                              if (layer.id === selectedLayer.id)
                                return { ...layer, zIndex: selectedLayer.zIndex - 1 };
                              if (layer.zIndex === selectedLayer.zIndex - 1)
                                return { ...layer, zIndex: selectedLayer.zIndex };
                              return layer;
                            }),
                          }))
                        }
                      >
                        <Minus aria-hidden="true" size={14} />
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        title={tx("上移一层", "Bring forward")}
                        disabled={selectedLayer.zIndex >= currentDocument.layers.length - 1}
                        onClick={() =>
                          patchDocument(currentDocument.id, (document) => ({
                            ...document,
                            layers: document.layers.map((layer) => {
                              if (layer.id === selectedLayer.id)
                                return { ...layer, zIndex: selectedLayer.zIndex + 1 };
                              if (layer.zIndex === selectedLayer.zIndex + 1)
                                return { ...layer, zIndex: selectedLayer.zIndex };
                              return layer;
                            }),
                          }))
                        }
                      >
                        <Plus aria-hidden="true" size={14} />
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        title={tx("删除图层", "Delete layer")}
                        onClick={() => {
                          patchDocument(currentDocument.id, (document) => ({
                            ...document,
                            layers: document.layers
                              .filter((layer) => layer.id !== selectedLayer.id)
                              .map((layer, index) => ({ ...layer, zIndex: index })),
                          }));
                          setSelectedLayerId(null);
                        }}
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </button>
                    </div>
                    <div className="image-field-grid image-field-grid--quad">
                      {(
                        [
                          ["x", tx("X", "X")],
                          ["y", tx("Y", "Y")],
                          ["width", tx("宽", "W")],
                          ["height", tx("高", "H")],
                        ] as const
                      ).map(([key, label]) => (
                        <label className="field" key={key}>
                          <span>{label}</span>
                          <input
                            type="number"
                            value={Math.round(selectedLayer[key])}
                            onChange={(event) =>
                              patchLayer(selectedLayer.id, {
                                [key]: Number(event.target.value) || 0,
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <label className="field">
                      <span>
                        {tx("旋转", "Rotation")} {Math.round(selectedLayer.rotation)}°
                      </span>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        value={selectedLayer.rotation}
                        onChange={(event) =>
                          patchLayer(selectedLayer.id, { rotation: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>
                        {tx("不透明度", "Opacity")} {Math.round(selectedLayer.opacity * 100)}%
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={selectedLayer.opacity * 100}
                        onChange={(event) =>
                          patchLayer(selectedLayer.id, {
                            opacity: Number(event.target.value) / 100,
                          })
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <p className="image-inspector__quiet">
                    {tx(
                      "点击画布中的图片以调整位置、尺寸与图层。",
                      "Select an image to edit position, size and layer order.",
                    )}
                  </p>
                )}
                <div className="image-inspector__button-row">
                  <button
                    className="btn btn--ghost"
                    type="button"
                    data-testid="image-bundle-import"
                    disabled={busy !== null}
                    onClick={() => bundleInputRef.current?.click()}
                  >
                    <ArrowUpFromLine aria-hidden="true" size={14} />
                    {tx("导入工程", "Import bundle")}
                  </button>
                  <button
                    className="btn btn--ghost"
                    type="button"
                    data-testid="image-bundle-export"
                    disabled={busy !== null}
                    onClick={() => void exportBundle()}
                  >
                    <ArrowDownToLine aria-hidden="true" size={14} />
                    {tx("导出工程", "Export bundle")}
                  </button>
                </div>
              </>
            ) : (
              <p className="image-inspector__quiet">
                {tx("新建画布后可编辑尺寸与图层。", "Create a canvas to edit size and layers.")}
              </p>
            )}
          </section>

          <section className="image-inspector__section">
            <div className="image-inspector__heading">
              <span>
                <Film aria-hidden="true" size={15} />
                <strong>{tx("图片动图", "Image motion")}</strong>
              </span>
            </div>
            <p className="image-inspector__quiet">
              {tx(
                "在素材库按顺序点选图片；导出时会裁切为统一尺寸并生成循环 GIF。",
                "Select images in order. Export crops to one frame size and creates a looping GIF.",
              )}
            </p>
            <label className="field">
              <span>
                {tx("每帧时长", "Frame delay")} {frameDelay} ms
              </span>
              <input
                type="range"
                min={80}
                max={2000}
                step={20}
                value={frameDelay}
                onChange={(event) => setFrameDelay(Number(event.target.value))}
              />
            </label>
            <button
              className="btn btn--secondary image-inspector__wide"
              type="button"
              data-testid="image-export-gif"
              disabled={selectedAssets.length < 2 || busy !== null}
              onClick={() => void exportGif()}
            >
              {busy === "gif" ? (
                <LoaderCircle className="spin" aria-hidden="true" size={14} />
              ) : (
                <Film aria-hidden="true" size={14} />
              )}
              {tx(
                `生成 GIF（${selectedAssets.length} 帧）`,
                `Create GIF (${selectedAssets.length} frames)`,
              )}
            </button>
          </section>
        </aside>
      </div>

      {generationWarnings.length && !error ? (
        <div
          className="image-studio__error image-studio__warning"
          role="status"
          aria-live="polite"
          data-testid="image-generation-warning"
        >
          <AlertTriangle aria-hidden="true" size={16} />
          <span>
            {tx(
              "图片已按实际尺寸保存到素材库。",
              "Images were saved to the library at their actual dimensions.",
            )}
            {generationWarnings.map((warning) => (
              <span key={warning.imageIndex} className="image-studio__warning-detail">
                {tx(
                  `第 ${warning.imageIndex} 张：供应商返回 ${warning.actualWidth}×${warning.actualHeight}，与请求的 ${warning.requestedWidth}×${warning.requestedHeight} 不一致。`,
                  `Image ${warning.imageIndex}: the provider returned ${warning.actualWidth}×${warning.actualHeight} instead of the requested ${warning.requestedWidth}×${warning.requestedHeight}.`,
                )}
              </span>
            ))}
          </span>
          <button
            type="button"
            aria-label={tx("关闭警告", "Dismiss warning")}
            onClick={() => setGenerationWarnings([])}
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="image-studio__error" role="alert">
          <span>{error}</span>
          <button type="button" aria-label={tx("关闭", "Close")} onClick={() => setError(null)}>
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
