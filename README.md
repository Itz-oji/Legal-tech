# Consigna · Tu vehículo, tus términos

Plataforma chilena de apoyo al propietario durante la consignación de vehículos. Frontend en **React 19, TypeScript y Vite** conectado a un backend **Flask** con PostgreSQL (SQLite en desarrollo). Sin pantalla de login: en modo demostración la interfaz entra sola con una cuenta compartida.

## Desarrollo

Requiere Node.js 22.12+ y npm (validado con Node 24).

```sh
# 1) Backend (modo demostración, base SQLite local)
cd backend && pip install -r requirements-dev.txt
DATA_DIR=./var DEMO_MODE=1 flask --app wsgi run -p 8000

# 2) Frontend (otra terminal, en la raíz del repositorio)
npm ci
npm run dev
```

Vite escucha en el puerto 5173 y redirige `/api` al backend (127.0.0.1:8000). No se requieren credenciales: con `DEMO_MODE=1` el frontend pide un token a `POST /api/auth/demo` y usa una cuenta compartida. La primera vez, si la cuenta está vacía, carga 4 contratos de ejemplo. Si el backend no responde, la interfaz muestra un error con un botón para reintentar.

```sh
npm test          # Pruebas de reglas, fechas y montos
npm run build    # TypeScript y compilación de producción en dist/
npm run preview  # Servir la compilación para revisión local
npm run test:e2e # Cinco flujos con Playwright; levantan solos el backend (DEMO_MODE, base temporal) y Vite
```

Los tests de navegador usan Chromium del sistema si existe. En otro equipo, instala el navegador con `npx playwright install chromium`. `CHROMIUM_PATH` permite seleccionar un ejecutable.

## Funcionalidades disponibles

- **Resumen:** indicadores derivados de los contratos, plazos, pendientes y navegación a los detalles.
- **Mis contratos:** creación, búsqueda y filtros por estado. Datos iniciales de ejemplo; no corresponden a personas u operaciones reales.
- **Evaluación:** carga de TXT/PDF con texto seleccionable o ingreso manual. Siete términos, riesgos, omisiones explícitas y alternativas. Procesamiento local con PDF.js; no acepta documentos escaneados ni protegidos. Límite de 10 MB.
- **Seguimiento:** entrega, venta, pagos parciales y traspaso; validación de secuencia y fechas; cronología, saldo y comprobantes. Advertencia y confirmación expresa para dejar constancia de un traspaso que ya ocurrió sin pago completo. Registrar no autoriza un traspaso.
- **Informes y reclamos:** saldo adeudado, cronología y borrador dirigido a la automotora o SERNAC, descargable como PDF. No genera reclamos monetarios antes del vencimiento ni cuando el saldo ya está pagado. Un traspaso inseguro con saldo pendiente también habilita un borrador. No envía ni presenta el reclamo.
- **Mis documentos:** originales y comprobantes persistidos en IndexedDB, con descarga del archivo real. Crear un contrato no inventa una entrega ni otro hito.

Contratos, hitos y archivos se guardan en el backend (PostgreSQL y almacén de evidencias), así que persisten entre navegadores y dispositivos. La cuenta de demostración es **compartida**: cualquiera que llegue al servidor ve los mismos datos; no uses datos reales y deja `DEMO_MODE=0` fuera de una demostración. La carga para evaluar un contrato es temporal; para conservar el original, adjuntarlo al crear un contrato.

## Alcance de la demostración

La evaluación usa **reglas deterministas** (criterios versionados en el backend), no una API de IA ni un análisis jurídico validado. El umbral de 15 días hábiles es un criterio demostrativo, no un máximo legal. Los borradores no inventan citas ni fundamentos normativos y requieren revisión antes de usarse. La plataforma orienta; no reemplaza asesoría jurídica.

Los montos se calculan en pesos enteros, con comisión porcentual de hasta dos decimales, sin modelo de lenguaje. Los plazos parten el día hábil posterior a la venta e incluyen un calendario nacional de referencia **2026–2027**, sin feriados regionales o extraordinarios. La validación de hitos limita las fechas al calendario compatible. Para producción el backend debe usar `holidays` de Chile como fuente autoritativa.

## Docker

```sh
docker compose up --build -d
```

Levanta PostgreSQL, el backend Flask y el frontend (Nginx, puerto 5173, con proxy de `/api`). No hace falta configurar nada: compose.yaml trae valores por defecto para desarrollo. Opcionalmente puedes definir ADMIN_TOKEN o SMTP_* en el entorno. El Dockerfile utiliza Node 22 y Nginx, con healthcheck. Se verificaron la compilación de la imagen y las respuestas HTTP del HTML, JavaScript compilado y fallback de la SPA.

En este entorno administrado, el proxy requiere su certificado durante la instalación dentro de la imagen. El Dockerfile acepta un secreto BuildKit opcional, sin incorporarlo a las capas ni desactivar la verificación TLS:

```sh
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -t consigna-frontend .
docker run --rm -p 5173:80 consigna-frontend
```

Si Vite ya ocupa el puerto 5173, detén ese proceso antes de iniciar Docker o utiliza otro puerto local, por ejemplo `-p 5180:80`.

## Estructura

```text
src/App.tsx             Vistas, navegación y formularios
src/components/ui.tsx   Modal accesible, estados, etiquetas y avisos
src/lib/backend.ts      Cliente HTTP: sesión demo, contratos, hitos, evidencias, reclamos y PDF
src/lib/api.ts          Evaluación de contratos (/api/analyze, con reglas locales de respaldo)
src/lib/store.ts        Tipos y contratos de ejemplo (se cargan al backend si la cuenta está vacía)
src/lib/domain.ts       Reglas locales de respaldo, formato y calendario de demostración
src/lib/files.ts        Extracción de texto de PDF/TXT en el navegador
backend/consigna_api/   API Flask (ver más abajo)
```

Los plazos, montos, la secuencia segura, el informe, el borrador y el PDF los calcula el backend; el frontend solo los muestra. Las alertas por correo (APScheduler + SMTP) usan el correo de la cuenta demo (`DEMO_EMAIL`).

## Backend de criterios (`backend/`)

Flask. Contrasta el texto del contrato (pegado, TXT o PDF con texto) con **criterios de protección versionados** que no están en el código: se leen de `criteria.json` en `DATA_DIR` (la semilla está en `backend/seed/`) y se recargan sin reiniciar.

```sh
cd backend && pip install -r requirements-dev.txt
python -m pytest                       # pruebas del backend
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
- `POST /api/auth/demo` (solo con `DEMO_MODE=1`) devuelve un token de la cuenta compartida; `PUT /api/contracts/<id>/original` adjunta el contrato original; `GET /api/contracts?completo=1` lista los contratos con hitos, comprobantes y estado calculado.
