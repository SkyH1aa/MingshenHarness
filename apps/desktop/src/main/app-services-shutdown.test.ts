import { describe, expect, it, vi } from "vitest";
import { runAppServicesShutdown } from "./app-services-shutdown";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("runAppServicesShutdown", () => {
  it("settles every service step before stopping workspace IO", async () => {
    const events: string[] = [];
    const slow = deferred();
    const stepError = new Error("chat shutdown failed");
    const report = vi.fn();

    const shutdown = runAppServicesShutdown({
      steps: [
        {
          name: "chat",
          run: async () => {
            events.push("chat:start");
            throw stepError;
          },
        },
        {
          name: "schedules",
          run: async () => {
            events.push("schedules:start");
            await slow.promise;
            events.push("schedules:end");
          },
        },
      ],
      stopWorkspaceIo: () => {
        events.push("workspace-io:stop");
      },
      cleanupPlugins: async () => {
        events.push("plugins:cleanup");
        return { errors: [] };
      },
      closeDatabase: () => {
        events.push("database:close");
      },
      report,
    }).catch((error: unknown) => error);

    await vi.waitFor(() => {
      expect(events).toEqual(["chat:start", "schedules:start"]);
    });
    expect(events).not.toContain("workspace-io:stop");

    slow.resolve();
    const failure = await shutdown;

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([stepError]);
    expect(events).toEqual([
      "chat:start",
      "schedules:start",
      "schedules:end",
      "workspace-io:stop",
      "plugins:cleanup",
      "database:close",
    ]);
    expect(report).toHaveBeenCalledWith("chat", stepError);
  });

  it("continues plugin cleanup and database close when workspace IO fails", async () => {
    const workspaceError = new Error("workspace IO did not stop");
    const events: string[] = [];
    const report = vi.fn();

    const failure = await runAppServicesShutdown({
      steps: [],
      stopWorkspaceIo: async () => {
        events.push("workspace-io:stop");
        throw workspaceError;
      },
      cleanupPlugins: async () => {
        events.push("plugins:cleanup");
        return { errors: [] };
      },
      closeDatabase: () => {
        events.push("database:close");
      },
      report,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([workspaceError]);
    expect(events).toEqual(["workspace-io:stop", "plugins:cleanup", "database:close"]);
    expect(report).toHaveBeenCalledWith("workspace-io", workspaceError);
  });

  it("aggregates step, workspace and plugin failures after closing the database", async () => {
    const stepError = new Error("retention failed");
    const workspaceError = new Error("workspace stop failed");
    const pluginErrors = ["locked old plugin A", "locked old plugin B"];
    const report = vi.fn();
    const closeDatabase = vi.fn();

    const failure = await runAppServicesShutdown({
      steps: [
        {
          name: "session-retention",
          run: async () => {
            throw stepError;
          },
        },
      ],
      stopWorkspaceIo: async () => {
        throw workspaceError;
      },
      cleanupPlugins: async () => ({ errors: pluginErrors }),
      closeDatabase,
      report,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    const aggregated = failure as AggregateError;
    expect(aggregated.errors).toHaveLength(4);
    expect(aggregated.errors[0]).toBe(stepError);
    expect(aggregated.errors[1]).toBe(workspaceError);
    expect(aggregated.errors.slice(2).map((error: Error) => error.message)).toEqual(pluginErrors);
    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(report.mock.calls.map(([scope]) => scope)).toEqual([
      "session-retention",
      "workspace-io",
      "plugins.cleanup",
      "plugins.cleanup",
    ]);
  });
});
