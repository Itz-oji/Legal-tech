import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { jsPDF } from "jspdf";

interface SavedContract {
  id: string;
  vehicle: string;
  original?: { id: string };
  milestones: { type: string; amount?: number; evidence?: { id: string } }[];
}

const navigation = (page: Page, label: string) =>
  page
    .getByRole("navigation")
    .getByRole("button", { name: label, exact: true });
const savedContracts = (page: Page): Promise<SavedContract[]> =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("consigna.contracts.v1") || "[]"),
  );
const contractText =
  "Precio mínimo $9.000.000. Comisión 5%. Pago a 15 días hábiles mediante transferencia bancaria. Rebaja con autorización escrita. Traspaso después del pago completo. No hay penalidades.";

async function createContract(page: Page, vehicle = "QA Auto 2026") {
  await page
    .getByRole("button", { name: "Nuevo contrato", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Marca y modelo").fill(vehicle);
  await dialog.getByLabel("Patente", { exact: true }).fill("QA-AB-12");
  await dialog.getByLabel("Automotora", { exact: true }).fill("Automotora QA");
  await dialog.getByLabel("Precio de venta (CLP)").fill("9000000");
  await dialog
    .getByRole("button", { name: "Crear contrato", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await savedContracts(page)).length).toBe(5);
  return (await savedContracts(page)).find(
    (contract) => contract.vehicle === vehicle,
  )!;
}

async function openMilestone(page: Page, type: string) {
  await page
    .getByRole("button", { name: "Registrar hito", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("¿Qué ocurrió?").selectOption(type);
  return dialog;
}

// Every test receives a fresh browser context, localStorage and IndexedDB.
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  (page as Page & { applicationErrors: string[] }).applicationErrors = errors;
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Tu tranquilidad, en un solo lugar/ }),
  ).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(
    (page as Page & { applicationErrors: string[] }).applicationErrors,
  ).toEqual([]);
});

