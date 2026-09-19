import childProcess from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { mock } from "node:test";

// System-boundary guards, installed after Chromium and the loopback server start.
// They fail even if application code catches an attempted scan/provider error.
export function guardReadOnlyJourney() {
  const attempts: string[] = [];
  const deny = (operation: string) => () => {
    attempts.push(operation);
    throw new Error(`Read-only journey attempted ${operation}`);
  };
  const guards = [
    mock.method(net.Socket.prototype, "connect", deny("outbound socket")),
    mock.method(globalThis, "fetch", deny("server fetch")),
    mock.method(childProcess, "spawn", deny("child process")),
    mock.method(childProcess, "spawnSync", deny("child process")),
    mock.method(childProcess, "exec", deny("child process")),
    mock.method(childProcess, "execSync", deny("child process")),
    mock.method(childProcess, "execFile", deny("child process")),
    mock.method(childProcess, "execFileSync", deny("child process")),
    mock.method(childProcess, "fork", deny("child process")),
    mock.method(fs, "readdir", deny("directory scan")),
    mock.method(fs, "readdirSync", deny("directory scan")),
    mock.method(fs, "opendir", deny("directory scan")),
    mock.method(fs, "opendirSync", deny("directory scan")),
    mock.method(fsPromises, "readdir", deny("directory scan")),
    mock.method(fsPromises, "opendir", deny("directory scan")),
  ];
  syncBuiltinESMExports();
  return {
    attempts,
    restore() {
      for (const guard of guards) guard.mock.restore();
      syncBuiltinESMExports();
    },
  };
}
