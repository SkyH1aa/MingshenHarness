import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { safeStorage } from "electron";
import { registerRuntimeSecret } from "../diagnostics/runtime-log";

export interface StoredSecret {
  secretRef: string;
  maskedHint: string;
}

export function maskSecret(secret: string): string {
  const normalized = secret.trim();
  if (normalized.length <= 8) {
    return "••••";
  }

  return `••••${normalized.slice(-4)}`;
}

export class SecretStore {
  constructor(private readonly database: DatabaseSync) {}

  store(secret: string): StoredSecret {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("系统凭据加密不可用，无法安全保存 API Key。");
    }

    const plaintext = secret.trim();
    if (!plaintext) {
      throw new Error("API Key 不能为空。");
    }

    const secretRef = randomUUID();
    const ciphertext = safeStorage.encryptString(plaintext);
    this.register(plaintext);

    this.database
      .prepare("insert into secrets (id, ciphertext, created_at) values (?, ?, ?)")
      .run(secretRef, ciphertext, new Date().toISOString());

    return {
      secretRef,
      maskedHint: maskSecret(plaintext),
    };
  }

  read(secretRef: string): string {
    const row = this.database
      .prepare("select ciphertext from secrets where id = ?")
      .get(secretRef) as { ciphertext: Uint8Array } | undefined;

    if (!row) {
      throw new Error("凭据不存在或已被删除。");
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("系统凭据解密不可用。");
    }

    const plaintext = safeStorage.decryptString(Buffer.from(row.ciphertext));
    this.register(plaintext);
    return plaintext;
  }

  private register(plaintext: string): void {
    registerRuntimeSecret(plaintext);
    try {
      const value = JSON.parse(plaintext) as unknown;
      const visit = (item: unknown, depth: number): void => {
        if (typeof item === "string") registerRuntimeSecret(item);
        else if (item && typeof item === "object" && depth < 6)
          for (const child of Object.values(item)) visit(child, depth + 1);
      };
      visit(value, 0);
    } catch {
      /* Most provider secrets are opaque strings. */
    }
  }

  remove(secretRef: string): void {
    this.database.prepare("delete from secrets where id = ?").run(secretRef);
  }
}
