import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { logger, shutdownObservability } from "./observability.js";

@Injectable()
export class ObservabilityShutdownService implements OnApplicationShutdown {
  async onApplicationShutdown(signal?: string) {
    logger.info({ signal }, "api graceful shutdown completed; flushing observability");
    await shutdownObservability();
  }
}
