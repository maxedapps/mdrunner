import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TemporaryDirectory {
  readonly path: string;
  cleanup(): Promise<void>;
}

export async function createTemporaryDirectory(
  prefix = "mdrunner-test-",
): Promise<TemporaryDirectory> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  let cleaned = false;
  return {
    path,
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await rm(path, { force: true, recursive: true });
    },
  };
}

export async function withTemporaryDirectory<T>(run: (path: string) => T | Promise<T>): Promise<T> {
  const directory = await createTemporaryDirectory();
  try {
    return await run(directory.path);
  } finally {
    await directory.cleanup();
  }
}
