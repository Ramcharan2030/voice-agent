"use client";

import {
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getWorkflowRunsApiV1SuperuserWorkflowRunsGet } from "@/client/sdk.gen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth";
import { costApi } from "@/lib/costApi";

interface WorkflowRun {
  id: number;
  workflow_id: number;
  workflow_name?: string | null;
  organization_id?: number | null;
  organization_name?: string | null;
  mode: string;
  is_completed: boolean;
  usage_info?: Record<string, unknown> | null;
  cost_info?: Record<string, unknown> | null;
  created_at: string;
}

interface WorkflowRunsResponse {
  workflow_runs: WorkflowRun[];
  total_count: number;
  page: number;
  limit: number;
  total_pages: number;
}

interface ActualCostComponent {
  service?: string;
  provider?: string;
  model?: string;
  label?: string;
  currency?: string;
  cost_usd?: number;
  cost_inr?: number;
  estimated?: boolean;
  priced?: boolean;
  usage?: Record<string, unknown>;
  pricing?: Record<string, unknown>;
  warning?: string;
  note?: string;
  source_url?: string;
}

interface ActualCostInfo {
  total_usd?: number;
  ai_total_usd?: number;
  telephony_total_usd?: number;
  total_inr?: number;
  ai_total_inr?: number;
  telephony_total_inr?: number;
  estimated?: boolean;
  components?: ActualCostComponent[];
  warnings?: string[];
  exchange_rates?: Record<string, unknown>[];
  pricing_sources?: Record<string, unknown>[];
}

const PAGE_SIZE = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 6 : 2,
  }).format(value);
}

