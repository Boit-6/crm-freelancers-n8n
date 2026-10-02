# Plan de cierre — CRM Freelance Automatizado

> Generado el 2026-09-18 verificando **código real, commit por commit**, no el
> plan original (`PLAN_IMPLEMENTACION.md`, 2026-09-16) ni dictámenes de
> sesiones anteriores. Reemplaza a ese archivo: la mayoría de sus 67 ítems ya
> están cerrados, y mantenerlo tal cual desinforma más de lo que ayuda.

Convención: **✅ CERRADO** (confirmado en el código actual) · **❌ FALTA**
(no existe) · **⚠️ MEJORAR** (existe pero con un defecto o hueco puntual).

---

## Fase 0 — Seguridad crítica → **CERRADA (7/7)**

| Ítem | Estado | Detalle |
|---|---|---|
| Open redirect en login/confirm | ✅ | `new URL()` + comparación de `origin` en `login-form.tsx` y `auth/confirm/route.ts` |
| CORS `*` en tickets | ✅ | Ya no cae a `'*'` sin `TICKETS_CORS_ORIGINS` |
| Auth de tickets abierta sin API key | ✅ | Falla explícita si falta `TICKETS_API_KEY` |
| Credenciales `REEMPLAZAR_AL_IMPORTAR` | ✅ | Checklist en README |
| Relay de email público (spam) | ✅ | Confirmado en `crm_postgres.json`: la clave de rate limit de `lead/nuevo` dejó de ser el email declarado (rotable a voluntad) y pasó a ser la IP (comentario del propio código documenta el motivo) |
| Rate limit por XFF spoofeable | ✅ (2026-09-18) | Bug real encontrado y corregido hoy: las 5 rutas con rate limit tomaban `xff.split(',')[0]` (el primer tramo, el que declara quien llama y es falsificable) en vez del último (el que agrega el proxy de confianza). Cambiado a `.pop()` en los 5 nodos. Sigue dependiendo de que n8n esté detrás de exactamente un proxy de confianza (documentado); sin proxy, ningún esquema de XFF es confiable |
| Alertas falsas de MP a Telegram | ✅ | El nodo de notificación valida firma HMAC antes de seguir (ver ítem siguiente) |

### ✅ CERRADO (2026-09-18) — Contradicción doc/código en la firma de MercadoPago
- **README** (línea 253) decía *"Firma opcional (`MP_WEBHOOK_SECRET`...)"*,
  pero el código (`Code - Leer Notificacion MP`) la hace obligatoria de facto
  desde el cierre de S8: sin secreto, o con firma inválida, `payment_id`
  queda vacío y la notificación se descarta.
- Verificado que **no es un bug funcional**: `.env.example` y
  `docs/evidencia-E15-E16.md` ya documentaban correctamente que la firma es
  obligatoria (S8, cerrada) — solo el README y dos líneas de
  `docs/modulo-pagos.md` habían quedado con la redacción vieja ("opcional" /
  "vacía = no se valida").
- **Corregido:** README línea 253 y las dos líneas de `docs/modulo-pagos.md`
  actualizadas para decir "obligatoria" y explicar la consecuencia real
  (se descarta la notificación, no que "no se valide").
- **Pendiente de quien opere la infra:** confirmar que `MP_WEBHOOK_SECRET`
  esté seteada en el n8n de **producción** (en dev, `docker-compose.yml` ya
  aplica un default). Esto no lo puedo verificar desde el repo.

---

## Fase 1 — Base de datos y workflow → **CERRADA (16/16)**

Confirmados en `db/schema.sql` y `workflow/crm_postgres.json`:
admin_emails (whitelist en vez de hardcode) · `email` nullable en `profiles` ·
`ON DELETE RESTRICT` en facturas · índice `idx_leads_dedup` · índice muerto
dropeado · `parsearImporte()` correcto (incluye caso `"1e3"`) · regex de
email · `moneda` default `ARS` + CHECK · políticas separadas por operación en
`n8n_writer` (ya no `FOR ALL`) · `FORCE ROW LEVEL SECURITY` en las 7 tablas ·
rate limit corregido (suma `+1` explícito en vez de depender del snapshot de
la CTE).

