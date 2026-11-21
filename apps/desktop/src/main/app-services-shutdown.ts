export interface AppServicesShutdownStep {
  name: string;
  run: () => unknown;
}

export interface AppServicesShutdownInput {
  steps: readonly AppServicesShutdownStep[];
  stopWorkspaceIo: () => unknown;
  cleanupPlugins: () => { errors: readonly string[] } | Promise<{ errors: readonly string[] }>;
  closeDatabase: () => unknown;
  report: (scope: string, error: unknown) => void;
}

interface ShutdownFailure {
  scope: string;
  error: unknown;
}

function startStep(step: AppServicesShutdownStep): Promise<unknown> {
  try {
    return Promise.resolve(step.run());
  } catch (error) {
    return Promise.reject(error);
  }
}

export async function runAppServicesShutdown(input: AppServicesShutdownInput): Promise<void> {
  const failures: ShutdownFailure[] = [];
  const stepResults = await Promise.allSettled(input.steps.map(startStep));

  for (const [index, result] of stepResults.entries()) {
    if (result.status === "rejected") {
      const step = input.steps[index];
      if (step) failures.push({ scope: step.name, error: result.reason });
    }
  }

  try {
    await input.stopWorkspaceIo();
  } catch (error) {
    failures.push({ scope: "workspace-io", error });
  }

  try {
    const cleanup = await input.cleanupPlugins();
    for (const detail of cleanup.errors) {
      failures.push({ scope: "plugins.cleanup", error: new Error(detail) });
    }
  } catch (error) {
    failures.push({ scope: "plugins.cleanup", error });
  }

  try {
    await input.closeDatabase();
  } catch (error) {
    failures.push({ scope: "database.close", error });
  }

  if (!failures.length) return;

  for (const failure of failures) {
    try {
      input.report(failure.scope, failure.error);
    } catch {
      // Reporting must not prevent the aggregated shutdown failure from surfacing.
    }
  }

  const scopes = [...new Set(failures.map((failure) => failure.scope))].join(", ");
  throw new AggregateError(
    failures.map((failure) => failure.error),
    `应用退出清理失败：${scopes}`,
  );
}
