import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function validateFile(file: File): void {
  if (!file.size)
    throw new Error("El archivo está vacío. Selecciona otro archivo.");
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      "El archivo supera los 10 MB permitidos. Selecciona un archivo más pequeño.",
    );
  }
}

/** Extract selectable text locally. No document is sent to an external service. */
export async function readContractFile(file: File): Promise<string> {
  validateFile(file);
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "txt") {
    const text = (await file.text()).trim();
    if (!text) throw new Error("El archivo de texto no contiene información.");
    return text;
  }

  if (extension !== "pdf") {
    throw new Error(
      "Formato no compatible. Carga un archivo TXT o un PDF con texto seleccionable.",
    );
  }

  const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = workerUrl;
  let loadingTask: ReturnType<typeof getDocument> | undefined;
  try {
    loadingTask = getDocument({ data: await file.arrayBuffer() });
    const document = await loadingTask.promise;
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(
        content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
      );
      page.cleanup();
    }
    const text = pages.join("\n\n").trim();
    if (!text) {
      throw new Error(
        "Este PDF no contiene texto seleccionable. Los documentos escaneados no son compatibles; pega el texto del contrato o carga otro PDF.",
      );
    }
    return text;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Este PDF"))
      throw error;
    if (error instanceof Error && error.name === "PasswordException") {
      throw new Error(
        "El PDF está protegido con contraseña. Carga una copia sin protección.",
      );
    }
    throw new Error(
      "No se pudo leer el PDF. Comprueba que no esté dañado y que contenga texto seleccionable.",
    );
  } finally {
    await loadingTask?.destroy();
  }
}
