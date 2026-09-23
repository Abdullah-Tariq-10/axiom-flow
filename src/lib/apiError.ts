import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "INVALID_PAYLOAD"
  | "WORKFLOW_NOT_FOUND"
  | "MALFORMED_GRAPH"
  | "EXECUTION_TRIGGER_FAILED"
  | "EXECUTION_NOT_FOUND"
  | "EXECUTION_STILL_RUNNING"
  | "NOTHING_TO_RETRY";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details: unknown;
  };
}

const statusByCode: Record<ApiErrorCode, number> = {
  INVALID_PAYLOAD: 400,
  WORKFLOW_NOT_FOUND: 404,
  MALFORMED_GRAPH: 400,
  EXECUTION_TRIGGER_FAILED: 502,
  EXECUTION_NOT_FOUND: 404,
  EXECUTION_STILL_RUNNING: 409,
  NOTHING_TO_RETRY: 400,
};

/**
 * Builds the standardized `{ error: { code, message, details } }` envelope.
 * Only used by new endpoints (starting with POST /api/workflows/[id]/run) —
 * existing routes intentionally keep their plain `{ error: string }` shape
 * for now so `Toolbar.tsx`'s `json.error` string handling doesn't break.
 */
export function apiError(
  code: ApiErrorCode,
  message: string,
  details: unknown = null
) {
  return NextResponse.json<ApiErrorBody>(
    { error: { code, message, details } },
    { status: statusByCode[code] }
  );
}