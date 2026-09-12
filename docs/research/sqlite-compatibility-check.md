# better-sqlite3 / Node 24 compatibility check

Date: 2026-09-11 (UTC environment date)

## Verdict

**PASS for the tested platform and pairing.** `better-sqlite3` **13.0.3** is the current npm `latest` release observed during this check, declares Node `>=22`, and loaded successfully under the official **Node.js v24.21.0** Linux x64 runtime. No source compilation or compiler/toolchain installation was performed.

This is a bounded compatibility result, not application-wide compatibility approval.

## Exact release evidence

Primary manifests and release metadata were fetched without using the project dependencies:

- npm exact manifest: https://registry.npmjs.org/better-sqlite3/latest
  - version: `13.0.3`
  - engines: `{ "node": ">=22" }`
  - tarball: `https://registry.npmjs.org/better-sqlite3/-/better-sqlite3-13.0.3.tgz`
  - published tarball integrity: `sha512-RbOBxmLBG8uvFUc15X9+9SFemKcQ0WBuISBVkpuiaUB2qblC8UWlHEjdWVoZ8AdhSwmoEgsiXKfopX0CQxaACQ==`
- exact tagged source manifest: https://raw.githubusercontent.com/WiseLibs/better-sqlite3/v13.0.3/package.json
- official release metadata: https://api.github.com/repos/WiseLibs/better-sqlite3/releases/tags/v13.0.3
  - tag: `v13.0.3`
  - published: `2026-08-05T03:26:05Z`
  - GitHub release asset count: `0`
- official Node archive index: https://nodejs.org/download/release/v24.21.0/
- official Node checksum manifest: https://nodejs.org/download/release/v24.21.0/SHASUMS256.txt

The current package was not replaced with the older v12.6.2 example. The v13.0.3 npm payload contains platform prebuilds under `prebuilds/`; its `lib/linux-x64.js` explicitly loads `../prebuilds/linux-x64.node`. Since the GitHub release has no separately attached archive, this check used the official npm-published bundled prebuild through a prebuilt-only procedure. The package tarball and its bundled addon were inspected; no install lifecycle script was run.

## Runtime and payload validation

Platform inspected read-only: Linux x86_64, glibc 2.44. The official archive downloaded was:

```text
node-v24.21.0-linux-x64.tar.xz
```

The archive was validated with the official manifest:

```text
fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6  node-v24.21.0-linux-x64.tar.xz
```

The exact runtime reported:

```json
{"version":"v24.21.0","modules":"137","napi":"10","arch":"x64","platform":"linux"}
```

Thus `137` is the Node module ABI (`process.versions.modules`), not N-API. N-API was `10`.

The npm tarball's SHA-512 digest was checked against the registry `dist.integrity` value above. The downloaded tarball's digest matched. Relevant archive members included `lib/linux-x64.js` and `prebuilds/linux-x64.node`. The installed bundled addon was ELF64 x86-64; SHA-256:

```text
6fd4292c6c5f352436cd85c9e1cb286978efa43c20ae350973f83414ced9991d
```

## Reproduction procedure

All paths below were rooted in one `mktemp -d` directory with mode `700` (retained for captain inspection; current workspace basename: `better-sqlite3-compat.O6n7vE`). The repository package files and dependencies were not used or changed.

```sh
W=$(mktemp -d "${TMPDIR:-/tmp}/better-sqlite3-compat.XXXXXX")
chmod 700 "$W"
mkdir -p "$W/cache" "$W/app"
# Download Node v24.21.0 and SHASUMS256.txt from nodejs.org.
sha256sum -c <(grep ' node-v24.21.0-linux-x64.tar.xz$' "$W/node/SHASUMS256.txt")
tar -xJf "$W/node/node-v24.21.0-linux-x64.tar.xz" -C "$W/node/extracted" --strip-components=1
export PATH="$W/node/extracted/bin:$PATH"
export npm_config_userconfig="$W/npmrc" npm_config_cache="$W/cache"
"$W/node/extracted/bin/npm" install --ignore-scripts --no-audit --no-fund \
  --no-package-lock --prefix "$W/app" \
  "$W/npm/better-sqlite3-13.0.3.tgz"
```

The install output was `added 2 packages`; `--ignore-scripts` prevented the package's build/install lifecycle path. In particular, the default `prebuild-install || node-gyp rebuild --release` fallback was not run. No compiler, headers, node-gyp, source build, global install, mise configuration, or project package edit was involved.

The retained smoke script is `$W/smoke.js`; its log is `$W/logs/smoke.log`. It used the downloaded Node by absolute path and loaded the installed package by absolute path.

## Smoke assertions

All passed:

1. module load;
2. SQLite database open;
3. prepared insert and select;
4. committed data visible;
5. transaction exception rolled back its insert;
6. close, reopen, and persistence;
7. `PRAGMA foreign_keys = ON` rejected an invalid child row and accepted a valid one.

## Temporary side effects and cleanup

Only the owner-private temporary workspace was written. It contains the extracted Node runtime, isolated npm install/cache metadata (cache removed after installation), temporary package/release manifests and logs, the smoke script, and the temporary SQLite database. The large Node archive and npm tarball were removed after checksum/integrity validation; the extracted runtime and minimal test materials remain. No repository dependency or media state was touched.

TypeScript compilation was **not tested**; no temporary TypeScript package installation was necessary. Fastify, React, Vite, the existing application, SQLite schema design, and production filesystem/media behavior were not tested.

## Approval needed

No further approval is needed for this compatibility check. Before implementation or any real provider/library/media operation, the separate approvals and gates in the milestone plan still apply.
