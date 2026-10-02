# Diseño de una capa de abstracción de notificaciones y generación documental

> Este documento describe un **diseño propuesto** y una **prueba de concepto acotada**, no una
> migración completa del flujo de n8n. Conecta directamente con la Discusión (§6) y con el punto
> 12 del Capítulo 8 de la tesis ("Abstraer los canales de notificación y de generación
> documental"). La tesis enuncia ese punto de mejora bajo el número 12 del listado del Capítulo 8
> (no 11 como se mencionó al encargar este trabajo); se referencia aquí con el número real para
> que quien lea ambos documentos no encuentre una discrepancia.

> **Estado (23-sep-2026):** la migración se completó con la plataforma compartida. El subflujo
> pasó a llamarse `workflow/avisos.json` y ahora es el único punto de aviso del flujo principal y
> del de tickets: registra cada aviso en la tabla `avisos` (que el desarrollador ve en su panel),
> lo manda por Telegram al chat que el desarrollador vinculó y, si pide una acción, por correo.
> El destino ya no es un chat fijo sino el del espacio del pedido. La única excepción sigue siendo
> `Telegram - Error Critico`, que va directo al chat de la plataforma por la razón de la
> sección 3. Los flujos lo llaman por id (`AVISOS_WORKFLOW_ID`) y no por archivo, y sin esperarlo.
> Lo que sigue describe el diseño y la prueba de concepto originales.

## 1. El problema, confirmado sobre el artefacto real

La Discusión (§6) de la tesis señala: *"Gmail, Telegram, Notion y Gotenberg se invocan
directamente desde nodos del flujo, sin una capa de abstracción de notificaciones ni de
generación documental. Incorporar un canal de notificación nuevo sí exige, por tanto, tocar el
flujo en cada punto donde hoy se notifica."*

Se inspeccionó `workflow/crm_postgres.json` (178 nodos en total) para confirmar cuántos puntos de
invocación directa existen hoy, contando por tipo de nodo real (`node.type`):

| Canal / servicio | Tipo de nodo n8n | Cantidad medida | Cantidad que declara la tesis |
|---|---|---|---|
| Gmail | `n8n-nodes-base.gmail` | **8** | 8 |
| Telegram | `n8n-nodes-base.telegram` | **15** | ~15 |
| Notion | `n8n-nodes-base.httpRequest` (llamadas a `api.notion.com`) | **8** | 8 |
| Gotenberg | `n8n-nodes-base.httpRequest` (conversión HTML→PDF) | **1** | (no se cuantifica en la tesis) |

Se confirman los tres números que cita la tesis. El detalle exacto:

**Gmail (8 nodos):**
`Gmail - Enviar Propuesta`, `Gmail - Enviar Factura PDF`, `Gmail - Enviar Follow-up`,
`Gmail - Recordatorio Pago`, `Gmail - Solicitar Testimonio`, `Gmail - Reenviar Propuesta`,
`Gmail - Aviso No Cambios`, `Gmail - Acuse Lead Frio`.

**Telegram (15 nodos):**
`Telegram - Pago Recibido`, `Telegram - Lead Frio`, `Telegram - Propuesta Enviada`,
`Telegram - Lead Acepto`, `Telegram - Lead Perdido`, `Telegram - Pago Urgente`,
`Telegram - Proyecto Cerrado`, `Telegram - Reporte Diario`, `Telegram - Error Critico`,
`Telegram - Lead Rechazado`, `Telegram - Pedido Cambios`, `Telegram - Cancelado Panel`,
`Telegram - Cambio Aceptado`, `Telegram - Propuesta Por Enviar`, `Telegram - Factura Reconciliada`.

**Notion (8 nodos, todos `HTTP Request` contra `api.notion.com/v1/pages...`):**
`Notion - Crear Card`, `Notion - Estado Aceptado`, `Notion - Estado Cerrado`,
`Notion - Estado Perdido`, `Notion - Estado Trabajo`, `Notion - Estado Cancelado`,
`Notion - Estado Pagado`, `Notion - Cancelado Panel`.

**Gotenberg (1 nodo):**
`HTTP - Gotenberg PDF` (conversión de la factura en HTML a PDF antes de adjuntarla al correo).

Nota: Notion y Gotenberg no tienen un tipo de nodo nativo en esta instalación de n8n; se invocan
como `HTTP Request` genérico contra su API REST. Eso ya es, en sí mismo, parte del problema que
señala la tesis: ni siquiera hay uniformidad en *cómo* se llama a cada canal (nodo nativo con
credencial propia para Gmail y Telegram, HTTP Request crudo con headers manuales para Notion y
Gotenberg), lo que hace más frágil cualquier cambio (por ejemplo, rotar la versión de la API de
Notion exige tocar los 8 nodos HTTP uno por uno).

En aquel corte, el flujo separado de tickets era `workflow/tickets_notion.json`
(38 nodos) y llamaba a Notion; queda fuera del alcance de este análisis
histórico. Ese archivo ya no forma parte del repositorio: el flujo vigente es
`workflow/tickets.json`, sobre la tabla `tickets`.

## 2. Diseño propuesto: una interfaz común de notificación y generación documental

### 2.1 Contrato

Se propone reemplazar las llamadas directas por dos operaciones abstractas, cada una
implementada como un **subflujo de n8n** (mecanismo nativo "Execute Workflow" /
"Execute Workflow Trigger"), de modo que el flujo principal deje de conocer los detalles de cada
proveedor:

```
notificar(canal, destinatario, plantilla, datos) → { ok, detalle }
generarDocumento(tipo, datos) → { pdfBase64 | pdfUrl, ok }
```

- **`canal`**: `"telegram" | "gmail" | "notion"`. Determina qué subflujo de notificación se
  invoca puertas adentro.
- **`destinatario`**: para Telegram, el `chatId` (hoy siempre `$env.TELEGRAM_CHAT_ID`, pero la
  abstracción permite variarlo por profesional en un escenario multiusuario — ver punto 9 del
  Capítulo 8 sobre roles); para Gmail, la dirección de correo; para Notion, el `card_id` o
  `database_id` de destino.
- **`plantilla`**: un identificador de la plantilla de mensaje (por ejemplo,
  `"lead_frio"`, `"pago_recibido"`, `"error_critico"`), de modo que el *contenido* del mensaje
  quede centralizado en el subflujo (o en una tabla de plantillas) y no repetido, letra por
  letra, en cada nodo disperso del flujo principal como ocurre hoy.
- **`datos`**: el objeto JSON con las variables que la plantilla necesita interpolar (nombre,
  score, monto, etc.), equivalente a lo que hoy arma cada nodo en sus expresiones `{{ }}`.
- **`generarDocumento(tipo, datos)`**: encapsula la llamada a Gotenberg (hoy un único nodo, pero
  con potencial de crecer si se agregan otros documentos, como un recibo o un contrato) más la
  generación del HTML de origen, hoy resuelta en nodos `Code` separados por tipo de documento
  (`Code - Generar Factura HTML`, etc.).

### 2.2 Cómo se agruparía en n8n: subflujos reutilizables vía "Execute Workflow"

n8n no tiene un mecanismo de "función" o "clase" en el sentido de un lenguaje de programación,
pero sí tiene el nodo nativo **Execute Workflow**, que invoca a otro flujo (por archivo, por ID
en base, o por parámetro) y le pasa datos de entrada; el flujo invocado empieza con un
**Execute Workflow Trigger**, que declara qué campos espera recibir. Es el equivalente de n8n a
extraer una función reutilizable.

Se proponen tres subflujos nuevos, cada uno con un único punto de entrada:

1. **`notificaciones_telegram.json`** — recibe `{ mensaje, nivel }`, resuelve a qué `chatId`
   enviar según `nivel` (por ejemplo, un chat distinto para alertas críticas) y llama una única
   vez al nodo nativo de Telegram. **Implementado como prueba de concepto en este trabajo — ver
   sección 3.**
2. **`notificaciones_gmail.json`** (propuesto, no implementado) — recibiría
   `{ destinatario, plantilla, datos }`, resolvería el HTML del correo según la plantilla (hoy
   ese HTML está inline y repetido dentro de cada nodo `Code` que antecede a cada nodo Gmail) y
   llamaría una única vez al nodo nativo de Gmail.
3. **`notificaciones_notion.json`** (propuesto, no implementado) — recibiría
   `{ operacion, card_id | database_id, propiedades }` y encapsularía las llamadas HTTP a
   `api.notion.com`, incluyendo el manejo de la versión de la API y de los headers de
   autenticación, hoy repetidos en los 8 nodos HTTP.
4. **`generacion_documentos.json`** (propuesto, no implementado) — recibiría `{ tipo, datos }`,
   armaría el HTML según `tipo` (hoy resuelto por nodos `Code` como
   `Code - Generar Factura HTML`) y llamaría a Gotenberg, devolviendo el PDF resultante.

Cada punto de notificación del flujo principal pasaría de ser "nodo `Telegram`/`Gmail`/`HTTP
Request` con credenciales y plantilla propias" a ser "nodo `Execute Workflow` que le pasa
`{mensaje, nivel}` (o el contrato correspondiente) al subflujo". Agregar un canal nuevo (por
ejemplo, Slack o WhatsApp) pasaría a exigir un cambio en **un solo lugar** (el subflujo, o un
`IF`/`Switch` agregado dentro de él según `canal`), en vez de tocar cada uno de los 8, 15 u 8
nodos dispersos por el flujo principal.

### 2.3 Qué NO resuelve este diseño (limitaciones reconocidas)

- No es una migración de mensajería genérica: sigue habiendo una integración específica por
  canal, sólo que concentrada en un lugar en vez de repetida.
- Introduce una llamada adicional a un subflujo por cada notificación, lo que agrega latencia y
  un nuevo punto de fallo (si el subflujo no se resuelve — por ejemplo, por un ID o ruta
  incorrecta — la notificación completa falla). Esto se discute también en la sección 4.
- El versionado de subflujos en n8n (qué pasa si se publica una nueva versión del subflujo
  mientras el flujo principal ya está corriendo) no se aborda en este documento: excede el
  alcance de una prueba de concepto y requiere probarse contra una instancia real.

## 3. Prueba de concepto implementada (acotada)

Alcance real de este trabajo, dentro de las limitaciones explicadas en la sección 4:

1. Se creó `workflow/notificaciones_telegram.json`: un flujo nuevo y separado con dos nodos:
   - **`Execute Workflow Trigger`**: declara la entrada `{ mensaje, nivel }`.
   - **`Code - Resolver Canal`**: decide el `chatId` de destino según `nivel` (`"critico"` usa
     `TELEGRAM_CHAT_ID_CRITICO` si está definida, y cae a `TELEGRAM_CHAT_ID` si no; cualquier
     otro nivel usa directamente `TELEGRAM_CHAT_ID`). Este nodo es la razón de ser de la
     abstracción: hoy, enrutar las alertas críticas a un chat distinto exigiría tocar el nodo
     `Telegram - Error Critico` puntualmente; con el subflujo, alcanza con cambiar esta única
     pieza para que **todos** los llamadores que declaren `nivel: "critico"` se beneficien.
   - **`Telegram - Enviar`**: el único nodo nativo de Telegram del subflujo, que usa el `chatId`
     resuelto y el `mensaje` recibido.

2. En el flujo principal (`workflow/crm_postgres.json`) se migraron **3 de los 15 nodos**
   Telegram existentes, convirtiéndolos de `n8n-nodes-base.telegram` a
   `n8n-nodes-base.executeWorkflow`, apuntando al nuevo subflujo:
   - `Telegram - Lead Rechazado`
   - `Telegram - Pedido Cambios`
   - `Telegram - Cancelado Panel`

   Se eligieron estos tres porque son nodos terminales (sin conexiones salientes) dentro de sus
   respectivas ramas del panel de gestión (rechazo de propuesta, pedido de cambios, cancelación
   desde el panel), lo que acota el radio de un eventual error de reconexión: si el subflujo
   fallara, el único efecto es que no se emite ese aviso puntual, sin cortar ninguna cadena de
   nodos posterior. **Se preservó el nombre de cada nodo** (`node.name`) exactamente igual al
   original, precisamente para no romper las conexiones (`connections`) del flujo, que en el
   formato de n8n se referencian por nombre y no por `type` ni por `id`.

3. **Nodos Telegram que quedan sin migrar (trabajo futuro), y por qué:**
   - `Telegram - Pago Recibido`, `Telegram - Lead Acepto`, `Telegram - Proyecto Cerrado`,
     `Telegram - Factura Reconciliada`: cuelgan de ramas con múltiples pasos posteriores
     (facturación, cierre de proyecto) donde una migración necesita probarse con más cuidado
     contra una instancia real antes de tocarlas, dado que no se puede levantar n8n en este
     entorno.
   - `Telegram - Lead Frio`: es parte de una afirmación cualitativa verificada por
     `tests/verificar_afirmaciones.mjs` (la rama fría debe generar aviso interno por Telegram y
     acuse de recibo por Gmail, buscando las palabras "telegram"/"gmail" en los nombres de nodo
     de esa rama). No se tocó para no interferir con esa verificación durante esta prueba de
     concepto, aunque en rigor el mismo cambio (conservando el nombre del nodo) tampoco la
     habría roto.
   - `Telegram - Error Critico`: es justamente el caso de uso que motiva el nodo
     `Code - Resolver Canal` del subflujo (chat separado para errores críticos), pero se decidió
     no migrarlo todavía porque su disparador es el `Error Trigger` global del flujo: un fallo
     en el subflujo de notificación en ese punto específico dejaría errores críticos sin avisar
     por ningún canal, que es el peor escenario posible para ese nodo en particular. Migrarlo
     amerita antes definir una política de reintento o un canal de respaldo.
   - `Telegram - Propuesta Enviada`, `Telegram - Pago Urgente`, `Telegram - Reporte Diario`,
     `Telegram - Cambio Aceptado`, `Telegram - Propuesta Por Enviar`, `Telegram - Lead Perdido`:
     no presentaban ninguna razón particular para excluirlos; quedan pendientes simplemente
     porque el alcance acordado para esta prueba de concepto fue de 2 a 3 nodos, no el rewire
     completo.

   Migrar los 12 nodos restantes, y luego repetir el mismo patrón para Gmail (8 nodos) y Notion
   (8 nodos) con sus propios subflujos, es el trabajo de seguimiento natural de este documento.

## 4. Honestidad sobre qué tan probado está esto

**Nada de lo implementado en el punto 3 fue ejecutado contra una instancia real de n8n.** Este
entorno de trabajo no tiene forma de levantar n8n (no hay Docker disponible en este flujo de
trabajo específico) para importar los dos archivos JSON y confirmar en runtime que:

- El nodo `Execute Workflow` resuelve correctamente la ruta al archivo
  `workflow/notificaciones_telegram.json` (la forma exacta de referenciar un flujo por archivo
  local, por ID de la base de n8n, o por parámetro varía según la versión de n8n y cómo esté
  configurado el modo de ejecución de la instancia; se usó `"source": "localFile"` con
  `"workflowPath"` apuntando al archivo del repositorio, que es una de las opciones válidas del
  nodo, pero no se pudo confirmar contra la instancia real que sea la que corresponde a este
  despliegue en particular — podría requerir en cambio importar el subflujo a la base de n8n y
  referenciarlo por `workflowId`).
- El `Execute Workflow Trigger` del subflujo recibe efectivamente los campos `mensaje` y `nivel`
  con la forma en que el nodo `Execute Workflow` los envía (el mapeo de "workflow inputs" también
  cambió de forma entre versiones recientes de n8n).
- Las credenciales de Telegram (`Telegram account`, mismo `id` de credencial ya usado en el flujo
  principal) se resuelven correctamente dentro del subflujo, que es un flujo separado y por lo
  tanto un contexto de ejecución distinto.
- El resto del flujo principal —las 12 llamadas a Telegram sin migrar, las 8 a Gmail y las 8 a
  Notion— sigue funcionando exactamente igual que antes, sin ningún efecto colateral de los
  cambios en los 3 nodos migrados.

En síntesis: **esto es un diseño implementado en el JSON de los flujos, pendiente de
verificación en una instancia real de n8n.** Antes de considerar esta prueba de concepto lista
para producción hace falta, como mínimo: importar ambos flujos a una instancia de n8n de prueba,
disparar cada una de las tres ramas migradas end-to-end, y confirmar que el mensaje llega a
Telegram con el contenido esperado.

## 5. Archivos de este cambio

- `workflow/notificaciones_telegram.json` — subflujo nuevo (prueba de concepto).
- `workflow/crm_postgres.json` — 3 nodos Telegram convertidos a `Execute Workflow`
  (`Telegram - Lead Rechazado`, `Telegram - Pedido Cambios`, `Telegram - Cancelado Panel`); los
  12 nodos Telegram restantes, los 8 de Gmail y los 8 de Notion no se modificaron.
- `docs/diseno-capa-notificaciones.md` — este documento.
