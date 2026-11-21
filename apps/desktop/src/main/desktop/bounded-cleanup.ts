export type BoundedCleanupResult = "settled" | "timed_out";

export async function settleWithin(
  tasks: readonly unknown[],
  timeoutMs: number,
): Promise<BoundedCleanupResult> {
  const settled = Promise.allSettled(tasks.map((task) => Promise.resolve(task))).then(
    () => "settled" as const,
  );
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<"timed_out">((resolve) => {
    timer = setTimeout(() => resolve("timed_out"), Math.max(1, timeoutMs));
  });
  try {
    return await Promise.race([settled, timedOut]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
