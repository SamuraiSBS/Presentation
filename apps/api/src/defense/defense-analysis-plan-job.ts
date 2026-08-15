export type DefenseAnalysisPlanScope = "analysis" | "plan";

export type DefenseAnalysisPlanJobSpec = {
  scope: DefenseAnalysisPlanScope;
  requestKey: string;
  queueJobName: "analyze-defense-brief";
  queueJobIdPrefix: "defense-analysis" | "defense-plan";
  progressStage: "extracting_sources" | "building_defense_plan";
  progressLabel: string;
  queueFailureMessage: string;
};

/**
 * Pure analysis/plan orchestration identity. The service owns persistence and
 * queue effects; this boundary keeps their retry identity in one place.
 */
export function defenseAnalysisPlanJobSpec(input: {
  scope: DefenseAnalysisPlanScope;
  workspaceId: string;
  analysisRevision: number;
  planRevision: number;
}): DefenseAnalysisPlanJobSpec {
  const plan = input.scope === "plan";
  return {
    scope: input.scope,
    requestKey: defenseRequestKey(input.scope, input.workspaceId, input.analysisRevision, plan ? String(input.planRevision) : undefined),
    queueJobName: "analyze-defense-brief",
    queueJobIdPrefix: plan ? "defense-plan" : "defense-analysis",
    progressStage: plan ? "building_defense_plan" : "extracting_sources",
    progressLabel: plan ? "Составляем план защиты" : "Анализируем материалы защиты",
    queueFailureMessage: plan ? "Не удалось поставить построение плана в очередь" : "Не удалось поставить анализ в очередь",
  };
}

function defenseRequestKey(scope: string, workspaceId: string, revision: number, suffix?: string) {
  return ["defense", scope, workspaceId, revision, suffix || "auto"].join(":").slice(0, 200);
}