| Ítem | Estado | Detalle |
|---|---|---|
| Tabla `seguimientos` nunca poblada | ✅ CERRADO (corregido en este plan) | Era un falso negativo mío: sí se escribe, vía `Postgres - Insert Seguimiento` (nodo de tabla de n8n, no SQL crudo — por eso no aparecía al buscar `INSERT INTO seguimientos` como texto) |
| `fecha_envio_email` (Gmail falla después de insertar la factura) | ✅ CERRADO (2026-09-18) | Ver detalle abajo — implementado hoy |
| Lead ID sin `ON CONFLICT` | ⚠️ Riesgo aceptado, no se toca | Ver detalle abajo |

### ✅ CERRADO (2026-09-18) — `facturas.fecha_envio_email`
- **Encontrado:** `Code - Generar Factura HTML` disparaba dos ramas en
  **paralelo**: `Postgres - Insert Factura` por un lado, `HTTP - Gotenberg PDF`
  → `Gmail - Enviar Factura PDF` por otro. Si Gotenberg o Gmail fallaban, la
  fila de la factura quedaba creada igual, sin ninguna marca de que el
  cliente nunca recibió el PDF — y la reconciliación (S5) no lo detecta
  porque busca facturas **inexistentes**, no facturas sin enviar.
- **Impacto real, más acotado de lo que sugiere el nombre:** el lead sí pasa
  a `FACTURADO` (esa rama no depende de Gmail), y el cron de recordatorios de
  pago (`🟠 Cron - Recordatorios Pago 10AM`) igual le manda al cliente el link
  de pago en los días siguientes, aunque nunca haya recibido el PDF inicial.
  No es un lead atascado para siempre; es una notificación inicial perdida
  en silencio, sin manera de auditarlo.
- **Fix:** columna `facturas.fecha_envio_email` (nullable, `NULL` = no
  confirmado). Se reordenó la rama para que `Postgres - Insert Factura` corra
  **antes** que el envío del PDF (ya no en paralelo — así el nodo nuevo,
  `Postgres - Marcar Factura Enviada`, actualiza una fila que ya existe en
  vez de una carrera contra el INSERT). No agrega reintento automático — el
  cron de recordatorios ya cumple ese rol; esto es para poder auditar cuántas
  facturas quedaron así.
- Actualizado `docs/afirmaciones-tesis.json` (226→227 nodos totales,
  207→208 funcionales) con nota fechada, siguiendo la convención del propio
  archivo. `npm test` corre limpio con los nuevos números.
- **Sin verificar:** no pude correr esto contra una instancia de n8n real
  (Docker no estaba levantado en esta sesión). El JSON es válido y el grafo
  de conexiones no tiene nodos huérfanos, pero antes de confiarlo en
  producción conviene importarlo y probar el flujo de aceptación una vez a
  mano.

### ⚠️ Riesgo aceptado, no se toca — Lead ID sin `ON CONFLICT`
`LD-{timestamp}-{10 hex}` (ya no 4 caracteres): la colisión es de orden de
1 en más de un billón dentro de la misma ventana de dedup. Agregar
`ON CONFLICT DO NOTHING` obligaría a manejar el caso "insert no devolvió
fila" en cada nodo que consume el resultado más abajo, por una probabilidad
prácticamente nula. Mismo criterio que el proyecto ya aplicó en
`docs/verificacion-y-seguridad.md` §5.1.1 para la rotación de token: mejor
documentar el residuo que sumar complejidad para blindarlo.

### ℹ️ Ya declarado por el propio proyecto — rotación de token en follow-up
No es un ítem nuevo: `docs/verificacion-y-seguridad.md` §5.1.1 ya documenta
que si el cron de seguimiento falla al mandar el Gmail después de rotar el
`accept_token`, el lead queda con un link viejo inválido hasta la próxima
corrida del cron (auto-recuperable, no es un cuelgue permanente). Decisión
tomada con buen criterio en su momento (un hash del token no es viable
porque los recordatorios necesitan releerlo en claro) — la dejo tal cual,
sin re-abrir.

---

## Fase 2 — Frontend → **CERRADA**

