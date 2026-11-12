export class StorageAdapter {
  constructor() {
    throw new Error("Harness project memory snapshot storage is required.");
  }
}

export class LocalStorageBackend extends StorageAdapter {}
