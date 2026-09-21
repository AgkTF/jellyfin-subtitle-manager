import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export interface PrivateCandidateStore {
  stage(content: Buffer): string;
  /** Finds a complete operation-owned file with exactly these bytes. */
  findByContentHash?(contentHash: string): string | undefined;
  /** Returns bytes only when the owned file is complete and matches the durable hash. */
  read(stagedFileId: string, expectedContentHash?: string): Buffer | undefined;
  /** Removes only operation-owned temporary state beneath this store's root. */
  reconcile?(): void;
  close(): void;
}

const OWNED_FILE_ID = /^[0-9a-f-]{36}\.srt$/;
const TEMP_FILE_ID = /^[0-9a-f-]{36}\.srt\.tmp$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_STAGED_BYTES = 4 * 1024 * 1024;

function assertPrivateRoot(root: string): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const status = lstatSync(root);
  if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o077) !== 0) {
    throw new Error("Private candidate root must be a private real directory");
  }
}

function isOwnedFileId(value: string): boolean {
  return OWNED_FILE_ID.test(value);
}

function isTemporaryFileId(value: string): boolean {
  return TEMP_FILE_ID.test(value);
}

function isSha256(value: string): boolean {
  return SHA256.test(value);
}

function hash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function readOwnedFile(rootPath: string, stagedFileId: string): Buffer | undefined {
  const filename = path.join(rootPath, stagedFileId);
  let descriptor: number;
  try {
    descriptor = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const status = fstatSync(descriptor);
    if (!status.isFile() || status.size < 0 || status.size > MAX_STAGED_BYTES) return undefined;
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function openPrivateCandidateStore(options: { root: string }): PrivateCandidateStore {
  const root = path.resolve(options.root);
  assertPrivateRoot(root);
  const rootDescriptor = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const rootPath = `/proc/self/fd/${rootDescriptor}`;
  let closed = false;
  const assertOwnedRoot = () => {
    if (closed) throw new Error("Private candidate store is closed");
    const status = fstatSync(rootDescriptor);
    if (!status.isDirectory() || (status.mode & 0o077) !== 0) {
      throw new Error("Private candidate root must be a private real directory");
    }
  };
  const syncDirectory = () => fsyncSync(rootDescriptor);

  const findByContentHash = (contentHash: string): string | undefined => {
    if (!isSha256(contentHash)) return undefined;
    assertOwnedRoot();
    for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
      if (!entry.isFile() || !isOwnedFileId(entry.name)) continue;
      const content = readOwnedFile(rootPath, entry.name);
      if (content !== undefined && hash(content) === contentHash) return entry.name;
    }
    return undefined;
  };

  return {
    stage(content) {
      assertOwnedRoot();
      if (content.length > MAX_STAGED_BYTES) throw new Error("Staged candidate exceeds the private file limit");
      const contentHash = hash(content);
      const existing = findByContentHash(contentHash);
      if (existing !== undefined) return existing;

      const stagedFileId = `${randomUUID()}.srt`;
      const temporaryFileId = `${stagedFileId}.tmp`;
      const temporaryFilename = path.join(rootPath, temporaryFileId);
      const filename = path.join(rootPath, stagedFileId);
      let descriptor: number | undefined;
      let linked = false;
      try {
        descriptor = openSync(
          temporaryFilename,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          0o600,
        );
        writeFileSync(descriptor, content);
        fsyncSync(descriptor);
        const status = fstatSync(descriptor);
        if (!status.isFile() || status.size !== content.length) {
          throw new Error("Staged candidate is not a complete regular file");
        }
        closeSync(descriptor);
        descriptor = undefined;
        // link() is an atomic no-overwrite transition: unlike rename(), it cannot replace an existing file.
        linkSync(temporaryFilename, filename);
        linked = true;
        syncDirectory();
        unlinkSync(temporaryFilename);
        syncDirectory();
        return stagedFileId;
      } catch (error) {
        if (descriptor !== undefined) {
          closeSync(descriptor);
          descriptor = undefined;
        }
        if (!linked) {
          try { unlinkSync(temporaryFilename); } catch (cleanupError) {
            if (!(cleanupError instanceof Error && "code" in cleanupError && cleanupError.code === "ENOENT")) {
              throw cleanupError;
            }
          }
        }
        throw error;
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
    },

    findByContentHash,

    read(stagedFileId, expectedContentHash) {
      if (!isOwnedFileId(stagedFileId)) return undefined;
      if (expectedContentHash !== undefined && !isSha256(expectedContentHash)) return undefined;
      assertOwnedRoot();
      const content = readOwnedFile(rootPath, stagedFileId);
      if (content === undefined) return undefined;
      if (expectedContentHash !== undefined && hash(content) !== expectedContentHash) return undefined;
      return content;
    },

    reconcile() {
      assertOwnedRoot();
      let changed = false;
      for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        if (!isTemporaryFileId(entry.name)) continue;
        try {
          unlinkSync(path.join(rootPath, entry.name));
          changed = true;
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
      }
      if (changed) syncDirectory();
    },

    close() {
      if (!closed) {
        closed = true;
        closeSync(rootDescriptor);
      }
    },
  };
}
