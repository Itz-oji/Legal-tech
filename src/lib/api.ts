import { assessContractText, type RiskAssessment } from "./domain";

export type AnalysisResult = {
  findings: RiskAssessment[];
  /** "server" = criteria from the backend; "local" = static demo fallback. */
  origin: "server" | "local";
  criteriaVersion?: number;
  criteriaPublishedAt?: string;
  sourcesLastChecked?: string | null;
  reviewPending: boolean;
};

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";

/** Business errors (422/400) are shown to the person; network or server
 * failures fall back to the local demonstration rules, labelled as such. */
export async function analyzeContract(text: string): Promise<AnalysisResult> {
  let response: Response;
  try {
    response = await fetch(`${API}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return localResult(text);
  }
  if (response.status === 400 || response.status === 422) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "No se pudo evaluar el contrato.");
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("application/json"))
    return localResult(text);
  const data = await response.json();
  return {
    findings: data.findings,
    origin: "server",
    criteriaVersion: data.criteria_version,
    criteriaPublishedAt: data.criteria_published_at,
    sourcesLastChecked: data.sources_last_checked,
    reviewPending: Boolean(data.review_pending),
  };
}

function localResult(text: string): AnalysisResult {
  return {
    findings: assessContractText(text),
    origin: "local",
    reviewPending: false,
  };
}