Confirmados: `getAdminUser()` extraído a `src/lib/auth.ts` · `error.tsx` /
`loading.tsx` en dashboard y tickets, más `global-error.tsx` / `not-found.tsx`
· `src/lib/constants.ts` creado · CSS `-moz-range-thumb` agregado ·
`dashboard-client.tsx` bajó de 877 a 319 líneas (refactor real, partido en
componentes) · react-hook-form integrado · security headers, SEO, dark mode.

| Ítem | Estado | Detalle |
|---|---|---|
| Tipos de Supabase generados | ✅ CERRADO (2026-09-18) | Ver detalle abajo |
| Optimizar queries del dashboard | ✅ Ya estaba bien, no era un hallazgo | El propio código ya explica por qué: el funnel necesita el historial completo de estados, y `metrics_mensuales` agrupa por mes — no sirve para eso. A la escala actual, traer solo la columna `estado` de todos los leads no es un costo real. Error mío en la pasada anterior, no del código |

### ✅ CERRADO (2026-09-18) — Tipos de Supabase generados
- No pude correr `supabase gen types` de verdad: requiere una conexión
  autenticada al proyecto en la nube, que no está disponible desde acá.
- En su lugar escribí `src/types/supabase.ts` a mano, con la misma forma que
  produce esa herramienta (`Database.public.Tables/Views/Enums`, con
  `Relationships` — hace falta para que el parser de selects de
  `@supabase/postgrest-js` type-chequee, si no todo colapsa a `never`),
  transcribiendo `db/schema.sql` columna por columna (7 tablas, 2 vistas, 7
  enums, incluidas las columnas que solo existen vía `ALTER TABLE ADD COLUMN`
  como `facturas.pago_token`/`pay_url` y `leads.precio_propuesto`).
- Tipé los tres puntos donde se crea el cliente de Supabase
  (`lib/supabase/client.ts`, `server.ts`) con `<Database>`.
- En `dashboard-client.tsx` saqué los 5 `as X` — la mayoría (`Lead[]`,
  `Trabajo[]`, `PedidoCambio[]`, `PorEnviar[]`) ya no hacía falta ningún cast,
  el tipo inferido matcheaba solo. Los dos que vienen de una **vista**
  (`Metrics`, `FacturaPendiente[]`) sí necesitaban algo, porque las vistas
  declaran todas sus columnas nullable (no pueden garantizar NOT NULL) aunque
  acá vengan de columnas NOT NULL de la tabla base — en vez de un cast a
  ciegas, son dos funciones (`aMetrics`, `aFacturaPendiente`) que resuelven
  esa nulabilidad explícitamente.
- Verificado con `npm run check` (tests + lint + typecheck) y con
  `next build` reales, ambos limpios — no solo con el tipo, con la build
  completa.

---

## Fase 3 — Infraestructura y DevOps → **CERRADA**

Confirmados: `.nvmrc`, healthchecks + límites de recursos + logging en
`docker-compose.yml`, Gotenberg pineado a `8.14.1`, `N8N_DIAGNOSTICS_ENABLED=false`,
`concurrency` + `timeout-minutes` + `paths-ignore` + `npm audit` en CI,
`src/lib/env.ts` con validación zod, README real del frontend (no boilerplate),
sin lockfile duplicado (`pnpm-lock.yaml` eliminado).

### ✅ CERRADO (2026-09-18) — gitleaks / secret scanning en CI
- Job nuevo `secretos` en `.github/workflows/ci.yml`. Corre el **binario**
  de gitleaks pineado a `v8.18.4`, no la Action de marketplace (esa pide
  licencia para uso en organizaciones — no vale la pena la dependencia).
- **Lo probé de verdad contra el historial completo del repo antes de
  confiarlo**, no solo escribí el YAML a ciegas: encontró 3 falsos positivos
  reales (regla `generic-api-key` matcheando valores de ejemplo de
  `accept_token`/`pago_token` en `docs/evidencia-E15-E16.md` y
  `tests/smoke_code_nodes.js` — son UUID que la propia base genera por lead,
  no credenciales), documentados y suprimidos por fingerprint en
  `.gitleaksignore` (no hallazgos reales, no hay nada que rotar). Con eso,
  `gitleaks detect` termina limpio (exit 0).
