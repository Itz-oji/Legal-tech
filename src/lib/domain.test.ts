import test from "node:test";
import assert from "node:assert/strict";
import {
  addBusinessDays,
  addCalendarDays,
  assessContractText,
  calculateBalance,
  getConsignmentStatus,
  isChileBusinessDay,
} from "./domain.ts";
import { defaultText } from "./store.ts";

test("commission and partial payment match the requested example", () => {
  assert.deepEqual(calculateBalance(9_000_000, 5, [3_000_000]), {
    commission: 450_000,
    netAmount: 8_550_000,
    totalPaid: 3_000_000,
    balance: 5_550_000,
  });
  assert.equal(calculateBalance(1_234_567, 2.75, []).commission, 33_951);
  assert.throws(() => calculateBalance(9_000_000, 105, []));
});

test("business days exclude weekends and national holidays, and start after sale date", () => {
  assert.equal(addBusinessDays("2026-09-17", 1), "2026-09-21");
  assert.equal(addBusinessDays("2026-12-24", 1), "2026-12-28");
  assert.equal(addBusinessDays("2027-06-25", 1), "2027-06-29");
  assert.equal(addBusinessDays("2027-09-16", 1), "2027-09-20");
  assert.equal(addCalendarDays("2026-09-17", 1), "2026-09-18");
  assert.equal(isChileBusinessDay("2026-11-03"), true);
  assert.throws(() => addBusinessDays("2026-02-30", 1));
  assert.throws(() => addBusinessDays("2028-01-02", 1));
});

const base = {
  saleDate: "2026-11-02",
  paymentDays: 1,
  salePrice: 9_000_000,
  commissionPercent: 5,
};

test("payment received on deadline is timely; unpaid balance becomes overdue only next day", () => {
  const onTime = getConsignmentStatus({
    ...base,
    today: "2026-11-03",
    payments: [{ amount: 8_550_000, date: "2026-11-03" }],
  });
  assert.equal(onTime.paid, true);
  assert.equal(onTime.claimEligible, false);
  const dueToday = getConsignmentStatus({
    ...base,
    today: "2026-11-03",
    payments: [],
  });
  assert.equal(dueToday.overdue, false);
  const late = getConsignmentStatus({
    ...base,
    today: "2026-11-04",
    payments: [{ amount: 3_000_000, date: "2026-11-03" }],
  });
  assert.equal(late.overdue, true);
  assert.equal(late.claimEligible, true);
  assert.equal(late.balance, 5_550_000);
});

test("partial payment before deadline warns without creating a premature claim", () => {
  const result = getConsignmentStatus({
    ...base,
    paymentDays: 15,
    today: "2026-11-03",
    payments: [{ amount: 3_000_000, date: "2026-11-03" }],
  });
  assert.equal(result.status, "partial");
  assert.equal(result.claimEligible, false);
});

test("later payment does not erase transfer before full payment", () => {
  const result = getConsignmentStatus({
    ...base,
    today: "2026-11-04",
    transferDate: "2026-11-02",
    payments: [{ amount: 8_550_000, date: "2026-11-03" }],
  });
  assert.equal(result.unsafeTransfer, true);
  assert.equal(result.claimEligible, false); // Full payment means no outstanding monetary claim.
  assert.equal(result.warnings.length, 1);
});

test("demo review explicitly identifies omissions and includes threshold equality", () => {
  const omitted = assessContractText("Un vehículo entregado en consignación.");
  assert.equal(omitted.length, 7);
  assert.ok(omitted.every((term) => term.omitted && term.level === "alto"));
  assert.equal(
    assessContractText("Pago a 15 días hábiles.").find(
      (term) => term.id === "payment-term",
    )?.level,
    "medio",
  );
  assert.equal(
    assessContractText(
      "Pago a 60 días hábiles. La automotora rebaja sin consultar. El traspaso lo realiza ella.",
    )
      .filter((term) =>
        ["payment-term", "price-reduction", "transfer"].includes(term.id),
      )
      .every((term) => term.level === "alto"),
    true,
  );
});

test("the actual demo contract flags its 60-day term, unauthorized reduction and early transfer", () => {
  const results = assessContractText(defaultText);
  for (const id of ["payment-term", "price-reduction", "transfer"]) {
    assert.equal(results.find((term) => term.id === id)?.level, "alto", id);
    assert.equal(results.find((term) => term.id === id)?.omitted, false, id);
  }
});

test("mentioning full payment does not make a transfer BEFORE that payment safe", () => {
  const before = assessContractText(
    "La automotora realizará el traspaso antes del pago completo.",
  );
  const after = assessContractText(
    "El propietario realizará el traspaso después del pago completo.",
  );
  const contradictory = assessContractText(
    "El traspaso será después del pago completo, aunque podrá realizarse antes del pago.",
  );
  assert.equal(before.find((term) => term.id === "transfer")?.level, "alto");
  assert.equal(after.find((term) => term.id === "transfer")?.level, "bajo");
  assert.equal(
    contradictory.find((term) => term.id === "transfer")?.level,
    "alto",
  );
});

test("unrelated unilateral clauses do not affect consent-based reductions", () => {
  const results = assessContractText(
    "La comisión podrá variar unilateralmente. Toda rebaja requiere autorización escrita del propietario. El traspaso ocurrirá después del pago completo.",
  );
  assert.equal(results.find((term) => term.id === "commission")?.level, "alto");
  assert.equal(
    results.find((term) => term.id === "price-reduction")?.level,
    "bajo",
  );
  assert.equal(results.find((term) => term.id === "transfer")?.level, "bajo");
});

test("a prohibition of an unsafe act is distinguished from permission to do it", () => {
  const forbidden = assessContractText(
    "No se podrá rebajar el precio sin autorización del propietario. No se podrá realizar el traspaso antes del pago completo.",
  );
  const allowed = assessContractText(
    "Se podrá rebajar el precio sin autorización del propietario. Se podrá realizar el traspaso antes del pago completo.",
  );
  assert.equal(
    forbidden.find((term) => term.id === "price-reduction")?.level,
    "medio",
  );
  assert.equal(forbidden.find((term) => term.id === "transfer")?.level, "bajo");
  assert.equal(
    allowed.find((term) => term.id === "price-reduction")?.level,
    "alto",
  );
  assert.equal(allowed.find((term) => term.id === "transfer")?.level, "alto");
});