test("a new contract has no fabricated milestones and persists after reload", async ({
  page,
}) => {
  const contract = await createContract(page);
  expect(contract.milestones).toEqual([]);
  expect(contract.original).toBeUndefined();
  await page.getByRole("textbox", { name: "Buscar contratos" }).fill("QA Auto");
  await expect(
    page.getByRole("heading", { name: "Resultados de búsqueda" }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.reload();
  const persisted = (await savedContracts(page)).find(
    (item) => item.id === contract.id,
  );
  expect(persisted?.milestones).toEqual([]);
  await navigation(page, "Seguimiento").click();
  await page
    .getByRole("combobox", { name: "Seleccionar contrato" })
    .selectOption(contract.id);
  await expect(
    page.getByRole("heading", { name: "Comienza tu cronología" }),
  ).toBeVisible();
});

test("milestones require delivery and sale; partial payments keep the transfer warning", async ({
  page,
}) => {
  const contract = await createContract(page);
  await navigation(page, "Seguimiento").click();
  let dialog = await openMilestone(page, "pago");
  await dialog.getByLabel("Monto recibido (CLP)").fill("3000000");
  await dialog.getByRole("button", { name: "Guardar hito" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Registra primero la entrega",
  );
  await dialog.getByLabel("¿Qué ocurrió?").selectOption("entrega");
  await dialog.getByRole("button", { name: "Guardar hito" }).click();
  await expect(dialog).toBeHidden();

  dialog = await openMilestone(page, "pago");
  await dialog.getByLabel("Monto recibido (CLP)").fill("3000000");
  await dialog.getByRole("button", { name: "Guardar hito" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Registra primero la venta",
  );
  await dialog.getByLabel("¿Qué ocurrió?").selectOption("venta");
  await dialog.getByRole("button", { name: "Guardar hito" }).click();
  await expect(dialog).toBeHidden();

  dialog = await openMilestone(page, "pago");
  await dialog.getByLabel("Monto recibido (CLP)").fill("3000000");
  await dialog.getByRole("button", { name: "Guardar hito" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page
      .locator(".payment-card")
      .getByRole("heading", { name: "$5.550.000", exact: true }),
  ).toBeVisible();

  await navigation(page, "Informes y reclamos").click();
  await expect(
    page.getByRole("heading", {
      name: "No se detecta un incumplimiento reclamable",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generar borrador" }),
  ).toHaveCount(0);

  await navigation(page, "Seguimiento").click();
  dialog = await openMilestone(page, "traspaso");
  await expect(
    dialog.getByText("Primero el pago, después el traspaso.", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Guardar hito" }).click();
  expect(
    (await savedContracts(page)).find((item) => item.id === contract.id)
      ?.milestones,
  ).toHaveLength(3);
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Guardar hito" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText("Se registró un traspaso antes de completar el pago.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("overdue reports have the correct balance and download a PDF; complete payments have no claim", async ({
  page,
}) => {
  await navigation(page, "Informes y reclamos").click();
  await page
    .getByRole("combobox", { name: "Seleccionar contrato" })
    .selectOption("CT-003");
  await expect(page.locator(".claim-amount strong")).toHaveText("$5.550.000");
  await page
    .getByRole("button", { name: "Generar borrador", exact: true })
    .click();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Descargar informe y borrador PDF",
      exact: true,
    })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toContain("CT-003");
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
  expect(bytes.length).toBeGreaterThan(1500);
  await page
    .getByRole("combobox", { name: "Seleccionar contrato" })
    .selectOption("CT-004");
  await expect(
    page.getByRole("heading", {
      name: "No se detecta un incumplimiento reclamable",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generar borrador" }),
  ).toHaveCount(0);
});

test("contract evaluation handles pasted text, TXT, selectable PDFs and rejects empty PDFs", async ({
  page,
}) => {
  await navigation(page, "Evaluar contrato").click();
  await page
    .getByLabel("Términos del contrato")
    .fill(
      "Pago a 60 días hábiles. La automotora puede rebajar el precio sin autorización. Traspaso antes del pago.",
    );
  await page
    .getByRole("button", { name: "Evaluar términos", exact: true })
    .click();
  await expect(page.locator(".risk-card")).toHaveCount(7);
  await expect(
    page.getByText("Término no encontrado", { exact: true }).first(),
  ).toBeVisible();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "contrato.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(contractText),
    });
  await expect(page.getByLabel("Términos del contrato")).toHaveValue(
    contractText,
  );
  const pdf = new jsPDF();
  pdf.text(contractText, 10, 10, { maxWidth: 180 });
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "contrato.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(pdf.output("arraybuffer")),
    });
  await expect(page.getByText("contrato.pdf", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Términos del contrato")).toHaveValue(
    /Precio mínimo/,
  );
  const blank = new jsPDF();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "vacio.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(blank.output("arraybuffer")),
    });
  await expect(page.getByRole("alert")).toContainText(
    "no contiene texto seleccionable",
  );
  // A failed replacement preserves previously entered data.
  await expect(page.getByLabel("Términos del contrato")).toHaveValue(
    /Precio mínimo/,
  );
});

test("uploaded evidence remains downloadable after reloading the browser", async ({
  page,
}) => {
  const contract = await createContract(page);
  await navigation(page, "Seguimiento").click();
  const dialog = await openMilestone(page, "entrega");
  const original = "Comprobante QA: entrega del vehículo con inventario.";
  await dialog
    .locator("input[type=file]")
    .setInputFiles({
      name: "entrega.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(original),
    });
  await dialog.getByRole("button", { name: "Guardar hito" }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () =>
      Boolean(
        (await savedContracts(page)).find((item) => item.id === contract.id)
          ?.milestones[0]?.evidence?.id,
      ),
    )
    .toBe(true);
  await page.reload();
  await navigation(page, "Mis documentos").click();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Descargar entrega.txt", exact: true })
    .click();
  const download = await downloadEvent;
  expect(await readFile((await download.path())!, "utf8")).toBe(original);
});
