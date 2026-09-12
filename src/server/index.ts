import { fileURLToPath } from "node:url";

import { buildServer } from "./app.js";

const DEFAULT_PORT = 3000;
const requestedPort = Number.parseInt(process.env.PORT ?? "", 10);
const port = Number.isInteger(requestedPort) ? requestedPort : DEFAULT_PORT;
const clientRoot = fileURLToPath(new URL("../client/", import.meta.url));
const server = buildServer({ clientRoot, logger: true });

try {
  await server.listen({ host: "127.0.0.1", port });
} catch (error) {
  server.log.error(error);
  process.exitCode = 1;
}
