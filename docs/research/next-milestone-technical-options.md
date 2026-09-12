# Next milestone technical options

Historical planning research and read-only compatibility check. This initial research performed no package downloads or installations. Its proposed package pairing and unexecuted-test status are superseded by the separately authorized [runtime compatibility check](sqlite-compatibility-check.md), which passed with Node v24.21.0 and better-sqlite3 v13.0.3 in temporary storage. No project dependencies or media were changed.

## Local platform and runtime

- OS: Omarchy 4.0.3 (Arch-derived)
- Kernel: Linux 7.2.3-arch1-3
- CPU architecture: `x86_64`
- libc: glibc 2.44
- Installed runtime: Node.js v26.7.0; npm 11.19.0; mise 2026.9.4
- No JavaScript package manifest or JavaScript lockfile is present; the repository does contain `uv.lock`.
- No `node_modules/better-sqlite3` is present.

The user approved Node.js 24 LTS, not an exact patch version or package pin. **Node.js v24.15.0 + better-sqlite3 v12.6.2 is only a proposed, verified example pairing.**

## ABI and exact package evidence

Node.js v24 uses **module ABI 137** (`process.versions.modules` / `NODE_MODULE_VERSION`), as recorded by Node’s ABI registry and v24 change history. This is distinct from **N-API** (`process.versions.napi`), which is a separate ABI-stability interface. The earlier report's claim of **N-API v137** was incorrect. The later executed Node v24.21.0 check reported module ABI `137` and N-API `10`; see the linked runtime report. The better-sqlite3 asset name `node-v137` refers to the Node module ABI, not N-API.

The exact released **better-sqlite3 v12.6.2** package manifest declares engines `20.x || 22.x || 23.x || 24.x || 25.x`; its release was published 2026-01-16. Its release assets include:

- `better-sqlite3-v12.6.2-node-v137-linux-x64.tar.gz`
- `better-sqlite3-v12.6.2-node-v137-linuxmusl-x64.tar.gz`

The local x86_64/glibc platform corresponds to the `linux-x64` family, not musl. Asset presence is **not** a runtime test.

The package install script is `prebuild-install || node-gyp rebuild --release`. A Unix source-build fallback requires supported Python, `make`, and a C/C++ compiler; node-gyp may obtain Node headers.

TypeScript declarations are separate: **@types/better-sqlite3 v9.6.0** is the npm latest/dist-tag observed at research time.

The earlier mention of **better-sqlite3 v13.0.2** came from a rolling package listing and was not an exact Node-24 asset/manifest verification. v12.6.2 is therefore a verified example, **not a preferred older version**. There is no evidence that v12.6.2 is inherently better; current stable-release support should remain open until v13.0.2 (or the selected current release) is checked against exact Node 24 assets, engines, and a permitted smoke test.

## Execution status

**Runtime smoke test: NOT RUN.** The installed Node is v26.7.0, the approved Node 24 runtime is not installed, and the package is absent. No downloads or lifecycle scripts were performed.

Minimal next test, only after permission: in an isolated temporary directory under the selected Node 24 patch, install the selected exact package and declarations; use a temporary database to test open, prepared insert/select, rollback, reopen persistence, and foreign-key enforcement; then remove the directory. This requires permission for package downloads, npm lifecycle execution, and possible native compilation/header retrieval.

## HTTP/server option

The approved direction is Fastify 5 + React/TypeScript/Vite. Bare `node:http` would leave the application owning routing, body parsing/limits, JSON validation, response serialization, lifecycle/error handling, test injection, and attachment streaming. Host/origin checks, CSRF, opaque-ID authorization, and safe attachment policy remain application-owned.

Fastify 5 is TypeScript-friendly and maintained. Official documentation provides JSON-Schema/Ajv validation for body/query/params/headers, response serialization, body limits, lifecycle hooks, encapsulated plugins, custom error handlers, and request injection for tests. `@fastify/csrf-protection` supplies token hooks, while `@fastify/multipart` supplies bounded multipart/file streams. Both still require deliberate application security configuration.

**Recommendation remains Fastify 5** with narrowly selected official plugins: it reduces security-sensitive HTTP plumbing the application must own without removing explicit loopback Host/Origin, CSRF, authorization, and attachment-by-owned-ID rules.

## Provider status (provisional)

OpenSubtitles remains provisional first because its official API documents `en`/`ar`, structured search/download, filename/hash search, release metadata, and provenance-related fields. Website quotas and API entitlements must not be conflated; exact current API limits and rendered application-key details remain unresolved.

SubDL remains the fallback. Its official API documents API-key access, `EN`/`AR` filtering, 2,000 free API requests/day, and ZIP or unpacked-file downloads. These figures require verification before implementation. Neither provider metadata proves synchronization or human Arabic authorship.

## Sources

- https://nodejs.org/en/download/archive/v24.15.0
- https://nodejs.org/en/blog/release/v24.15.0
- https://github.com/nodejs/node/blob/main/doc/abi_version_registry.json
- https://github.com/nodejs/node/commit/f26cab1b85
- https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.6.2
- https://raw.githubusercontent.com/WiseLibs/better-sqlite3/v12.6.2/package.json
- https://raw.githubusercontent.com/WiseLibs/better-sqlite3/v12.6.2/README.md
- https://github.com/WiseLibs/better-sqlite3/releases/download/v12.6.2/better-sqlite3-v12.6.2-node-v137-linux-x64.tar.gz
- https://github.com/WiseLibs/better-sqlite3/releases/download/v12.6.2/better-sqlite3-v12.6.2-node-v137-linuxmusl-x64.tar.gz
- https://github.com/nodejs/node-gyp/tree/v12.1.0
- https://registry.npmjs.org/@types%2fbetter-sqlite3
- https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- https://fastify.dev/docs/latest/Reference/Hooks/
- https://github.com/fastify/csrf-protection
- https://github.com/fastify/fastify-multipart
- https://opensubtitles.stoplight.io/docs/opensubtitles-api/e3750fd63a100-getting-started
- https://subdl.com/api-doc