function formatInr(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function formatInrPrimary(inr: number | null | undefined, usd?: number | null | undefined): string {
  const inrLabel = formatInr(inr);
  if (inrLabel !== "-") return inrLabel;
  return formatUsd(usd);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getActualCost(costInfo?: Record<string, unknown> | null): ActualCostInfo | null {
  if (!costInfo) return null;
  if (isRecord(costInfo.actual_cost)) {
    return normalizeActualCost(costInfo.actual_cost as ActualCostInfo);
  }
  const legacyTotal = numberValue(costInfo.total_cost_usd);
  return legacyTotal === null
    ? null
    : { total_usd: legacyTotal, ai_total_usd: legacyTotal, components: [] };
}

function normalizeActualCost(actualCost: ActualCostInfo): ActualCostInfo {
  const components = Array.isArray(actualCost.components) ? actualCost.components : [];
  if (components.length === 0) return actualCost;

  const sum = (
    predicate: (component: ActualCostComponent) => boolean,
    field: "cost_inr" | "cost_usd",
  ) => components.reduce((total, component) => {
    if (!predicate(component)) return total;
    return total + (numberValue(component[field]) ?? 0);
  }, 0);
  const isTelephony = (component: ActualCostComponent) => component.service === "telephony";
  const nonTelephony = (component: ActualCostComponent) => !isTelephony(component);

  return {
    ...actualCost,
    total_inr: numberValue(actualCost.total_inr) ?? sum(() => true, "cost_inr"),
    ai_total_inr: numberValue(actualCost.ai_total_inr) ?? sum(nonTelephony, "cost_inr"),
    telephony_total_inr: numberValue(actualCost.telephony_total_inr) ?? sum(isTelephony, "cost_inr"),
    total_usd: numberValue(actualCost.total_usd) ?? sum(() => true, "cost_usd"),
    ai_total_usd: numberValue(actualCost.ai_total_usd) ?? sum(nonTelephony, "cost_usd"),
    telephony_total_usd: numberValue(actualCost.telephony_total_usd) ?? sum(isTelephony, "cost_usd"),
  };
}

function getDurationSeconds(run: WorkflowRun): number | null {
  const costDuration = numberValue(run.cost_info?.call_duration_seconds);
  if (costDuration !== null) return costDuration;
  return numberValue(run.usage_info?.call_duration_seconds);
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "-";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(0)}s`;
}

function getProviderCostPerMinuteLabel(
  actualCost: ActualCostInfo | null,
  durationSeconds: number | null,
): string {
  if (!actualCost || durationSeconds === null || durationSeconds <= 0) return "-";
  const minutes = durationSeconds / 60;
  const totalInr = numberValue(actualCost.total_inr);
  const totalUsd = numberValue(actualCost.total_usd);
  return `${formatInrPrimary(
    totalInr === null ? null : totalInr / minutes,
    totalUsd === null ? null : totalUsd / minutes,
  )}/min`;
}

function componentName(component: ActualCostComponent): string {
  if (component.label) return component.label;
  return [component.service, component.provider, component.model]
    .filter(Boolean)
    .join(" / ") || "Cost component";
}

function componentUsageText(component: ActualCostComponent): string {
  if (!component.usage) return "";
  return Object.entries(component.usage)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(", ");
}

function componentCostLabel(component: ActualCostComponent): string {
  return formatInrPrimary(numberValue(component.cost_inr), numberValue(component.cost_usd));
}

function CostDetails({ actualCost }: { actualCost: ActualCostInfo | null }) {
  const components = actualCost?.components ?? [];
  if (!actualCost || components.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Info className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xl bg-popover text-popover-foreground border shadow-lg">
        <div className="space-y-2 text-xs">
          <div className="grid grid-cols-3 gap-3 border-b pb-2">
            <div>
              <p className="text-muted-foreground">AI APIs</p>
              <p className="font-semibold">
                {formatInrPrimary(numberValue(actualCost.ai_total_inr), numberValue(actualCost.ai_total_usd))}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Telephony CDR</p>
              <p className="font-semibold">
                {formatInrPrimary(
                  numberValue(actualCost.telephony_total_inr),
                  numberValue(actualCost.telephony_total_usd),
                )}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Total actual</p>
              <p className="font-semibold">
                {formatInrPrimary(numberValue(actualCost.total_inr), numberValue(actualCost.total_usd))}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {components.map((component, index) => (
              <div key={`${componentName(component)}-${index}`} className="border-b pb-2 last:border-b-0 last:pb-0">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium">{componentName(component)}</span>
                  <span>{componentCostLabel(component)}</span>
                </div>
                <p className="text-muted-foreground">
                  {[component.provider, component.model].filter(Boolean).join(" / ")}
                </p>
                {componentUsageText(component) && (
                  <p className="text-muted-foreground">{componentUsageText(component)}</p>
                )}
                {component.estimated && <p className="text-amber-600">Estimated</p>}
                {component.warning && <p className="text-destructive">{component.warning}</p>}
                {component.note && <p className="text-muted-foreground">{component.note}</p>}
                {component.source_url && (
                  <p className="text-muted-foreground">
                    Source: {component.source_url}
                  </p>
                )}
              </div>
            ))}
          </div>
          {actualCost.warnings && actualCost.warnings.length > 0 && (
            <div className="space-y-1 border-t pt-2 text-destructive">
              {actualCost.warnings.map((warning, index) => (
                <p key={`${warning}-${index}`}>{warning}</p>
              ))}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export default function SuperadminCostsPage() {
  const auth = useAuth();
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [recalculatingRunId, setRecalculatingRunId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const fetchCosts = useCallback(async (targetPage: number, refresh = false) => {
    if (!auth.isAuthenticated) return;
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError("");

    try {
      const response = await getWorkflowRunsApiV1SuperuserWorkflowRunsGet({
        query: {
          page: targetPage,
          limit: PAGE_SIZE,
          sort_by: "created_at",
          sort_order: "desc",
        },
      });

      if (response.error) {
        throw new Error("Failed to load cost analytics");
      }

      const data = response.data as WorkflowRunsResponse | undefined;
      if (!data) {
        throw new Error("No cost analytics returned");
      }

      setRuns(data.workflow_runs);
      setPage(data.page);
      setTotalPages(data.total_pages);
      setTotalCount(data.total_count);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cost analytics");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [auth.isAuthenticated]);

  const recalculateRunCost = useCallback(async (runId: number) => {
    setRecalculatingRunId(runId);
    setError("");
    try {
      await costApi.recalculateWorkflowRunCost(runId);
      await fetchCosts(page, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to recalculate run cost");
    } finally {
      setRecalculatingRunId(null);
    }
  }, [fetchCosts, page]);

  useEffect(() => {
    if (!auth.loading && auth.isAuthenticated) {
      void fetchCosts(page);
    }
  }, [auth.loading, auth.isAuthenticated, fetchCosts, page]);

  const totals = useMemo(() => {
    return runs.reduce(
      (acc, run) => {
        const actualCost = getActualCost(run.cost_info);
        acc.actualInr += numberValue(actualCost?.total_inr) ?? 0;
        acc.aiInr += numberValue(actualCost?.ai_total_inr) ?? 0;
        acc.telephonyInr += numberValue(actualCost?.telephony_total_inr) ?? 0;
        acc.actualUsd += numberValue(actualCost?.total_usd) ?? 0;
        acc.aiUsd += numberValue(actualCost?.ai_total_usd) ?? 0;
        acc.telephonyUsd += numberValue(actualCost?.telephony_total_usd) ?? 0;
        acc.durationSeconds += getDurationSeconds(run) ?? 0;

        return acc;
      },
      {
        actualInr: 0,
        aiInr: 0,
        telephonyInr: 0,
        actualUsd: 0,
        aiUsd: 0,
        telephonyUsd: 0,
        durationSeconds: 0,
      }
    );
  }, [runs]);

  if ((auth.loading || isLoading) && runs.length === 0) {
    return (
      <div className="container mx-auto flex min-h-[400px] items-center justify-center p-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading cost analytics...</span>
        </div>
      </div>
    );
  }

  return (
    <main className="container mx-auto max-w-full space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Cost Analytics</h1>
          <p className="text-muted-foreground">
            Provider spend and usage costs for every conversation.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void fetchCosts(page, true)}
            disabled={isRefreshing}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Link href="/superadmin/runs">
            <Button variant="outline">
              All Runs
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Actual spend</CardDescription>
            <CardTitle>{formatInr(totals.actualInr)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {formatUsd(totals.actualUsd)} loaded rows
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Actual / min</CardDescription>
            <CardTitle>
              {totals.durationSeconds > 0
                ? `${formatInr(totals.actualInr / (totals.durationSeconds / 60))}/min`
                : "-"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Provider spend per connected minute
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>AI API cost</CardDescription>
            <CardTitle>{formatInr(totals.aiInr)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {formatUsd(totals.aiUsd)} converted
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Telephony CDR</CardDescription>
            <CardTitle>{formatInr(totals.telephonyInr)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {formatUsd(totals.telephonyUsd)} non-INR CDR
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Pricing References</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-5">
          <a className="rounded-md border p-3 hover:bg-muted" href="https://docs.vobiz.ai/cdr/get-cdr" target="_blank" rel="noreferrer">
            <p className="font-medium">Vobiz CDR</p>
            <p className="text-muted-foreground">Authoritative per-call INR cost</p>
          </a>
          <a className="rounded-md border p-3 hover:bg-muted" href="https://docs.vobiz.ai/concepts/sip-vs-websockets" target="_blank" rel="noreferrer">
            <p className="font-medium">Vobiz WebSocket</p>
            <p className="text-muted-foreground">₹0.65/min + DID rent reference</p>
          </a>
          <a className="rounded-md border p-3 hover:bg-muted" href="https://www.plivo.com/voice/pricing/in/" target="_blank" rel="noreferrer">
            <p className="font-medium">Mobile PAYG Benchmark</p>
            <p className="text-muted-foreground">Plivo India local/mobile pricing</p>
          </a>
          <a className="rounded-md border p-3 hover:bg-muted" href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer">
            <p className="font-medium">Gemini API</p>
            <p className="text-muted-foreground">Live audio and token rates</p>
          </a>
          <a className="rounded-md border p-3 hover:bg-muted" href="https://groq.com/pricing" target="_blank" rel="noreferrer">
            <p className="font-medium">Groq API</p>
            <p className="text-muted-foreground">LLM token rates, converted to INR</p>
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Conversation Cost Details</CardTitle>
              <CardDescription>
                Showing {runs.length} of {totalCount} conversations
              </CardDescription>
            </div>
            <Badge variant="outline">Superadmin only</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">No conversations found.</div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted">
                    <TableHead>Run</TableHead>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>AI APIs</TableHead>
                    <TableHead>Telephony</TableHead>
                    <TableHead>Total Actual</TableHead>
                    <TableHead>Actual / Min</TableHead>
                    <TableHead>Breakdown</TableHead>
                    <TableHead>Reprice</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => {
                    const actualCost = getActualCost(run.cost_info);
                    const durationSeconds = getDurationSeconds(run);
                    return (
                      <TableRow key={run.id}>
                        <TableCell className="font-mono text-sm">
                          <Link
                            className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                            href={`/superadmin/runs?filters=${encodeURIComponent(JSON.stringify([{ id: "id", value: { value: run.id } }]))}`}
                          >
                            #{run.id}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[220px] truncate font-medium">
                            {run.workflow_name || `Workflow #${run.workflow_id}`}
                          </div>
                          <div className="text-xs text-muted-foreground">#{run.workflow_id}</div>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[180px] truncate">
                            {run.organization_name || "-"}
                          </div>
                          {run.organization_id && (
                            <div className="text-xs text-muted-foreground">#{run.organization_id}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={run.is_completed ? "success" : "secondary"}>
                            {run.mode}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDuration(getDurationSeconds(run))}</TableCell>
                        <TableCell>
                          {formatInrPrimary(numberValue(actualCost?.ai_total_inr), numberValue(actualCost?.ai_total_usd))}
                        </TableCell>
                        <TableCell>
                          {formatInrPrimary(
                            numberValue(actualCost?.telephony_total_inr),
                            numberValue(actualCost?.telephony_total_usd),
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {formatInrPrimary(numberValue(actualCost?.total_inr), numberValue(actualCost?.total_usd))}
                        </TableCell>
                        <TableCell>{getProviderCostPerMinuteLabel(actualCost, durationSeconds)}</TableCell>
                        <TableCell>
                          <CostDetails actualCost={actualCost} />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={recalculatingRunId === run.id}
                            onClick={() => void recalculateRunCost(run.id)}
                            title="Reprice"
                          >
                            <RefreshCw className={`h-4 w-4 ${recalculatingRunId === run.id ? "animate-spin" : ""}`} />
                          </Button>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDate(run.created_at)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1 || isLoading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === totalPages || isLoading}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
