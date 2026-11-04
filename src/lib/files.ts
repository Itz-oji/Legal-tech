import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const DATABASE_NAME = "consigna-evidence";
const STORE_NAME = "files";

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

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(
        new Error(
          "Tu navegador no permite guardar evidencias. Utiliza un navegador compatible.",
        ),
      );
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          "No se pudo abrir el almacenamiento de evidencias. Revisa los permisos de tu navegador.",
        ),
      );
    request.onblocked = () =>
      reject(
        new Error(
          "El almacenamiento está ocupado. Cierra otras pestañas de la aplicación e inténtalo nuevamente.",
        ),
      );
  });
}

/** Save the original file in this browser's IndexedDB, not just its filename. */
export async function storeEvidenceFile(file: File): Promise<string> {
  validateFile(file);
  const database = await openDatabase();
  const id = crypto.randomUUID();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(file, id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          new Error(
            "No se pudo guardar el archivo. Comprueba que haya espacio disponible en el navegador.",
          ),
        );
      transaction.onabort = () =>
        reject(
          new Error(
            "No se pudo completar el guardado del archivo. Inténtalo nuevamente.",
          ),
        );
    });
    return id;
  } finally {
    database.close();
  }
}

export async function getEvidenceFile(id: string): Promise<File | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise<File | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result as File | undefined);
      request.onerror = () =>
        reject(new Error("No se pudo recuperar la evidencia guardada."));
    });
  } finally {
    database.close();
  }
}

export async function downloadEvidence(
  id: string,
  name: string,
): Promise<void> {
  const file = await getEvidenceFile(id);
  if (!file) {
    throw new Error(
      "Este archivo no está disponible en este navegador. Vuelve a cargar la evidencia original.",
    );
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name || file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