- **Nota aparte, no corregida:** el historial tiene un archivo de lock de
  Word (`~$tesis.docx`) commiteado en algún momento y borrado después — no
  es un secreto, es basura mínima en el `.git` (no en el árbol actual).
  Sacarlo requeriría reescribir historia; no lo toqué sin que lo pidas.

---

## Fase 4 — Testing y calidad → **CERRADA (2026-09-18)**

### Frontend: Vitest + RTL, de cero a 60 tests en 8 archivos
- Instalado Vitest 3 + React Testing Library + jsdom (versiones pineadas a
  propósito: `@vitejs/plugin-react@^4` y `vitest@^3`, no `latest` — las
  últimas mayores piden Babel 8 / `@types/node` ≥22, que chocan con el resto
  del proyecto, fijado a Node 20). `vitest.setup.ts` corre `cleanup()` de RTL
  después de cada test (si no, los `render()` se acumulan entre tests y los
  `getByRole` empiezan a encontrar más de un elemento).
- Scripts `test`/`test:watch` en `FormularioLeads/package.json`, `test:front`
  en la raíz, sumado a `npm run check` y al job `frontend` de CI.
- **Lógica pura / rutas de servidor (37 tests, F4.1 parte 1):**
  `lib/auth.ts` (`getAdminStatus`/`getAdminUser`, las 4 combinaciones de
  sesión × rol), `lib/tickets.ts` (`requireAdmin`, `llamarTickets`
  fail-closed), el proxy `api/crm/[accion]` completo (lista blanca,
  fail-closed sin `CRM_PANEL_TOKEN`, no filtra el token si n8n rechaza), y
  regresión de los dos `redirectSeguro` de F0.1 (se exportaron para poder
  testearlos directo, incluido el caso puntual `/\evil.com`).
- **Componentes con RTL (23 tests, F4.1 parte 2):**
  - `trabajo-estado-select.test.tsx` (6): update optimista, revierte si el
    servidor responde `ok:false` o si el fetch falla, no llama a nada si
    elegís el valor que ya estaba.
  - `lead-form.test.tsx` (6): validación de los 5 campos requeridos, email
    con formato inválido, envío exitoso con el body correcto, **doble click
    no manda dos peticiones** (la deuda S6 de la Tabla 11, del lado del
    navegador), error del servidor no pasa a la pantalla de éxito.
  - `aceptar-propuesta.test.tsx` (11): las 4 pantallas de F4.3.2/§5.1.2
    (`ya_procesado`/`expirado`/`rotado`/`invalido`) por separado en vez del
    cartel genérico, aceptar/rechazar/pedir cambios con sus tres webhooks,
    `window.confirm` cancelado no llama a nada, botón de pedir cambios
    deshabilitado hasta 5 caracteres.
- Verificado con la suite completa + lint (`--max-warnings 0`) + typecheck +
  `next build` reales en cada paso, no sólo con los tests en aislado.

### Backend: RLS (F4.3) y edge cases (F4.5), contra Postgres real
- **19 casos nuevos en `tests/rls/casos.sql` (33 → 52)**, corridos contra un
  PostgreSQL desechable real: n8n_writer también escribe facturas (antes
  sólo se probaba leads/logs); anon con los 3 intentos de escritura, no sólo
  lectura; meta-caso contra `pg_class` que exige `relrowsecurity` +
  `relforcerowsecurity` en las 7 tablas de negocio (para que un `ENABLE`
  olvidado en una tabla nueva no dependa de que alguien se acuerde de
  sumarle sus propios casos); `seguimientos` y `rate_limit_log`, que no
  tenían un solo caso; registro solo-teléfono (F1.2) + promoción a admin vía
  `admin_emails`; el trigger `set_actualizado_en` corre de verdad.
  `tests/rls/bootstrap.sql` pasó a permitir `auth.users.email` NULL para
  poder probar el caso solo-teléfono.
- **`tests/normalizar_lead_edge_cases.mjs` (17 casos, F4.5):** el parser de
  presupuesto (F1.9) contra `"$1,500.00"`, `"1.500,00"`, `"1e3"` (se
  rechaza, no se lee como 13), `"10abc"`, `""`, `null`, negativos y cero; la
  validación de email contra `"a@"`, vacío, sin arroba y mayúsculas.
  Sumado a `npm test` como `test:edgecases`.
