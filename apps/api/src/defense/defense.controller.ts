import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import {
  addDefenseRepositoryInputSchema,
  confirmDefensePlanInputSchema,
  createDefenseProjectInputSchema,
  createFactInputSchema,
  defenseUploadManifestSchema,
  patchDefenseConfigInputSchema,
  putDefensePlanInputSchema,
  rebuildDefensePlanInputSchema,
  requestComplianceReportPdfInputSchema,
  resolveConflictInputSchema,
  startComplianceCheckInputSchema,
  startDefenseAnalysisInputSchema,
  updateDefenseAssetInputSchema,
  updateFactInputSchema,
  updateRequirementInputSchema,
} from "@studydeck/shared";
import { BlockedUserGuard } from "../auth/blocked-user.guard.js";
import { InternalAuthGuard, type InternalRequest } from "../auth/internal-auth.guard.js";
import { badRequest, parseInput } from "../errors/api-error.js";
import { SourcesService } from "../sources/sources.service.js";
import { DefenseService } from "./defense.service.js";

@UseGuards(InternalAuthGuard, BlockedUserGuard)
@Controller("projects")
export class DefenseController {
  constructor(
    private readonly defense: DefenseService,
    private readonly sources: SourcesService,
  ) {}

  @Post("defense")
  create(@Req() request: InternalRequest, @Body() body: unknown) {
    return this.defense.create(request.userId, parseInput(createDefenseProjectInputSchema, body));
  }

  @Get(":id/defense")
  get(@Req() request: InternalRequest, @Param("id") projectId: string) {
    return this.defense.get(request.userId, projectId);
  }

  @Patch(":id/defense/config")
  updateConfig(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Body() body: unknown,
  ) {
    return this.defense.updateConfig(
      request.userId,
      projectId,
      parseInput(patchDefenseConfigInputSchema, body),
    );
  }

  @Post(":id/defense/analyze")
  startAnalysis(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Body() body: unknown,
  ) {
    return this.defense.startAnalysis(
      request.userId,
      projectId,
      parseInput(startDefenseAnalysisInputSchema, body),
    );
  }

  @Post(":id/defense/repositories")
  addRepository(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Body() body: unknown,
  ) {
    return this.defense.addRepository(
      request.userId,
      projectId,
      parseInput(addDefenseRepositoryInputSchema, body),
    );
  }

  @Post(":id/defense/uploads")
  @UseInterceptors(AnyFilesInterceptor({
    limits: {
      files: 20,
      fields: 5,
      fileSize: 100 * 1024 * 1024,
      fieldSize: 128 * 1024,
    },
  }))
  upload(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Body() body: unknown,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const manifest = parseManifest(body);
    return this.sources.uploadDefense(request.userId, projectId, files || [], manifest.files);
  }

  @Post(":id/defense/facts")
  createFact(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Body() body: unknown,
  ) {
    return this.defense.createFact(request.userId, projectId, parseInput(createFactInputSchema, body));
  }

  @Patch(":id/defense/facts/:factId")
  updateFact(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Param("factId") factId: string,
    @Body() body: unknown,
  ) {
    return this.defense.updateFact(
      request.userId,
      projectId,
      factId,
      parseInput(updateFactInputSchema, body),
    );
  }

  @Delete(":id/defense/facts/:factId")
  deleteFact(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Param("factId") factId: string,
  ) {
    return this.defense.deleteFact(request.userId, projectId, factId);
  }

  @Patch(":id/defense/requirements/:requirementId")
  updateRequirement(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Param("requirementId") requirementId: string,
    @Body() body: unknown,
  ) {
    return this.defense.updateRequirement(
      request.userId,
      projectId,
      requirementId,
      parseInput(updateRequirementInputSchema, body),
    );
  }

  @Patch(":id/defense/assets/:sourceId")
  updateAsset(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Param("sourceId") sourceId: string,
    @Body() body: unknown,
  ) {
    return this.defense.updateAsset(
      request.userId,
      projectId,
      sourceId,
      parseInput(updateDefenseAssetInputSchema, body),
    );
  }

  @Post(":id/defense/conflicts/:conflictId/resolve")
  resolveConflict(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Param("conflictId") conflictId: string,
    @Body() body: unknown,
  ) {
    return this.defense.resolveConflict(
      request.userId,
      projectId,
      conflictId,
      parseInput(resolveConflictInputSchema, body),
    );
  }

  @Get(":id/defense/plan")
  getPlan(@Req() request: InternalRequest, @Param("id") projectId: string) {
    return this.defense.getPlan(request.userId, projectId);
  }

  @Put(":id/defense/plan")
  updatePlan(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Body() body: unknown,
  ) {
    return this.defense.updatePlan(request.userId, projectId, parseInput(putDefensePlanInputSchema, body));
  }

  @Post(":id/defense/plan/confirm")
  confirmPlan(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Body() body: unknown,
  ) {
    return this.defense.confirmPlan(request.userId, projectId, parseInput(confirmDefensePlanInputSchema, body));
  }

  @Post(":id/defense/plan/rebuild")
  rebuildPlan(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Body() body: unknown,
  ) {
    return this.defense.rebuildPlan(request.userId, projectId, parseInput(rebuildDefensePlanInputSchema, body));
  }

  @Post(":id/defense/compliance-checks")
  startComplianceCheck(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Body() body: unknown,
  ) {
    return this.defense.startComplianceCheck(
      request.userId,
      projectId,
      parseInput(startComplianceCheckInputSchema, body),
    );
  }

  @Get(":id/defense/compliance-reports")
  listReports(@Req() request: InternalRequest, @Param("id") projectId: string) {
    return this.defense.listReports(request.userId, projectId);
  }

  @Get(":id/defense/compliance-reports/:reportId")
  getReport(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Param("reportId") reportId: string,
  ) {
    return this.defense.getReport(request.userId, projectId, reportId);
  }

  @Post(":id/defense/compliance-reports/:reportId/pdf")
  requestReportPdf(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Param("reportId") reportId: string,
    @Body() body: unknown,
  ) {
    return this.defense.requestReportPdf(
      request.userId,
      projectId,
      reportId,
      parseInput(requestComplianceReportPdfInputSchema, body),
    );
  }

  @Get(":id/defense/compliance-reports/:reportId/pdf/download-url")
  getReportPdfDownloadUrl(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Param("reportId") reportId: string,
  ) {
    return this.defense.getReportPdfDownloadUrl(request.userId, projectId, reportId);
  }
}

function parseManifest(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("DEFENSE_UPLOAD_MANIFEST_REQUIRED", "Добавьте manifest с ролью каждого файла");
  }
  const raw = (body as { manifest?: unknown }).manifest;
  if (typeof raw !== "string") return parseInput(defenseUploadManifestSchema, raw);
  try {
    return parseInput(defenseUploadManifestSchema, JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw badRequest("DEFENSE_UPLOAD_MANIFEST_INVALID", "Manifest загрузки содержит некорректный JSON");
    }
    throw error;
  }
}
