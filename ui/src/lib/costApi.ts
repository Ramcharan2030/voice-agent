import { client } from "@/client/client.gen";

type ApiResult<T> = {
  data?: T;
  error?: unknown;
};

export interface RecalculateWorkflowRunCostResponse {
  status: string;
  workflow_run_id: number;
}

function detailToMessage(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }
        return null;
      })
      .filter(Boolean)
      .join(", ");
  }
  return null;
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const detail = "detail" in error ? detailToMessage((error as { detail: unknown }).detail) : null;
    if (detail) return detail;
    if ("message" in error && typeof (error as { message: unknown }).message === "string") {
      return (error as { message: string }).message;
    }
  }
  return fallback;
}

async function unwrap<T>(request: Promise<ApiResult<T>>, fallback: string): Promise<T> {
  const response = await request;
  if (response.error) {
    throw new Error(errorMessage(response.error, fallback));
  }
  if (response.data === undefined || response.data === null) {
    throw new Error(fallback);
  }
  return response.data;
}

export const costApi = {
  recalculateWorkflowRunCost(workflowRunId: number): Promise<RecalculateWorkflowRunCostResponse> {
    return unwrap(
      client.post<{ 200: RecalculateWorkflowRunCostResponse }>({
        url: `/api/v1/superuser/workflow-runs/${workflowRunId}/recalculate-cost`,
      }),
      "Failed to recalculate run cost",
    );
  },
};
