import { seedContracts, type Contract, type MilestoneType } from "./store";

/**
 * Cliente HTTP del backend Flask. Modo demostración: no hay pantalla de login;
 * al iniciar se pide un token a POST /api/auth/demo (requiere DEMO_MODE=1 en el
 * backend) y se renueva solo cuando expira. Los plazos y montos los calcula el
 * servidor; la interfaz solo los muestra.
 */
const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";
const TOKEN_KEY = "consigna.token";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Estado calculado por el backend (plazos, montos y secuencia segura). */
export type ServerState = {
  comision: number;
  neto: number;
  total_pagado: number;
  saldo: number;
  vencimiento: string;
  pagado: boolean;
  vencido: boolean;
  parcial: boolean;
  traspaso_inseguro: boolean;
  estado: string;
  reclamable: boolean;
  avisos: string[];
  calendario: string;
};

type ServerEvidence = {
  id: string;
  filename: string;
  size: number;
  created_at: string;
};
type ServerMilestone = {
  id: string;
  tipo: MilestoneType;
  fecha: string;
  monto: number | null;
  nota: string;
  evidencia_id: string | null;
};
type ServerContract = {
  id: string;
  vehiculo: string;
  patente: string;
  automotora: string;
  precio: number;
  comision_pct: number;
  dias_pago: number;
  texto: string;
  creado: string;
  hitos: ServerMilestone[];
  evidencias: ServerEvidence[];
  original: ServerEvidence | null;
  estado: ServerState | null;
};

let token: string | null = null;
try {
  token = localStorage.getItem(TOKEN_KEY);
} catch {
  /* sin almacenamiento: se pide un token nuevo en cada visita */
}

async function readError(response: Response): Promise<ApiError> {
  const body = await response.json().catch(() => ({}));
  const message =
    typeof body.error === "string" && body.error
      ? body.error
      : "El servidor no pudo completar la solicitud.";
  return new ApiError(message, response.status, body.codigo);
}

async function startDemoSession(): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${API}/auth/demo`, { method: "POST" });
  } catch {
    throw new ApiError(
      "No se pudo conectar con el servidor. Verifica que el backend esté en ejecución.",
      0,
    );
  }
  if (response.status === 404)
    throw new ApiError(
      "El modo demostración está deshabilitado en el servidor (DEMO_MODE=1).",
      404,
    );
  if (!response.ok) throw await readError(response);
  const data = await response.json();
  token = data.token as string;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignorar */
  }
  return token;
}

async function request(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<Response> {
  const session = token ?? (await startDemoSession());
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${session}` },
    });
  } catch {
    throw new ApiError(
      "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo nuevamente.",
      0,
    );
  }
  if (response.status === 401 && retry) {
    token = null; // token vencido o secreto cambiado: se renueva una vez
    return request(path, init, false);
  }
  if (!response.ok) throw await readError(response);
  return response;
}

const json = async <T>(path: string, init?: RequestInit): Promise<T> =>
  (await request(path, init)).json() as Promise<T>;

const santiagoDate = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

function toContract(k: ServerContract): Contract {
  const byId = new Map(k.evidencias.map((e) => [e.id, e]));
  const evidence = (e: ServerEvidence) => ({
    id: e.id,
    name: e.filename,
    size: e.size,
    date: santiagoDate(e.created_at),
  });
  return {
    id: k.id,
    vehicle: k.vehiculo,
    plate: k.patente,
    dealer: k.automotora,
    price: k.precio,
    commission: k.comision_pct,
    paymentDays: k.dias_pago,
    createdAt: santiagoDate(k.creado),
    text: k.texto,
    original: k.original ? evidence(k.original) : undefined,
    milestones: k.hitos.map((h) => {
      const file = h.evidencia_id ? byId.get(h.evidencia_id) : undefined;
      return {
        id: h.id,
        type: h.tipo,
        date: h.fecha,
        amount: h.monto ?? undefined,
        note: h.nota,
        evidence: file ? evidence(file) : undefined,
      };
    }),
    server: k.estado ?? undefined,
  };
}

