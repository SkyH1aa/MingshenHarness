import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Film,
  Image as ImageIcon,
  Images,
  Layers3,
  LoaderCircle,
  Maximize2,
  Minus,
  PanelRight,
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
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import type { ProviderView } from "../../../shared/domain";
import {
  emptyImageStudioWorkspace,
  IMAGE_STUDIO_MAX_GIF_FRAMES,
  IMAGE_STUDIO_MAX_IMPORT_BYTES,
  IMAGE_STUDIO_MAX_SINGLE_BYTES,
  type ImageStudioAsset,
  type ImageStudioCanvas,
  type ImageStudioLayer,
  type ImageStudioWorkspace,
} from "../../../shared/image-studio";
import { isVisionTextModel } from "../../../shared/model-capabilities";
import { useLocale } from "../i18n";
import { encodeGif } from "../lib/gif-encoder";
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
  mergeRemovedAsset,
} from "../lib/image-studio-workspace";
import { useDialog } from "./DialogProvider";
import { ModelPicker } from "./ModelPicker";

export interface ImageStudioProps {
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
  assets: Array<{
    id: string;
    name: string;
    dataUrl: string;
  }>;
}

const CANVAS_BUNDLE_FORMAT = ["ming", "shen", "image", "canvas"].join(".");
const assetUrlPromises = new Map<string, Promise<string>>();
const assetUrlValues = new ImageStudioUrlCache(32 * 1024 * 1024);
const workspaceQueue = new ImageStudioWorkspaceQueue((workspace) =>
  window.mingshen.saveImageStudioWorkspace(workspace),
);

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
  onDelete,
  disabled,
}: {
  asset: ImageStudioAsset;
  selectedOrder: number | null;
  onToggle: () => void;
  onAdd: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const url = useAssetUrl(visible ? asset.id : null);

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
    >
      <button
        type="button"
        className="image-asset__select"
        aria-pressed={selectedOrder !== null}
        title={asset.name}
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
      </button>
      <div className="image-asset__actions">
        <button type="button" title="加入当前画布" aria-label="加入当前画布" onClick={onAdd}>
          <Plus aria-hidden="true" size={14} />
        </button>
        <button
          type="button"
          title="删除素材"
          aria-label="删除素材"
          disabled={disabled}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" size={14} />
        </button>
      </div>
    </div>
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

export function ImageStudio({ providers, onOpenProviderSettings }: ImageStudioProps) {
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [promptPreview, setPromptPreview] = useState<{
    text: string;
    sourcePrompt: string;
    sourceName?: string;
  } | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [assetsExpanded, setAssetsExpanded] = useState(
    () => typeof window === "undefined" || !window.matchMedia("(max-width: 920px)").matches,
  );
  const [inspectorExpanded, setInspectorExpanded] = useState(
    () => typeof window === "undefined" || !window.matchMedia("(max-width: 920px)").matches,
  );
  const [frameDelay, setFrameDelay] = useState(350);
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bundleInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<LayerInteraction | null>(null);
  const mounted = useRef(false);
  const loadedRef = useRef(false);
  const loadVersion = useRef(0);
  const workspaceRef = useRef(workspace);
  const busyRef = useRef<string | null>(null);
  const activeRequestId = useRef<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentDocument =
    workspace.documents.find((document) => document.id === workspace.activeDocumentId) ?? null;
  const selectedLayer =
    currentDocument?.layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const selectedAssets = workspace.selectedAssetIds
    .map((id) => workspace.assets.find((asset) => asset.id === id))
    .filter((asset): asset is ImageStudioAsset => Boolean(asset));
  const filteredAssets = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return workspace.assets;
    return workspace.assets.filter(
      (asset) =>
        asset.name.toLocaleLowerCase().includes(query) ||
        asset.prompt?.toLocaleLowerCase().includes(query),
    );
  }, [search, workspace.assets]);

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
      .run(async () => normalizeWorkspace(await window.mingshen.getImageStudioWorkspace()))
      .then(
        (next) => {
          if (!active || loadVersion.current !== version) return;
          workspaceRef.current = next;
          loadedRef.current = true;
          setWorkspace(next);
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
  };

  const removeCanvas = async () => {
    if (!currentDocument) return;
    const yes = await confirm({
      title: tx("删除画布", "Delete canvas"),
      description: tx(
        `将删除「${currentDocument.name}」的画布布局，素材仍保留在素材库。`,
        `Delete the layout for “${currentDocument.name}”. Assets stay in the library.`,
      ),
      confirmLabel: tx("删除画布", "Delete"),
      tone: "danger",
    });
    if (!yes || !mounted.current) return;
    setSelectedLayerId(null);
    updateWorkspace((current) => {
      const documents = current.documents.filter((item) => item.id !== currentDocument.id);
      return {
        ...current,
        documents,
        activeDocumentId:
          current.activeDocumentId === currentDocument.id
            ? (documents[0]?.id ?? null)
            : current.activeDocumentId,
      };
    });
  };

  const addAssetToCanvas = (asset: ImageStudioAsset) => {
    const current = workspaceRef.current;
    if (!current.assets.some((item) => item.id === asset.id)) return;
    let document = current.documents.find((item) => item.id === current.activeDocumentId) ?? null;
    const hadDocument = Boolean(document);
    if (!document) {
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
    const scale = Math.min(
      (document.width * 0.72) / Math.max(1, asset.width),
      (document.height * 0.72) / Math.max(1, asset.height),
      1,
    );
    const width = Math.max(24, asset.width * scale);
    const height = Math.max(24, asset.height * scale);
    const layer: ImageStudioLayer = {
      id: crypto.randomUUID(),
      assetId: asset.id,
      x: (document.width - width) / 2,
      y: (document.height - height) / 2,
      width,
      height,
      rotation: 0,
      opacity: 1,
      zIndex: document.layers.length,
    };
    const nextDocument = {
      ...document,
      layers: [...document.layers, layer],
      updatedAt: new Date().toISOString(),
    };
    const documents = hadDocument
      ? current.documents.map((item) => (item.id === nextDocument.id ? nextDocument : item))
      : [...current.documents, nextDocument];
    setSelectedLayerId(layer.id);
    updateWorkspace({
      ...current,
      activeDocumentId: nextDocument.id,
      documents,
    });
    if (window.matchMedia("(max-width: 680px)").matches) setAssetsExpanded(false);
  };

  const importImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length || busyRef.current) return;
    setError(null);
    setOperation("import");
    try {
      if (files.length > 20)
        throw new Error(tx("每次最多导入 20 张图片。", "Import up to 20 images."));
      const total = files.reduce((sum, file) => sum + file.size, 0);
      if (total > IMAGE_STUDIO_MAX_IMPORT_BYTES)
        throw new Error(
          tx("本次图片合计不能超过 100 MiB。", "The import must not exceed 100 MiB."),
        );
      const payload = await Promise.all(
        files.map(async (file) => {
          if (file.size > IMAGE_STUDIO_MAX_SINGLE_BYTES)
            throw new Error(
              tx(`${file.name} 超过单图 25 MiB 限制。`, `${file.name} exceeds 25 MiB.`),
            );
          return {
            name: file.name,
            dataUrl: await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
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
        updateWorkspace((current) => mergeAssetResult(current, next));
      });
      showNotice(tx(`已导入 ${files.length} 张图片`, `${files.length} images imported`));
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (busyRef.current === "import") setOperation(null);
    }
  };

  const removeAsset = async (asset: ImageStudioAsset) => {
    if (busyRef.current) return;
    const yes = await confirm({
      title: tx("删除图片素材", "Delete image"),
      description: tx(
        `将删除「${asset.name}」及所有画布中的引用。`,
        `Delete “${asset.name}” and all canvas references.`,
      ),
      confirmLabel: tx("删除素材", "Delete"),
      tone: "danger",
    });
    if (!yes || busyRef.current || !mounted.current) return;
    const operation = `remove-${asset.id}`;
    setOperation(operation);
    try {
      await workspaceQueue.run(async () => {
        const next = await window.mingshen.removeImageStudioAsset(asset.id);
        forgetAssetUrl(asset.id);
        updateWorkspace((current) => mergeRemovedAsset(current, next, asset.id));
      });
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
    setOperation("generate");
    setError(null);
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
          size: "1024x1024",
          addToActiveCanvas: true,
        });
        if (!mounted.current || activeRequestId.current !== requestId) return;
        assetUrlValues.set(result.asset.id, result.dataUrl);
        updateWorkspace((current) => mergeGeneratedResult(current, result));
        showNotice(tx("图片已生成并保存到素材库", "Image generated and saved"));
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
    updateWorkspace((current) => {
      const selected = current.selectedAssetIds.includes(assetId);
      return {
        ...current,
        selectedAssetIds: selected
          ? current.selectedAssetIds.filter((id) => id !== assetId)
          : [...current.selectedAssetIds, assetId].slice(0, 30),
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
        sourceAssets.reduce((sum, asset) => sum + (asset?.size ?? 0), 0) >
          IMAGE_STUDIO_MAX_IMPORT_BYTES
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

  return (
    <section
      className="image-studio"
      aria-label={tx("生图工作台", "Image Studio")}
      data-testid="image-studio"
    >
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
              <label className="image-library__search">
                <span className="visually-hidden">{tx("搜索素材", "Search assets")}</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={tx("搜索名称或提示词", "Search name or prompt")}
                />
              </label>
              <div className="image-library__selection">
                <span>
                  {selectedAssets.length
                    ? tx(
                        `已选 ${selectedAssets.length} 帧`,
                        `${selectedAssets.length} frames selected`,
                      )
                    : tx("按顺序选择动图帧", "Select frames in order")}
                </span>
                {selectedAssets.length ? (
                  <button
                    type="button"
                    className="icon-button"
                    title={tx("清空选择", "Clear selection")}
                    aria-label={tx("清空选择", "Clear selection")}
                    onClick={() =>
                      updateWorkspace((current) => ({ ...current, selectedAssetIds: [] }))
                    }
                  >
                    <X aria-hidden="true" size={14} />
                  </button>
                ) : null}
              </div>
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
                    onDelete={() => void removeAsset(asset)}
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
                    <small>{tx("本地导入，不依赖原文件", "Local import, no source path")}</small>
                  </button>
                ) : null}
              </div>
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
                <button
                  key={document.id}
                  type="button"
                  role="tab"
                  aria-selected={document.id === currentDocument?.id}
                  className={document.id === currentDocument?.id ? "is-active" : ""}
                  onClick={() => {
                    setSelectedLayerId(null);
                    updateWorkspace((current) => ({ ...current, activeDocumentId: document.id }));
                  }}
                >
                  <Layers3 aria-hidden="true" size={14} />
                  <span>{document.name}</span>
                </button>
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
            <label className="field">
              <span>{tx("不希望出现", "Avoid")}</span>
              <input
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
                disabled={!workspace.imageModel || !workspace.prompt.trim() || busy !== null}
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
                  title={tx("删除画布", "Delete canvas")}
                  aria-label={tx("删除画布", "Delete canvas")}
                  onClick={() => void removeCanvas()}
                >
                  <Trash2 aria-hidden="true" size={14} />
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
