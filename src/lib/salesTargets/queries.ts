import type { PlanningRequest } from './contracts'
/** Scope all cached projections by backend and verified actor; never by month alone. */
export const targetQueryKeys = {
  baseline: (scope: string, actorId: string, request: PlanningRequest) => ['sales-targets-v1', scope, actorId, 'baseline', request.managerId, request.month] as const,
  plan: (scope: string, actorId: string, planId: string) => ['sales-targets-v1', scope, actorId, 'plan', planId] as const,
}