export async function getContract(id: string): Promise<Contract> {
  const d = await json<{
    contrato: ServerContract;
    hitos: ServerMilestone[];
    estado: ServerState | null;
    evidencias: ServerEvidence[];
    original: ServerEvidence | null;
  }>(`/contracts/${id}`);
  return toContract({
    ...d.contrato,
    hitos: d.hitos,
    estado: d.estado,
    evidencias: d.evidencias,
    original: d.original,
  });
}

export async function listContracts(): Promise<Contract[]> {
  const d = await json<{ contratos: ServerContract[] }>(
    "/contracts?completo=1",
  );
  return d.contratos.map(toContract);
}

export type NewContractInput = {
  vehicle: string;
  plate: string;
  dealer: string;
  price: number;
  commission: number;
  paymentDays: number;
  text: string;
};

export async function createContract(
  input: NewContractInput,
  original?: File | null,
): Promise<Contract> {
  const created = await json<{ id: string }>("/contracts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vehiculo: input.vehicle,
      patente: input.plate,
      automotora: input.dealer,
      precio: input.price,
      comision_pct: input.commission,
      dias_pago: input.paymentDays,
      tipo_dias: "habiles",
      texto: input.text,
    }),
  });
  if (original) {
    const form = new FormData();
    form.append("archivo", original);
    await request(`/contracts/${created.id}/original`, {
      method: "PUT",
      body: form,
    });
  }
  return getContract(created.id);
}

export type NewMilestoneInput = {
  type: MilestoneType;
  date: string;
  amount?: number;
  note: string;
  file?: File | null;
  /** Deja constancia de un traspaso ocurrido sin pago completo. */
  confirm?: boolean;
};

/** Registra el hito y devuelve el contrato actualizado con el estado del servidor. */
export async function addMilestone(
  contractId: string,
  input: NewMilestoneInput,
): Promise<Contract> {
  const form = new FormData();
  form.append("tipo", input.type);
  form.append("fecha", input.date);
  form.append("nota", input.note);
  if (input.amount !== undefined) form.append("monto", String(input.amount));
  if (input.confirm) form.append("confirmar", "true");
  if (input.file) form.append("archivo", input.file);
  await request(`/contracts/${contractId}/milestones`, {
    method: "POST",
    body: form,
  });
  return getContract(contractId);
}

export type Audience = "automotora" | "sernac";

export async function createClaim(contractId: string, audience: Audience) {
  return json<{ id: string; borrador: string; pasos: string[]; aviso: string }>(
    `/contracts/${contractId}/claims`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audiencia: audience }),
    },
  );
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadEvidence(id: string, name: string) {
  const response = await request(`/evidences/${id}`);
  saveBlob(await response.blob(), name);
}

export async function downloadReportPdf(
  contractId: string,
  audience: Audience,
) {
  const response = await request(
    `/contracts/${contractId}/report.pdf?audiencia=${audience}`,
  );
  saveBlob(await response.blob(), `consigna-informe-${audience}.pdf`);
}

let workspaceLoad: Promise<Contract[]> | null = null;
/** Carga los contratos; si la cuenta demo está vacía, la llena con casos de ejemplo.
 * Las llamadas simultáneas (p. ej. el doble efecto de React en desarrollo) comparten
 * una sola carga para no sembrar los ejemplos dos veces. */
export function loadWorkspace(): Promise<Contract[]> {
  workspaceLoad ??= loadOrSeed().finally(() => {
    workspaceLoad = null;
  });
  return workspaceLoad;
}

async function loadOrSeed(): Promise<Contract[]> {
  const existing = await listContracts();
  if (existing.length) return existing;
  for (const demo of [...seedContracts()].reverse()) {  // el más antiguo primero: la lista queda con CT-001 arriba
    const created = await json<{ id: string }>("/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehiculo: demo.vehicle,
        patente: demo.plate,
        automotora: demo.dealer,
        precio: demo.price,
        comision_pct: demo.commission,
        dias_pago: demo.paymentDays,
        tipo_dias: "habiles",
        texto: demo.text,
      }),
    });
    for (const m of demo.milestones) {
      const form = new FormData();
      form.append("tipo", m.type);
      form.append("fecha", m.date);
      form.append("nota", m.note);
      if (m.amount !== undefined) form.append("monto", String(m.amount));
      await request(`/contracts/${created.id}/milestones`, {
        method: "POST",
        body: form,
      });
    }
  }
  return listContracts();
}