- Verificado con `npm run test:docker` (SQL + RLS + idempotencia) completo,
  no sólo el archivo tocado.

### Higiene del repo (F4.4, F4.6, F4.7, F4.8)
- Los 6 tests que quedaban en CommonJS (`smoke_code_nodes`, `scoring`,
  `parametros_sql`, `auth_errores`, `tickets_envejecimiento`,
  `verificar_afirmaciones`) pasan a `.mjs`, mismo patrón que el resto de la
  suite. Actualizadas todas las referencias en README/docs que los citaban
  por nombre (dejé sin tocar `.gitleaksignore` y `docs/dictamen-v6-reejecucion.md`:
  el primero fija un fingerprint a un commit histórico, el segundo es una
  narrativa congelada).
- TypeScript: `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`,
  `forceConsistentCasingInFileNames`, `target: es2017`. Un solo sitio real
  afectado (`tickets-board.tsx`: `colorPrioridad` podía devolver `undefined`).
- ESLint: `no-console` a error (ya no había `console.log` sueltos),
  `consistent-type-imports`. Los tres `jsx-a11y` deshabilitados
  (`no-static-element-interactions`, `click-events-have-key-events`,
  `html-has-lang`) resultaron innecesarios — el código ya no los violaba —
  así que se sacó el disable en vez de acotarlo por archivo.
- `next-env.d.ts` committeado, ya no en `.gitignore`.

### Lo único que NO se hizo, con motivo
No pude confirmar un caso de F4.5 (`vence` con `"mañana"`, `"2024-13-99"`):
no encontré ningún nodo que hoy parsee una fecha así escrita a mano — las
fechas de vencimiento se calculan con `Date.now() + dias*86400000`, no se
leen de un string del usuario. Puede que el código haya cambiado desde que
se escribió el plan original; no inventé un test para un caso que no pude
ubicar en el código actual.

### Nota — advisory de `npm audit` en devDependencies
`@vitest/mocker` (2.1.0–4.1.10, que arrastra `vitest@^3`) tiene un moderate
advisory (path traversal, GHSA-82fw-gwwq-j7x9). No sube el `npm audit
--audit-level=high` de CI (queda en 0 igual) y es una herramienta de
testing que corre sobre código propio en CI, no expuesta a internet — no lo
fuercé a `vitest@5` porque reintroduce el choque de `@types/node` con Node 20.

---

## Fase 5 — Futuro / features → **0/8, backlog a propósito**

Auditoría real (`audit_log`), historial de propuestas y de pagos,
paginación server-side del dashboard, CI/CD de despliegue completo,
monitoreo/observabilidad, cleanup de `rate_limit_log`, i18n. No es deuda —
es roadmap post-defensa.

---

## Lo que sobra (transversal — no estaba en el plan original) → **resuelto (2026-09-23)**

| Ítem | Resolución |
|---|---|
| `docs/adenda-informe-evaluacion-20260901.md` | ✅ Borrada. Era una autoevaluación tipo "dictamen CONEAU" generada por IA sobre el propio `tesis.docx`, sin referencias desde ningún otro doc. |
| `docs/figura06-tablero-20260826.jpg` | ✅ Borrada. Era la captura previa a `1201c2c`, con el correo personal de un autor; la vigente es `figura06-tablero-20260829.jpg`. |
| `PLAN_IMPLEMENTACION.md` (raíz, sin trackear) | ✅ Borrado; este archivo lo reemplaza. |
| CRLF en el working tree (71 archivos) | ✅ Descartado (era solo fin de línea, sin cambios de contenido) y `.gitattributes` con `eol=lf` para que no vuelva. |
| `docs/cumplimiento-ley-25326.md` | Sigue sin referencias desde otro `.md`; queda a confirmar si el `.docx` la cita. |

---

## Ronda de análisis del 2026-09-23

Revisión completa del repo (esquema, workflows, frontend, compose, CI). Lo que
se corrigió, un commit por tema, cada uno con su test:

