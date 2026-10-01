// Ensure node path is in PATH for any subprocesses spawned by build tools / postcss
if (process.env.PATH && !process.env.PATH.includes("/opt/homebrew/opt/node@22/bin")) {
  process.env.PATH = `/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:${process.env.PATH}`;
}

import http from "http";
import next from "next";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/lib/use/ws";
import { createSchema, createYoga } from "graphql-yoga";
import { typeDefs } from "./src/graphql/schema/typeDefs";
import { resolvers } from "./src/graphql/resolvers";
import { config } from "./src/server/config";
import { personaStore } from "./src/server/personas/store";
import { messageBank } from "./src/server/bank/store";
import { pipelineOrchestrator } from "./src/server/pipeline/orchestrator";

import { parse } from "url";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = config.port;

async function bootstrap() {
  console.log("[Server] Initializing CrowdChat services...");
  await personaStore.init();
  await messageBank.init();
  pipelineOrchestrator.init();

  delete process.env.TURBOPACK;
  process.env.IS_WEBPACK_TEST = "1";
  const app = (next as any)({ dev, hostname, port, webpack: true });
  const handle = app.getRequestHandler();
  await app.prepare();

  const schema = createSchema({
    typeDefs,
    resolvers,
  });

  const yoga = createYoga({
    schema,
    graphqlEndpoint: "/api/graphql",
  });

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url || "/", true);
      const { pathname } = parsedUrl;
      if (pathname && pathname.startsWith("/api/graphql")) {
        await (yoga as any)(req, res);
      } else {
        await handle(req, res, parsedUrl);
      }
    } catch (err) {
      console.error("[Server] Error handling request:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    }
  });

  // WebSocket Server for GraphQL Subscriptions over ws://
  const wsServer = new WebSocketServer({
    server,
    path: "/graphql",
  });

  useServer({ schema }, wsServer);

  server.listen(port, () => {
    console.log(`> CrowdChat Ready on http://${hostname}:${port}`);
    console.log(`> GraphQL Endpoint: http://${hostname}:${port}/api/graphql`);
    console.log(`> GraphQL Subscriptions: ws://${hostname}:${port}/graphql`);
    console.log(`> Control Panel: http://${hostname}:${port}/control`);
    console.log(`> OBS Stream Overlay: http://${hostname}:${port}/overlay`);
  });
}

bootstrap().catch((err) => {
  console.error("[Server] Fatal startup error:", err);
  process.exit(1);
});
