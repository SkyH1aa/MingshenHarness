import { describe, expect, it, vi } from "vitest";
import {
  STARTUP_PRESENTATION_CHANNELS,
  type StartupPresentationApi,
} from "../shared/startup-presentation";

const electron = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => void>(),
  exposed: new Map<string, unknown>(),
  send: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => electron.exposed.set(name, api),
  },
  ipcRenderer: {
    on: (channel: string, listener: (...args: unknown[]) => void) =>
      electron.listeners.set(channel, listener),
    send: electron.send,
  },
}));

import "./startup";

describe("startup presentation preload", () => {
  it("replays the latest validated stage and locale to a late subscriber", () => {
    const api = electron.exposed.get("startupPresentation") as StartupPresentationApi;
    const receive = electron.listeners.get(STARTUP_PRESENTATION_CHANNELS.stage);
    expect(receive).toBeTypeOf("function");
    receive?.({}, "services", "en");
    const listener = vi.fn();
    const unsubscribe = api.onStage(listener);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenLastCalledWith("services", "en");

    receive?.({}, "invalid-stage", "en");
    expect(listener).toHaveBeenCalledOnce();
    receive?.({}, "window", "unknown-locale");
    expect(listener).toHaveBeenLastCalledWith("window", "zh-CN");
    unsubscribe();
    receive?.({}, "ready", "en");
    expect(listener).toHaveBeenCalledTimes(2);

    api.skip();
    expect(electron.send).toHaveBeenCalledWith(STARTUP_PRESENTATION_CHANNELS.skip);
  });
});
