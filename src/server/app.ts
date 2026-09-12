import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

interface ServerOptions {
  clientRoot?: string;
  logger?: boolean;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: options.logger ?? false });

  server.get("/health", async () => ({ status: "ok" }));

  if (options.clientRoot !== undefined) {
    void server.register(fastifyStatic, {
      root: options.clientRoot,
    });
  }

  return server;
}
