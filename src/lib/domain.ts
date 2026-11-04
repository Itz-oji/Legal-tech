/**
 * Frontend demonstration rules. Monetary/date operations never use an LLM.
 * The API must provide the authoritative Chile holiday calendar and validated
 * legal criteria before production; these rules are not legal advice.
 */
export const HOLIDAY_CALENDAR_NOTICE =
  "Calendario nacional de referencia 2026–2027. No incluye feriados regionales ni extraordinarios; validar con holidays de Chile en el backend.";

export type RiskLevel = "bajo" | "medio" | "alto";
export type RiskAssessment = {
  id: string;
  title: string;
  level: RiskLevel;
  explanation: string;
  alternative: string;
  omitted: boolean;
};

const clp = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});
export const formatCLP = (amount: number) => clp.format(amount);

/** Strict ISO parsing with UTC arithmetic avoids browser timezone/DST drift. */
function parseDate(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso))
    throw new Error("La fecha debe usar el formato AAAA-MM-DD.");
  const date = new Date(`${iso}T12:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== iso
  ) {
    throw new Error("La fecha no es válida.");
  }
  return date;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseDate(iso));
}

const FIXED_HOLIDAYS = new Set([
  "01-01",
  "05-01",
  "05-21",
  "07-16",
  "08-15",
  "09-18",
  "09-19",
  "10-31",
  "11-01",
  "12-08",
  "12-25",
]);
const REFERENCE_HOLIDAYS = new Set([
  "2026-04-03",
  "2026-04-04",
  "2026-06-21",
  "2026-06-29",
  "2026-10-12",
  "2027-03-26",
  "2027-03-27",
  "2027-06-21",
  "2027-06-28",
  "2027-09-17",
  "2027-10-11",
]);

export function isChileBusinessDay(iso: string): boolean {
  const date = parseDate(iso);
  if (date.getUTCFullYear() < 2026 || date.getUTCFullYear() > 2027) {
    throw new Error("El calendario de demostración solo cubre 2026 y 2027.");
  }
  return (
    date.getUTCDay() !== 0 &&
    date.getUTCDay() !== 6 &&
    !FIXED_HOLIDAYS.has(iso.slice(5)) &&
    !REFERENCE_HOLIDAYS.has(iso)
  );
}

/** Day one is the first business day AFTER the reported sale date. */
export function addBusinessDays(startISO: string, days: number): string {
  const date = parseDate(startISO);
  if (!Number.isInteger(days) || days < 0 || days > 365) {
    throw new Error("El plazo debe ser un entero entre 0 y 365 días.");
  }
  isChileBusinessDay(startISO); // Check supported calendar even for a zero-day term.
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isChileBusinessDay(date.toISOString().slice(0, 10))) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(startISO: string, days: number): string {
  const date = parseDate(startISO);
  if (!Number.isInteger(days) || days < 0 || days > 365) {
    throw new Error("El plazo debe ser un entero entre 0 y 365 días.");
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calculateBalance(
  salePrice: number,
  commissionPercent: number,
  payments: number[],
) {
  if (
    !Number.isSafeInteger(salePrice) ||
    salePrice < 0 ||
    !Number.isFinite(commissionPercent) ||
    commissionPercent < 0 ||
    commissionPercent > 100 ||
    payments.some((payment) => !Number.isSafeInteger(payment) || payment < 0)
  ) {
    throw new Error(
      "Ingresa montos enteros no negativos y una comisión entre 0 y 100%.",
    );
  }
  // Percent precision is two decimal places; round the commission to whole CLP.
  const basisPoints = Math.round(commissionPercent * 100);
  const commission = Math.round((salePrice * basisPoints) / 10_000);
  const netAmount = salePrice - commission;
  const totalPaid = payments.reduce((sum, amount) => sum + amount, 0);
  if (!Number.isSafeInteger(totalPaid))
    throw new Error("El total recibido supera el rango permitido.");
  return {
    commission,
    netAmount,
    totalPaid,
    balance: Math.max(0, netAmount - totalPaid),
  };
}

export type ConsignmentStatusInput = {
  saleDate: string;
  paymentDays: number;
  dayType?: "business" | "calendar";
  salePrice: number;
  commissionPercent: number;
  payments: Array<{ amount: number; date: string }>;
  transferDate?: string;
  today?: string;
};

/** A partial payment alone does not create a claim before the agreed deadline. */
export function getConsignmentStatus(input: ConsignmentStatusInput) {
  const deadline =
    input.dayType === "calendar"
      ? addCalendarDays(input.saleDate, input.paymentDays)
      : addBusinessDays(input.saleDate, input.paymentDays);
  const today =
    input.today ??
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(
      new Date(),
    );
  parseDate(today);
  input.payments.forEach((payment) => parseDate(payment.date));
  const finances = calculateBalance(
    input.salePrice,
    input.commissionPercent,
    input.payments.map((p) => p.amount),
  );
  const paid = finances.balance === 0;
  const overdue = !paid && today > deadline;
  const partial = finances.totalPaid > 0 && !paid;
  let unsafeTransfer = false;
  if (input.transferDate) {
    parseDate(input.transferDate);
    // A later payment must not erase the historical out-of-sequence transfer.
    const paidAtTransfer = input.payments
      .filter((p) => p.date <= input.transferDate!)
      .reduce((sum, p) => sum + p.amount, 0);
    unsafeTransfer = paidAtTransfer < finances.netAmount;
  }
  const warnings: string[] = [];
  if (unsafeTransfer)
    warnings.push(
      "Se registró un traspaso antes de confirmar el pago completo.",
    );
  if (overdue)
    warnings.push("El plazo de pago venció y existe un saldo pendiente.");
  else if (partial)
    warnings.push(
      "El pago es parcial. Confirma el saldo antes de autorizar el traspaso.",
    );
  const status = unsafeTransfer
    ? "unsafe_transfer"
    : paid
      ? "paid"
      : overdue
        ? "overdue"
        : partial
          ? "partial"
          : "pending";
  return {
    ...finances,
    deadline,
    paid,
    overdue,
    partial,
    unsafeTransfer,
    status,
    claimEligible: !paid && (overdue || unsafeTransfer),
    warnings,
  };
}

/**
 * Transparent keyword demonstration, not AI extraction or legal validation.
 * Omitted clauses are explicit. The backend should replace this function with
 * versioned criteria and a validated extraction/model response.
 */
export function assessContractText(text: string): RiskAssessment[] {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const has = (pattern: RegExp) => pattern.test(normalized);
  // Keep each rule within the clause it evaluates. A unilateral commission must
  // not turn a separate, consent-based price-reduction clause into a high risk.
  const clauses = normalized
    .split(/[.;\n]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const reductionClauses = clauses.filter((clause) =>
    /rebaj|reducir el precio|descuento/.test(clause),
  );
  const requiresWrittenConsent = reductionClauses.some((clause) =>
    /(?:requiere|requerira|necesita|con|previa).{0,40}autorizacion.{0,30}(?:escrita|por escrito)/.test(
      clause,
    ),
  );
  const unsafeReduction = reductionClauses.some((clause) => {
    const forbidsUnauthorizedReduction =
      /\bno\s+(?:se\s+)?(?:podra|puede|debera|debe).{0,45}(?:rebaj|reducir|descuento).{0,50}sin\s+(?:consult|autoriz)/.test(
        clause,
      );
    return (
      /sin\s+(?:consult|autoriz)|libremente|unilateral/.test(clause) &&
      !forbidsUnauthorizedReduction
    );
  });
  const transferClauses = clauses.filter((clause) =>
    /traspas|transferencia de dominio/.test(clause),
  );
  const forbidsEarlyTransfer = (clause: string) =>
    /\bno\s+(?:se\s+)?(?:podra|puede|debera|debe).{0,45}(?:traspas|transfer).{0,45}(?:antes|sin).{0,35}pago\s+(?:completo|integro|confirmado)/.test(
      clause,
    );
  const unsafeTransfer = transferClauses.some(
    (clause) =>
      /(?:antes|previo|sin).{0,35}(?:pago|abono)/.test(clause) &&
      !forbidsEarlyTransfer(clause),
  );
  const requiresCompletePayment = transferClauses.some(
    (clause) =>
      /(?:despues|luego|una vez|condicionad[oa]).{0,70}(?:pago|abono)\s+(?:completo|integro|confirmado)/.test(
        clause,
      ) || forbidsEarlyTransfer(clause),
  );
  const rows: Array<
    Omit<RiskAssessment, "omitted" | "level"> & {
      present: boolean;
      risk: RiskLevel;
    }
  > = [
    {
      id: "minimum-price",
      title: "Precio mínimo de venta",
      present: has(/precio minimo|valor minimo|minimo de venta/),
      risk: "bajo",
      explanation:
        "Se menciona un precio mínimo. Verifica que el monto esté expresado en pesos y sea inequívoco.",
      alternative:
        "El vehículo no podrá venderse por un precio inferior al mínimo acordado por escrito por el propietario.",
    },
    {
      id: "commission",
      title: "Comisión de la automotora",
      present: has(/comision/),
      risk: clauses.some((clause) =>
        /comision.{0,80}(adicional|variable|unilateral)/.test(clause),
      )
        ? "alto"
        : "medio",
      explanation:
        "Confirma el porcentaje o monto de la comisión, su base de cálculo y si incluye impuestos y gastos.",
      alternative:
        "La comisión total será de [porcentaje]% del precio de venta, con todos sus cargos expresamente detallados.",
    },
    {
      id: "payment-term",
      title: "Plazo de pago",
      present: has(/\d+\s*dias|plazo de pago/),
      risk: (() => {
        const match = normalized.match(/(\d+)\s*dias/);
        return match && Number(match[1]) > 15 ? "alto" : "medio";
      })(),
      explanation:
        "La referencia de demostración es 15 días. Un plazo mayor aumenta la exposición; no es un límite legal.",
      alternative:
        "El precio neto se pagará dentro de [plazo acordado] días desde la venta, indicando si son hábiles o corridos.",
    },
    {
      id: "payment-method",
      title: "Forma de pago",
      present: has(
        /transferencia bancaria|cuenta bancaria|forma de pago|deposito bancario/,
      ),
      risk: "bajo",
      explanation:
        "La forma de pago debe permitir verificar el abono efectivo al propietario y conservar su comprobante.",
      alternative:
        "El pago se realizará mediante transferencia a la cuenta designada por el propietario y se acreditará con el abono efectivo.",
    },
    {
      id: "price-reduction",
      title: "Autorización para rebajar",
      present: has(/rebaj|reducir el precio|descuento/),
      risk: unsafeReduction
        ? "alto"
        : requiresWrittenConsent
          ? "bajo"
          : "medio",
      explanation: unsafeReduction
        ? "Se detectó una referencia a decisiones sin autorización. Revisa si permite rebajas sin tu consentimiento."
        : "Revisa que cada rebaja requiera tu autorización previa y escrita.",
      alternative:
        "Toda rebaja del precio requerirá autorización previa y escrita del propietario, con indicación del nuevo monto.",
    },
    {
      id: "transfer",
      title: "Condiciones del traspaso",
      present: transferClauses.length > 0,
      risk: !unsafeTransfer && requiresCompletePayment ? "bajo" : "alto",
      explanation:
        "Verifica quién firma el traspaso y que se condicione a la confirmación del pago íntegro al propietario.",
      alternative:
        "El propietario autorizará y firmará el traspaso únicamente después de verificar el pago completo del precio neto.",
    },
    {
      id: "penalties",
      title: "Penalidades y responsabilidades",
      present: has(/penalidad|penalidades|multa|incumplimiento/),
      risk: "medio",
      explanation:
        "Revisa los supuestos de incumplimiento, los cargos y las responsabilidades de ambas partes.",
      alternative:
        "Las consecuencias del incumplimiento, sus montos y la responsabilidad de cada parte se acordarán expresamente por escrito.",
    },
  ];
  return rows.map(({ present, risk, ...row }) => ({
    ...row,
    level: present ? risk : "alto",
    omitted: !present,
    explanation: present
      ? row.explanation
      : "No se identificó este término en el texto. Su ausencia debe revisarse expresamente antes de firmar.",
  }));
}