| # | Hallazgo | Commit |
|---|---|---|
| 1 | El formulario público permitía mandar HTML arbitrario desde el Gmail del negocio (acuse del lead frío) y romper los avisos de Telegram | `bc476a6` |
| 2 | SSRF: Gotenberg renderizaba la factura con JS y acceso a la red interna (verificado con contenedores) | `bc476a6` |
| 3 | Pagos aprobados de MercadoPago que se perdían en silencio (factura VENCIDA/ANULADA, monto sin verificar) | `095b250` |
| 4 | `admin@gmail.com` precargado en la whitelist y promoción a admin antes de confirmar el email | `6d70103` |
| 5 | `metrics_mensuales` contaba las facturas ANULADAS como facturación y pendiente | `e54a02b` |
| 7 | Cerrar el proyecto daba la factura por cobrada, indistinguible de un pago real (`metodo_cobro`) | `f6629a7` |
| 8 | El tablero no mostraba las facturas VENCIDA ni se enteraba de cambios en `facturas` | `a9464be` |
| 9 | La aceptación no revalidaba el token en el `UPDATE` | `a6903e1` |
| 10 | Firma de MercadoPago y `x-api-key` de tickets comparadas con `===` | `a6903e1` |
| 12 | El proxy consultaba Supabase Auth en cada página pública | `cffc51e` |
| 14 | `src/lib/env.ts` sin uso | `cffc51e` |
| 16 | Actions de CI por tag y gitleaks sin verificar checksum | `121026b` |

**No se cambió, con motivo:**

- **Duplicación en n8n (13).** La lógica de rate limit está copiada en 5+5
  nodos y el bloque `CFG` de tickets en 10. Pasarla a un sub-workflow es un
  cambio estructural que no se puede verificar sin una instancia de n8n
  corriendo (el propio `notificaciones_telegram.json` sigue «pendiente de
  verificación real»). Sí se corrigió el comentario de tickets que decía lo
  contrario de lo que hace el código.
- **Rate limit por `X-Forwarded-For` (11).** Sólo es confiable con un proxy
  propio delante de n8n que escriba ese header; sin él, quien llama elige su
  IP y los pedidos sin header comparten la clave `ip-desconocida`. Es un
  requisito de despliegue, documentado en `docs/verificacion-y-seguridad.md`
  §5.4. El conteo tampoco es atómico ante ráfagas concurrentes.

---

## Lo que queda

Depende de quien opere la infraestructura o del documento, no del código:

1. **Reimportar `workflow/crm_postgres.json` y `workflow/tickets_notion.json`**
   en el n8n real y recrear Gotenberg (`docker compose up -d gotenberg`). Sin
   esto, nada de la ronda del 23-sep (ni los fixes de Fase 0 y 1) corre en
   producción. Probar después: un lead llamado `A & B` tiene que llegar a
   Telegram, y un pago sobre una factura vencida tiene que registrarse.
2. **Aplicar `db/schema.sql`** en Supabase y, en esa base, borrar la fila vieja
   (`DELETE FROM admin_emails WHERE email = 'admin@gmail.com'`) y dar de alta
   la dirección real del administrador.
3. **Migrar la conexión de n8n a `n8n_writer`** (`ALTER ROLE n8n_writer WITH
   LOGIN PASSWORD …` y cambiar la credencial Postgres de n8n). Hasta entonces
   la mitigación S4 de la Tabla 11 está en el esquema pero no en uso: n8n sigue
   conectado como `service_role`.
4. Confirmar `MP_WEBHOOK_SECRET` en producción (Fase 0).
5. **Actualizar §4.8 de `tesis.docx`:** una factura pasa a COBRADO desde
   PENDIENTE **o VENCIDA** (pago tardío), nunca desde ANULADA.
   `tests/verificar_afirmaciones.mjs` ya refleja la regla nueva.
6. Captcha (p. ej. Cloudflare Turnstile) en el formulario público: el acuse
   del lead frío todavía puede dirigirse a cualquier dirección, cinco veces por
   minuto por IP. Requiere una cuenta externa.
7. Entorno local: `FormularioLeads/node_modules` está instalado desde Windows
   (sólo binarios `win32`), así que Vitest no arranca en Linux; y `.nvmrc` pide
   Node 20. Reinstalar con `nvm use && rm -rf node_modules && npm ci` si se
   trabaja desde Linux.

Con Fase 0 a 4 cerradas, sólo queda Fase 5 (backlog a propósito, no deuda).
