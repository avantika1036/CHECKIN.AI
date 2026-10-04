import express, { type Express } from "express";
import type { ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";

import swaggerUi from "swagger-ui-express";
import swaggerUiDist from "swagger-ui-dist";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import router from "./routes";
import { logger } from "./lib/logger";



const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const openapiPath = fileURLToPath(
  new URL("../../../lib/api-spec/openapi.yaml", import.meta.url),
);

const openapiDocument = parse(readFileSync(openapiPath, "utf8"));

app.use(
  "/docs",
  express.static(swaggerUiDist.getAbsoluteFSPath(), {
    index: false,
  }),
);

app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));

app.use("/api", router);

const requestErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (
    error &&
    typeof error === "object" &&
    "type" in error &&
    error.type === "entity.too.large"
  ) {
    res.status(413).json({ error: "The audio recording exceeds the upload limit." });
    return;
  }
  const errorName = error instanceof Error ? error.name : "UnknownError";
  logger.error({ errorName }, "Unhandled API request error");
  res.status(500).json({ error: "Internal server error." });
};
app.use(requestErrorHandler);

export default app;
