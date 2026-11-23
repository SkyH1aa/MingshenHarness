import { contextBridge, ipcRenderer } from "electron";
import {
  COMPANION_IPC_CHANNELS,
  type CompanionAction,
  type CompanionPreferences,
  type CompanionState,
} from "../shared/desktop-companion";

interface CompanionApi {
  getState(): Promise<CompanionState>;
  getPreferences(): Promise<CompanionPreferences>;
  setPreferences(patch: Partial<CompanionPreferences>): Promise<CompanionPreferences>;
  action(action: CompanionAction): Promise<CompanionState>;
  openMenu(): Promise<void>;
  openQuickChat(): Promise<void>;
  openSession(sessionId: string): Promise<void>;
  setMotionAvailability(allowed: boolean): Promise<void>;
  onState(listener: (state: CompanionState) => void): () => void;
  ready(): Promise<CompanionState>;
}

const api: CompanionApi = {
  getState: () => ipcRenderer.invoke(COMPANION_IPC_CHANNELS.getState),
  getPreferences: () => ipcRenderer.invoke(COMPANION_IPC_CHANNELS.getPreferences),
  setPreferences: (patch) => ipcRenderer.invoke(COMPANION_IPC_CHANNELS.setPreferences, patch),
  action: (action) => ipcRenderer.invoke(COMPANION_IPC_CHANNELS.action, action),
  openMenu: () => ipcRenderer.invoke(COMPANION_IPC_CHANNELS.openMenu),
  openQuickChat: () => ipcRenderer.invoke(COMPANION_IPC_CHANNELS.openQuickChat),
  openSession: (sessionId) => ipcRenderer.invoke(COMPANION_IPC_CHANNELS.openSession, sessionId),
  setMotionAvailability: (allowed) =>
    ipcRenderer.invoke(COMPANION_IPC_CHANNELS.setMotionAvailability, allowed),
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: CompanionState) => listener(state);
    ipcRenderer.on(COMPANION_IPC_CHANNELS.state, handler);
    return () => ipcRenderer.removeListener(COMPANION_IPC_CHANNELS.state, handler);
  },
  ready: () => ipcRenderer.invoke(COMPANION_IPC_CHANNELS.ready),
};

contextBridge.exposeInMainWorld("companion", api);
