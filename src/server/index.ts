import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildServer } from "./app.js";
import { resolveApiPort } from "./config.js";
import { openRequestWorkflow } from "./request-workflow.js";

const port = resolveApiPort(process.env.PORT);
const clientRoot = fileURLToPath(new URL("../client/", import.meta.url));
const databasePath =
  process.env.SUBTITLE_MANAGER_STATE_PATH ??
  path.resolve("private/subtitle-manager.sqlite");
mkdirSync(path.dirname(databasePath), { recursive: true });
const workflow = openRequestWorkflow({ databasePath });
const server = buildServer({ clientRoot, logger: true, workflow });
server.addHook("onClose", async () => workflow.close());

try {
  await server.listen({ host: "127.0.0.1", port });
} catch (error) {
  server.log.error(error);
  process.exitCode = 1;
}
