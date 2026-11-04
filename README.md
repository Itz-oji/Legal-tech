# Consigna · Tu vehículo, tus términos

Frontend de una plataforma chilena de apoyo al propietario durante la consignación de vehículos. Implementado con **React 19, TypeScript y Vite**, con diseño adaptable a móvil y escritorio, fuentes locales e iconos Lucide.

## Desarrollo

Requiere Node.js 22.12+ y npm (validado con Node 24).

```sh
cd /workspace/Legal-tech
npm ci
npm run dev
```

Vite escucha en el puerto 5173. No se requieren credenciales para la demostración.

```sh
npm test          # Pruebas de reglas, fechas y montos
npm run build    # TypeScript y compilación de producción en dist/
npm run preview  # Servir la compilación para revisión local
npm run test:e2e # Cinco flujos funcionales con Playwright
```

Los tests de navegador usan Chromium del sistema si existe. En otro equipo, instala el navegador con `npx playwright install chromium`. `CHROMIUM_PATH` permite seleccionar un ejecutable.

## Funcionalidades disponibles

- **Resumen:** indicadores derivados de los contratos, plazos, pendientes y navegación a los detalles.
- **Mis contratos:** creación, búsqueda y filtros por estado. Datos iniciales de ejemplo; no corresponden a personas u operaciones reales.
- **Evaluación:** carga de TXT/PDF con texto seleccionable o ingreso manual. Siete términos, riesgos, omisiones explícitas y alternativas. Procesamiento local con PDF.js; no acepta documentos escaneados ni protegidos. Límite de 10 MB.
- **Seguimiento:** entrega, venta, pagos parciales y traspaso; validación de secuencia y fechas; cronología, saldo y comprobantes. Advertencia y confirmación expresa para dejar constancia de un traspaso que ya ocurrió sin pago completo. Registrar no autoriza un traspaso.
- **Informes y reclamos:** saldo adeudado, cronología y borrador dirigido a la automotora o SERNAC, descargable como PDF. No genera reclamos monetarios antes del vencimiento ni cuando el saldo ya está pagado. Un traspaso inseguro con saldo pendiente también habilita un borrador. No envía ni presenta el reclamo.
- **Mis documentos:** originales y comprobantes persistidos en IndexedDB, con descarga del archivo real. Crear un contrato no inventa una entrega ni otro hito.

Los metadatos se guardan en `localStorage`; los archivos en IndexedDB. Borrar los datos del navegador elimina esta información. La carga para evaluar un contrato es temporal; para conservar el original, adjuntarlo al crear un contrato. No hay sincronización entre dispositivos, cuentas ni autenticación real; el perfil de Camila es ficticio.

## Alcance de la demostración

La evaluación usa **reglas deterministas**, no una API de IA ni un análisis jurídico validado. El umbral de 15 días hábiles es un criterio demostrativo, no un máximo legal. Los borradores no inventan citas ni fundamentos normativos y requieren revisión antes de usarse. La plataforma orienta; no reemplaza asesoría jurídica.

Los montos se calculan en pesos enteros, con comisión porcentual de hasta dos decimales, sin modelo de lenguaje. Los plazos parten el día hábil posterior a la venta e incluyen un calendario nacional de referencia **2026–2027**, sin feriados regionales o extraordinarios. La validación de hitos limita las fechas al calendario compatible. Para producción el backend debe usar `holidays` de Chile como fuente autoritativa.

## Docker

```sh
docker compose up --build -d
```

Compila el frontend y lo sirve con Nginx en el puerto 5173. Solo incluye el frontend; no crea un backend o una base PostgreSQL inexistentes. El Dockerfile utiliza Node 22 y Nginx, con healthcheck. Se verificaron la compilación de la imagen y las respuestas HTTP del HTML, JavaScript compilado y fallback de la SPA.

En este entorno administrado, el proxy requiere su certificado durante la instalación dentro de la imagen. El Dockerfile acepta un secreto BuildKit opcional, sin incorporarlo a las capas ni desactivar la verificación TLS:

```sh
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -t consigna-frontend .
docker run --rm -p 5173:80 consigna-frontend
```

Si Vite ya ocupa el puerto 5173, detén ese proceso antes de iniciar Docker o utiliza otro puerto local, por ejemplo `-p 5180:80`.

## Estructura y siguiente integración

```text
src/App.tsx             Vistas, navegación y formularios
src/components/ui.tsx   Modal accesible, estados, etiquetas y avisos
src/lib/store.ts        Tipos, datos de muestra y almacenamiento de contratos
src/lib/domain.ts       Reglas demostrativas, cálculos y calendario
src/lib/domain.test.ts  Casos límite de fechas, montos y análisis
src/lib/files.ts        Extracción PDF/TXT y evidencias en IndexedDB
src/styles.css         Diseño y adaptación móvil
```

La aplicación no llama a un servidor. Para conectarla al backend Python (FastAPI o Flask):

1. Sustituir la persistencia local por servicios HTTP para usuarios, contratos, hitos y archivos, con autorización por propietario.
2. Sustituir `assessContractText` por la API de análisis con criterios JSON/YAML versionados, gestión de errores y conservación de los datos cuando el proveedor de IA no esté disponible.
3. Calcular y validar montos y plazos también en el backend; programar alertas con APScheduler y SMTP. Las notificaciones actuales solo son internas.
4. Generar informes con fundamentos normativos revisados y entregar PDFs desde el backend. Los borradores locales sirven para probar el flujo.
5. Configurar PostgreSQL, almacén de evidencias y servicios en el despliegue del backend. No exponer credenciales de IA o SMTP mediante variables `VITE_*`, que son públicas.
