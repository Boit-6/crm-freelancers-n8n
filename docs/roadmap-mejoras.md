# Roadmap de mejoras — CRM Soderos S.A.

Backlog original en `mejoras.md` (raíz). Este documento detalla el análisis y el plan.

## ✅ Hecho (2026-09-01)

- **Recordatorio de propuestas pendientes (RAMA 10):** nuevo cron `🔔 Cron -
  Propuestas Pendientes` que insiste por Telegram, cada 2 horas en horario laboral,
  cuando un lead HOT/WARM queda en `NUEVO` sin que el profesional le fije precio,
  plazo y alcance (riesgo declarado en §4.3.1 y §4.9). Ver
  `docs/propuestas-pendientes-y-transiciones-factura.md`.
- **Transiciones `VENCIDA` y `ANULADA` de facturas (§4.8, Cap. 8 punto 7):** el
  enum `pago_estado` las preveía y ningún nodo las escribía. `VENCIDA` ahora se
  aplica automáticamente dentro de `🟠 Cron - Recordatorios Pago 10AM`; `ANULADA`
  se dispara a mano desde el panel (`POST /factura-anular`, con botón nuevo en el
  tablero). El indicador "Facturas vencidas" de la Tabla 8 se rehizo para contar
  `estado_pago = 'VENCIDA'` en vez de inferirlo de `PENDIENTE` + fecha. Ver el
  mismo documento.

## ✅ Hecho (2026-07-01)

- **#2 — Botones aceptar / pedir cambios / rechazar** en la página de aceptación.
  - Backend: webhooks `lead-rechaza` (→ estado PERDIDO) y `lead-modifica` (→ EN_SEGUIMIENTO, guarda el pedido en `notas` vía mapeo de columnas para esquivar el bug de comas, + Telegram al freelancer).
  - Front: `aceptar-propuesta.tsx` con 3 botones (rechazar pide confirmación; pedir cambios abre un textarea).
- **#3 — Mails (COMPLETO):** los 4 emails rediseñados con estilo pro (header dark `#111827` + card + botón amber `#fbbf24`): propuesta, testimonio, follow-up (pasó de texto plano a HTML) y factura (PDF). Placeholders de factura (`[TU NOMBRE]` etc.) y URL del form de reseñas siguen pendientes de tus datos.

## ⏳ Pendiente

### #1 — Tickets en Notion (necesita definición)
Hoy se crea una *card de lead* en Notion (rama nuevo lead). "Tickets" es ambiguo:
- (a) **Tareas del proyecto** una vez ACEPTADO → crear página en una DB "Proyectos" con checklist.
- (b) **Tickets de soporte** post-venta.
- (c) Otra cosa.

**Acción:** definir cuál. Si es (a): al marcar ACEPTADO, agregar un nodo HTTP a Notion que cree la página de proyecto en una segunda DB.

### #3 — Mails restantes (replicar el estilo del de propuesta)
Aplicar el mismo patrón (header `#111827` + acento `#fbbf24` + tablas `#e4e4e7` + footer gris) a:
- `Code - Generar Factura HTML` — **antes completar** `[TU NOMBRE / EMPRESA]`, `[tu@email.com]`, `[Tu CBU / Alias / PayPal]`.
- `Code - Preparar Follow-up` — hoy es texto plano; pasarlo a HTML.
- `Code - Email Testimonio` — ya con "reseña"; falta la URL real del Google Form.

⚠️ **Regla al tocar mails:** preservar SIEMPRE las variables `${...}` y los links (`acceptUrl`, `payUrl`, `formUrl`). Un backtick o interpolación rota tumba el nodo y corta la rama.

### #4 — Multi-usuario (rediseño — proyecto aparte)
Objetivo: muchos freelancers, cada uno con SUS datos, sin acceso a n8n (usan dashboard + reciben mail/Telegram). Es el más grande; **no se improvisa con código**, va por fases.

**Fase 1 — Aislar datos (multi-tenancy):**
- Agregar `owner_id UUID` (→ `auth.users`) a `leads`, `facturas`, `seguimientos`, `logs`.
- RLS en Supabase: `owner_id = auth.uid()`. El dashboard ya filtra solo (usa Supabase).
- *Es el incremento de mayor valor y menor riesgo. Empezar por acá.*

**Fase 2 — Captación asociada a un usuario:**
- Cada freelancer necesita su form: `…/f/{userSlug}` o un "link de captación" que genere desde el dashboard.
- El webhook `lead-nuevo` recibe `owner_id` y lo guarda en el lead.

**Fase 3 — Notificaciones por usuario (lo difícil):**
- Hoy n8n tiene UNA credencial de Gmail y UN chat de Telegram. Para multi-usuario:
  - **Telegram:** tabla `perfiles` con el `chat_id` de cada freelancer; el workflow lee el chat del *owner* del lead (un solo bot, muchos destinos). En vez de `chatId` fijo → `={{ chat del owner }}`.
  - **Email:** mandar desde una cuenta central con `reply-to` = email del freelancer (simple), o OAuth de Gmail por usuario (complejo).
- Implica un refactor transversal: casi todas las ramas dejan de usar credenciales/chatId fijos y leen la config del owner.

## 🛡️ Mejoras de robustez detectadas (recomendadas)
- **Rama 2 (aceptación):** el `Respond` corre en paralelo con la cadena larga (factura→Gotenberg→…). Si un nodo falla ANTES del Respond, el webhook responde vacío y el front tira `Unexpected end of JSON`. **Reordenar para responder primero**, disparar la cadena después.
- **Notion (ramas 1/3/5):** agregar un `IF card_id no vacío` antes de los PATCH de Notion → los leads pre-Notion (sin `card_id`) no rompen la cadena.
- **Config (mantenibilidad):** mover `DATABASE_ID` y `chatId` a variables de entorno (`.env`) para no reponerlos en cada import. `chatId` en expresión funciona directo; `database_id` en nodo Code requiere `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.
