import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { HealthService } from "./health.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  getHealth() {
    return this.health.live();
  }

  @Get("live")
  getLive() {
    return this.health.live();
  }

  @Get("ready")
  async getReady() {
    const readiness = await this.health.ready();
    if (!readiness.ok) throw new ServiceUnavailableException(readiness);
    return readiness;
  }

  @Get("workers")
  async getWorkers() {
    const workers = await this.health.workers();
    if (!workers.ok) throw new ServiceUnavailableException(workers);
    return workers;
  }
}
