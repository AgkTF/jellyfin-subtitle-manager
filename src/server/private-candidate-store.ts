import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export interface PrivateCandidateStore {
  stage(content: Buffer): string;
  read(stagedFileId: string): Buffer | undefined;
  close(): void;
}

function assertPrivateRoot(root: string): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const status = lstatSync(root);
  if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o077) !== 0) {
    throw new Error("Private candidate root must be a private real directory");
  }
}

function isOwnedFileId(value: string): boolean {
  return /^[0-9a-f-]{36}\.srt$/.test(value);
}

export function openPrivateCandidateStore(options: { root: string }): PrivateCandidateStore {
  const root = path.resolve(options.root);
  assertPrivateRoot(root);

  return {
    stage(content) {
      assertPrivateRoot(root);
      const stagedFileId = `${randomUUID()}.srt`;
      const filename = path.join(root, stagedFileId);
      const descriptor = openSync(
        filename,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(descriptor, content);
        fsyncSync(descriptor);
        const status = fstatSync(descriptor);
        if (!status.isFile()) throw new Error("Staged candidate is not a regular file");
      } finally {
        closeSync(descriptor);
      }
      return stagedFileId;
    },

    read(stagedFileId) {
      if (!isOwnedFileId(stagedFileId)) return undefined;
      assertPrivateRoot(root);
      const filename = path.join(root, stagedFileId);
      try {
        const status = lstatSync(filename);
        if (!status.isFile() || status.isSymbolicLink()) return undefined;
        return readFileSync(filename);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
        throw error;
      }
    },

    close() {
      // Synchronous file descriptors are scoped to individual operations.
    },
  };
}
