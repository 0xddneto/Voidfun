import { defineConfig } from "vite";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
export default defineConfig({
  plugins: [
    {
      name: "local-read-api",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const name = request.url?.split("?")[0];
          if (!["/api/market", "/api/history"].includes(name)) return next();
          response.status = (status) => {
            response.statusCode = status;
            return response;
          };
          response.json = (value) => {
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify(value));
          };
          response.send = (value) => response.end(value);
          try {
            const { default: handler } = await import(
              pathToFileURL(resolve(server.config.root, name.slice(1) + ".js"))
                .href
            );
            await handler(request, response);
          } catch (error) {
            next(error);
          }
        });
      },
    },
  ],
  base: process.env.DEPLOY_BASE ?? "/",
  server: { host: "127.0.0.1", port: 3050 },
});
