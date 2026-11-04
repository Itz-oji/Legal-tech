export type MilestoneType = "entrega" | "venta" | "pago" | "traspaso";
export interface Evidence {
  id: string;
  name: string;
  size: number;
  date: string;
}
export interface Milestone {
  id: string;
  type: MilestoneType;
  date: string;
  amount?: number;
  note: string;
  evidence?: Evidence;
}
export interface Contract {
  id: string;
  vehicle: string;
  plate: string;
  dealer: string;
  price: number;
  commission: number;
  paymentDays: number;
  createdAt: string;
  text: string;
  original?: Evidence;
  milestones: Milestone[];
}
export const todayISO = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const offsetDate = (days: number) => {
  const date = new Date(todayISO() + "T12:00:00");
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
export const defaultText =
  "Precio mínimo de venta: $12.900.000. Comisión: 5% del precio de venta. El pago se realizará a 60 días hábiles desde la venta. La automotora puede rebajar el precio sin autorización del propietario. El traspaso queda a cargo de la automotora antes del pago. No se establecen penalidades.";
const milestone = (
  type: MilestoneType,
  days: number,
  note: string,
  amount?: number,
): Milestone => ({
  id: crypto.randomUUID(),
  type,
  date: offsetDate(days),
  note,
  amount,
});
export function seedContracts(): Contract[] {
  return [
    {
      id: "CT-001",
      vehicle: "Toyota Corolla",
      plate: "PL·VK·28",
      dealer: "Automotora Los Andes",
      price: 12900000,
      commission: 5,
      paymentDays: 15,
      createdAt: offsetDate(-12),
      text: defaultText,
      milestones: [
        milestone(
          "entrega",
          -12,
          "Vehículo y documentación entregados en sucursal.",
        ),
      ],
    },
    {
      id: "CT-002",
      vehicle: "Mazda CX-5",
      plate: "RT·HC·64",
      dealer: "Autoplan Santiago",
      price: 18500000,
      commission: 5,
      paymentDays: 15,
      createdAt: offsetDate(-25),
      text: "Precio mínimo: $18.500.000. Comisión: 5%. Pago a 15 días hábiles desde la venta, mediante transferencia bancaria. Toda rebaja requiere autorización escrita del propietario. El propietario firmará el traspaso después del pago completo. Sin penalidades adicionales.",
      milestones: [
        milestone("entrega", -25, "Entrega de vehículo y llaves."),
        milestone("venta", -17, "Venta confirmada por la automotora."),
      ],
    },
    {
      id: "CT-003",
      vehicle: "Nissan Versa",
      plate: "KS·BD·91",
      dealer: "Automotora Central",
      price: 9000000,
      commission: 5,
      paymentDays: 10,
      createdAt: offsetDate(-40),
      text: defaultText,
      milestones: [
        milestone("entrega", -40, "Entrega con inventario."),
        milestone("venta", -30, "Venta por $9.000.000."),
        milestone("pago", -20, "Primer abono recibido.", 3000000),
      ],
    },
    {
      id: "CT-004",
      vehicle: "Suzuki Swift",
      plate: "JK·PV·35",
      dealer: "Automotora Los Andes",
      price: 8900000,
      commission: 5,
      paymentDays: 10,
      createdAt: offsetDate(-50),
      text: "Precio mínimo: $8.900.000. Comisión: 5%. Pago a 10 días hábiles por transferencia. Rebaja con autorización escrita. El propietario firma el traspaso después del pago completo. No hay penalidades.",
      milestones: [
        milestone("entrega", -50, "Entrega del vehículo."),
        milestone("venta", -38, "Venta confirmada."),
        milestone("pago", -30, "Pago total recibido.", 8455000),
        milestone("traspaso", -29, "Traspaso registrado después del pago."),
      ],
    },
  ];
}
export function loadContracts(): Contract[] {
  try {
    const saved = localStorage.getItem("consigna.contracts.v1");
    if (saved) {
      const value = JSON.parse(saved);
      if (
        Array.isArray(value) &&
        value.every((c) => c.id && c.vehicle && Array.isArray(c.milestones))
      )
        return value;
    }
  } catch {
    /* A fresh demo remains usable if storage is unavailable. */
  }
  return seedContracts();
}
export function saveContracts(contracts: Contract[]): boolean {
  try {
    localStorage.setItem("consigna.contracts.v1", JSON.stringify(contracts));
    return true;
  } catch {
    return false;
  }
}
