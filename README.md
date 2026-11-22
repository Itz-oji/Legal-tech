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

Levanta PostgreSQL, el backend Flask y el frontend (Nginx, puerto 5173, con proxy de `/api`). Antes, copia `.env.example` como `.env` y completa `POSTGRES_PASSWORD` y `JWT_SECRET`; el resto es opcional (`ADMIN_TOKEN`, `SMTP_*`). El Dockerfile utiliza Node 22 y Nginx, con healthcheck. Se verificaron la compilación de la imagen y las respuestas HTTP del HTML, JavaScript compilado y fallback de la SPA.

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

## Backend de criterios (`backend/`)

Flask. Contrasta el texto del contrato (pegado, TXT o PDF con texto) con **criterios de protección versionados** que no están en el código: se leen de `criteria.json` en `DATA_DIR` (la semilla está en `backend/seed/`) y se recargan sin reiniciar.

```sh
cd backend && pip install -r requirements-dev.txt
python -m pytest                       # 10 pruebas
DATA_DIR=./var ADMIN_TOKEN=... flask --app wsgi run -p 8000
npm run dev                            # Vite redirige /api a 127.0.0.1:8000
```

| Endpoint | Uso |
|---|---|
| `POST /api/analyze` | `{text}` o multipart `file` (PDF/TXT, 10 MB). Devuelve hallazgos, versión de criterios y si hay fuentes por revisar. El texto no se guarda ni se registra. |
| `GET /api/criteria` | Versión activa, criterios, estado de cada fuente. |
| `POST /api/admin/sync` | Revisa ahora las fuentes (también corre cada `SYNC_INTERVAL_HOURS`, 24 por defecto). |
| `GET/PUT /api/admin/criteria`, `GET /api/admin/events` | Ver, publicar una versión nueva (queda historial) y ver qué cambió. Requieren `Authorization: Bearer $ADMIN_TOKEN`. |

**Cómo se mantiene al día.** Cada criterio cita fuentes (Ley 19.496 en BCN, circulares y dictámenes del SERNAC, la publicación institucional citada). El monitor descarga esas páginas, compara su contenido y, si cambian, registra qué líneas cambiaron y marca los criterios afectados: las respuestas de `/api/analyze` y la pantalla de evaluación avisan que el resultado podría estar desactualizado. **No reescribe criterios automáticamente**: una persona revisa el cambio y publica una versión nueva (`PUT /api/admin/criteria` con `acknowledge`), que limpia la alerta. Los criterios sembrados quedan como `pending_legal_review` hasta que un abogado los valide.

Pendiente: las fuentes de SERNAC contienen bloques dinámicos (noticias, encuestas) que pueden generar falsas alertas; ajusta `selector` por fuente en `criteria.json` una vez que veas la primera sincronización real. Si el backend no responde, la pantalla usa las reglas locales de demostración y lo indica.

### Módulos de seguimiento, informe y alertas

Todos los endpoints (salvo registro, login, `/api/analyze` y `/api/criteria`) requieren `Authorization: Bearer <token>` y solo ven datos del propio usuario.

| Endpoint | Uso |
|---|---|
| `POST /api/auth/register`, `/api/auth/login`, `GET /api/me` | Cuenta y sesión (contraseña con scrypt, token JWT de 12 h). |
| `POST/GET /api/contracts`, `GET/DELETE /api/contracts/<id>` | Contratos del usuario; el detalle incluye hitos y estado. |
| `POST /api/contracts/<id>/analyze` | Evalúa el texto guardado con los criterios vigentes. |
| `POST /api/contracts/<id>/milestones` | Registra entrega, venta, pago o traspaso (JSON o multipart con `archivo`). Un traspaso sin pago completo responde 409 y exige `confirmar: true`. |
| `GET /api/evidences/<id>` | Descarga la evidencia (PDF, PNG, JPG, TXT; hasta 10 MB). |
| `GET /api/contracts/<id>/report` | Cronología, saldo adeudado y si hay incumplimiento. |
| `POST /api/contracts/<id>/claims` | Borrador para `automotora` o `sernac`. Sin incumplimiento responde 409 y no genera nada. |
| `GET /api/contracts/<id>/report.pdf?audiencia=sernac` | Informe y borrador en PDF. |
| `POST /api/admin/alerts/run` | Ejecuta ahora las alertas por correo (también corre cada `ALERT_INTERVAL_MINUTES`, 60 por defecto). |

- **Plazos y montos** (`plazos.py`, `calendario.py`): se calculan en código con la biblioteca `holidays` de Chile; sin ella usan un calendario de referencia 2026–2027. Los montos son pesos enteros y la comisión admite dos decimales.
- **Alertas** (`alertas.py`): aviso 3 días antes, el día del vencimiento, al vencer y ante un traspaso sin pago completo; cada alerta se envía una sola vez. Sin `SMTP_HOST` no se envía nada y se reintenta cuando se configura.
- **Pendiente**: la interfaz aún guarda los contratos en `localStorage`; falta migrarla a estos endpoints. La conexión a PostgreSQL no se probó con un servidor real (las pruebas usan SQLite con el mismo SQL).
