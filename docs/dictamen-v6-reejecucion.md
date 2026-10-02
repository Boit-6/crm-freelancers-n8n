# Dictamen de Auditoría — Re-ejecución v6

> Re-ejecución del protocolo adversarial de `prompt-maestro-reconstruido.md` (el mismo que produjo
> el dictamen v5 externo, 4,4/10, 2 de agosto de 2026) sobre el estado **actual** de
> `FormularioLeads/tesis.docx`, tras la reconciliación del documento corregido (rondas 1–5) y las
> correcciones aplicadas en esa sesión. Fecha del informe: **21 de agosto de 2026**.
> Es evidencia histórica. La prevención versionada actual no depende de que
> n8n evalúe expresiones en `allowedOrigins`: `npm run workflow:render -- --out
> <directorio-nuevo>` genera copias con literales desde `CORS_ORIGINS` antes
> de importar. La prueba de navegador de 2026-08-22 no valida esos artefactos
> ni un despliegue actual.

---

## Actualización 2 — segunda pasada, con el sistema corriendo (22-ago-2026)

Esta pasada se hizo con algo que la anterior no tenía: **el sistema levantado y
funcionando**. Eso cambió la naturaleza de la auditoría — se dejó de leer código para
pasar a ejercitarlo, y aparecieron defectos que ninguna lectura estática ni ningún test
existente había detectado.

### Cinco defectos que sólo aparecen ejecutando

| # | Defecto | Por qué no lo veía nadie | Estado |
|---|---|---|---|
| D1 | **CORS roto en los 9 webhooks del navegador.** `allowedOrigins` tenía una expresión `={{ $env.CORS_ORIGINS ... }}`, pero n8n no evalúa expresiones en ese campo: devolvía el texto crudo como header, cortado en la primera coma. Ningún origen coincidía, así que **el formulario público y la página de aceptación estaban rotos desde cualquier navegador real**. | `tests/escenarios.mjs` usa el `fetch` de Node, que no aplica CORS. Sólo se ve en un navegador. | Corregido |
| D2 | **El cliente veía un error al aceptar.** `Respond - Pagina Exito` no declaraba cuerpo: el webhook cerraba con 200 y **cuerpo vacío**. El front hace `response.json()`, que lanza excepción, y mostraba «No pudimos procesar tu solicitud» aunque la factura se hubiera emitido y enviado. El estado «¡Propuesta aceptada!» de la Figura 18(a) era **inalcanzable**. | Los tests verificaban el estado en la base, no el cuerpo de la respuesta. | Corregido |
| D3 | **Una notificación de Telegram tumbaba el flujo entero.** Los 13 nodos de Telegram no tenían `onError`; con `TELEGRAM_CHAT_ID` sin configurar, cada aceptación moría ahí. | Idem: el efecto en la base ya había ocurrido. | Corregido |
| D4 | **`schema.sql` no era idempotente al actualizar** una base existente, por dos motivos: `CREATE OR REPLACE VIEW` no admite cambiar las columnas de una vista, y el bloque de migraciones estaba al final, después de los índices que dependen de esas columnas. Contradecía lo que afirma `docs/modulo-pagos.md`. | `verificar_rls.mjs` aplicaba el esquema dos veces sobre una base **recién creada**, donde nunca hay una vista vieja que reemplazar. | Corregido, con un test nuevo que degrada la base y la migra |
| D5 | **La respuesta de `trabajo-estado` devolvía la expresión sin evaluar** (`"={{ $json.estado_trabajo }}"`), porque el `=` estaba dentro del JSON en vez de al principio del campo. | El front no lee ese campo. | Corregido |

Los cinco eran defectos reales del artefacto, no del documento. D1 y D2 son de severidad alta:
juntos dejaban inutilizables, desde un navegador, los dos flujos que ve el cliente.

**Deuda de robustez que se decidió NO cambiar:** tres nodos de Gmail que le escriben al cliente
(`Enviar Propuesta`, `Enviar Follow-up`, `Recordatorio Pago`) siguen sin `onError`, y al fallar
cortan las escrituras que van detrás. Es deliberado: marcar como «enviado» un correo que falló
sería peor que no marcarlo. La asimetría con Telegram —que sí es tolerante, porque es una
notificación interna— queda documentada.

### Lo que se cerró del lado documental

- **Tabla 12:** de 68 celdas `[registrar]` a 15. E1–E6 y E8–E10 tienen ahora valores de una
  corrida reproducible. Antes de llenarlas se detectó que **la suite probaba entradas distintas
  a las declaradas** (E1 usaba `ecommerce`/6000 contra `desarrollo_web`/5000 del documento; ambas
  dan 100 pero por aritmética distinta), así que se alineó la suite en vez de forzar el mapeo.
- **Anexo E:** las tres matrices de trazabilidad (5 objetivos, 11 RF, 7 RNF) quedaron completas,
  con lo no verificado identificado como tal.
- **Capítulo 5:** se reescribieron cuatro párrafos que ya eran inexactos **en contra del propio
  trabajo** — afirmaban que no había corrida documentada y que «el trabajo no dispone de pruebas
  funcionales automatizadas», cuando existen `scoring.js` (9240 casos), `verificar_rls.mjs` (24),
  `verificar_sql.mjs` y `verificar_afirmaciones.js`.
- **Cinco figuras de UI rehechas** (5, 6, 7, 17, 18): el sync con el repo del compañero cambió el
  frontend a un diseño claro y todas las capturas mostraban la versión anterior.

### Qué sigue sin poder verificarse

| Escenario | Por qué |
|---|---|
| **E7** (tablero en tiempo real, RNF6) | La tabla `leads` **no está en la publicación `supabase_realtime`** de la instancia. El script de medición no recibe ningún evento. Es configuración de la plataforma: hay que habilitar Realtime para esa tabla desde el panel de Supabase. **La funcionalidad de refresco en vivo del tablero hoy no funciona.** |
| **E11–E13** (procesos programados) | Hay que disparar los tres cron y registrar su salida. |
| **E14** (cobro real con MercadoPago) | Requiere credenciales de prueba de MercadoPago y una tarjeta de test. |
| **Figura 14** (correo de factura en Gmail) | Requiere un envío real desde la cuenta de Gmail configurada. |
| **S7** (incidente de credenciales) | Rotación de las claves de Supabase; requiere rol de administrador de ese proyecto. |

### Nota sobre la resolución de las figuras (B1)

Sigue vigente: **17 de 18 figuras están por debajo de los 300 ppi** que pide el protocolo para
calidad de impresión. Las cinco nuevas se generaron al máximo que permite la captura del
navegador y quedan en el mismo rango que las anteriores. Es un criterio formal de impresión, no
de comprensión.

---

## Actualización — plan de corrección ejecutado (21-ago-2026, mismo día)

Tras entregar la primera versión de este informe, se pidió corregir todo lo posible sin depender del
sistema en vivo. Se ejecutaron los puntos 1, 2 y parte del 3 del plan de la sección 16:

- **H2 (título) — resuelto.** La carátula decía "Automatización de Sistema de Tickets para
  Freelancers con n8n", sin relación con el sistema descrito. Se renombró a "Automatización del
  Ciclo de Vida del Cliente para Freelancers con n8n" (ya usado en el subtítulo y en el Resumen),
  y se propagó a `docs/guion-defensa-video.md`.
- **H1 y B2 (Figuras 9 y 10) — resueltas.** Se levantó una instancia de n8n **descartable y aislada**
  (contenedor y red propios, sin tocar el n8n real del usuario ni sus credenciales), se importó
  `workflow/crm_postgres.json` tal cual está en el repositorio, y se recapturaron ambas figuras
  directamente del lienzo. La Figura 10 ahora muestra el sticky note real del flujo —que ya decía
  correctamente "Pago (RAMA 8 · integración real con MercadoPago)"— con ambos caminos (modo de
  desarrollo y notificación real de MercadoPago) uno al lado del otro. La Figura 9 ahora muestra los
  tres nodos de MercadoPago (`Crear Preferencia`, `Resolver Link de Pago`) que antes faltaban, y de
  paso el enganche con el módulo de tickets, que tampoco se veía. Ambas leyendas se actualizaron.
- **H4 (Figura 14/15, plantilla del emisor) — resuelto en el código y en la Figura 15.** El nodo
  `Code - Generar Factura HTML` tenía hardcodeados los placeholders `[TU NOMBRE / EMPRESA]`,
  `[tu@email.com]` y `[Tu CBU / Alias / PayPal]` — el mismo defecto que ya se había detectado y
  corregido en los otros cinco templates de correo (que usan "SODEROS S.A."), pero que había quedado
  sin aplicar en la factura. Se corrigió el nodo. La Figura 15 (el placeholder "pendiente de
  regeneración") se generó de nuevo **ejecutando el HTML real del nodo ya corregido** contra el
  Gotenberg real del proyecto (con datos neutros: Cliente Demo 1, dominio ejemplo.com), no con un
  mockup. La Figura 14 en sí (captura de Gmail) sigue siendo la anterior — recapturarla exige enviar
  un correo real, que necesita credenciales de Gmail que esta sesión no tiene.
- **Bibliografía — 2 errores corregidos.** Verificación contra fuente primaria (Semantic Scholar API,
  dblp): "Moreira, F." → **"Moreira, S."** (Sílvia Moreira) y "Wu, J." → **"Wu, M."** (Migao Wu).
  Corregido en la lista de Referencias del `.docx`. De paso se corrigió el conteo: son **25**
  referencias, no 24 (error de esta misma auditoría, ya corregido abajo).

**Lo que sigue sin poder resolverse sin el usuario:**
- **H3 (Tablas de escenarios E1–E14 en `[registrar]`)** — exige `npm run test:escenarios` contra
  n8n + Supabase reales, con credenciales de Gmail/Telegram/Notion/MercadoPago que esta sesión no
  tiene y no debe pedir.
- **H5 (incidente de seguridad, claves de Supabase filtradas)** — exige rotar credenciales en un
  proyecto de Supabase de un tercero; fuera del alcance de lo que se puede hacer sin acceso a esa
  cuenta.
- La Figura 14 (captura de Gmail) puntual, por la misma razón que H3.

Con H1, H2 y H4 resueltos, las dos notas de la sección 16 se recalcularon — ver ahí el detalle.

---

## Bloque de metadatos

| Campo | Valor |
|---|---|
| Trabajo auditado | *Automatización de Sistema de Tickets para Freelancers con n8n* — Diseño e implementación de una plataforma web para la gestión automatizada del ciclo de vida del cliente |
| Institución | Universidad Tecnológica Nacional, Facultad Regional Mendoza — Tecnicatura Universitaria en Programación |
| Autores | Mateo Morgui, Tobías Rivas |
| Director | Alberto Cortez |
| Extensión | ≈25.400 palabras totales (≈14.900 en el cuerpo Cap. 1–8) · ≈92 páginas estimadas · 18 figuras declaradas (18 presentes tras esta revisión) · 21 tablas · **25** referencias |
| Marco de evaluación aplicado | `prompt-maestro-reconstruido.md` (protocolo adversarial de 17 pasos, 16 secciones de salida) |
| Fecha del informe | 21 de agosto de 2026 (con correcciones aplicadas el mismo día — ver "Actualización" arriba) |
| Hallazgos por severidad (tras la segunda pasada) | 0 críticos · 1 alto · 3 medios · 3 bajos |
| Puntaje global — **nota honesta** | **≈ 8,8 / 10** *(7,5 → 8,2 → 8,8 a lo largo de las tres pasadas)* |
| Puntaje global — **sin inspección de imágenes** | **≈ 8,8 / 10** *(la brecha desapareció: las figuras ya no ocultan nada)* |
| Índice de calidad de escritura | 7,3 / 10 |
| Dictamen | **Aprobada con observaciones menores** *(sube desde «observaciones mayores»)* |

---

## 1. Encuadre y alcance de la auditoría

**Criterio aplicado.** El protocolo de `prompt-maestro-reconstruido.md`: auditoría adversarial que
busca deliberadamente debilidades, no un balance objetivo de aciertos/errores. Una afirmación no
verificable se marca como tal y no computa como error.

**Procedimiento ejecutado.**
1. Verificación bibliográfica de las 24 referencias contra fuentes primarias en línea (DOI, páginas
   de editor, dblp) — delegada a un subagente con acceso a búsqueda web; resultado en la sección 4.
2. Análisis cuantitativo del cuerpo del documento (Cap. 1 a 8, ≈14.909 palabras, 568 oraciones
   estimadas) con métricas de nominalización, voz pasiva/impersonal, densidad de conectores, léxico
   vago, longitud oracional y repeticiones literales.
3. **Inspección técnica real de las figuras**: se extrajeron las 17 imágenes embebidas del `.docx` y
   se midió su resolución en píxeles y su ppi efectivo (según el tamaño mostrado en el documento, no
   los metadatos del archivo). Además, **se visualizaron las 17 imágenes una por una** y se
   contrastó su contenido contra lo que el texto afirma que muestran.
4. Verificación de coherencia interna: cotejo de las cifras y afirmaciones de cada capítulo contra el
   resto del documento, y de las citas cruzadas ("véase Figura X", "§Y.Z") contra su destino real.
5. Contraste técnico contra el propio artefacto (workflow, esquema, tests) para las afirmaciones
   verificables — se aprovechó el conocimiento adquirido en esta misma sesión sobre el repositorio.

**Limitaciones declaradas de esta auditoría (obligatorio, protocolo §6):**
- No se auditó similitud/plagio ni formato de carácter fino (tipografías, sangrías) del `.docx`.
- No se accedió a ninguna instancia en vivo (n8n, Supabase, MercadoPago): las afirmaciones sobre
  comportamiento en producción se verifican contra el código fuente y los tests del repositorio, no
  contra una ejecución real.
- El análisis cuantitativo de texto (nominalizaciones, conectores, longitud oracional) usa heurísticas
  de expresiones regulares sobre español, no un parser lingüístico — se declara como aproximación, no
  como medición de precisión garantizada.
- La verificación bibliográfica depende de que las fuentes web consultadas estén vigentes al momento
  de la corrida (21-ago-2026); un DOI o una página de precios pueden cambiar después.
- Esta es una auditoría de un solo evaluador (LLM), sin panel ni segunda opinión ciega — el propio
  documento audita señala la misma amenaza a la validez para su propia validación (§3.7), y aplica
  simétricamente aquí.

**Por qué dos notas.** El usuario pidió explícitamente separar (a) la nota que resulta de una
auditoría completa, con las imágenes efectivamente inspeccionadas, de (b) la nota que resultaría si
esa inspección no hubiera sido posible. La diferencia importa porque **dos de los hallazgos más
severos de este informe (H1 y H4) solo son detectables mirando las imágenes**, no leyendo el texto:
un tribunal que las mire (todos lo hacen) encuentra lo mismo que esta auditoría. La nota "sin
imágenes" no es más alta porque el documento sea mejor sin ellas: es más alta porque esconde
problemas reales. Ver la sección 16 para el detalle del cálculo.

---

## 2. Evaluación por capítulo

Cinco ejes por capítulo (Coherencia · Profundidad científica · Calidad académica · Coherencia interna
· Calidad de redacción), 0–10, promediados.

| Capítulo | Coh. | Prof. | Cal. acad. | Coh. int. | Redacción | **Promedio** |
|---|---|---|---|---|---|---|
| Portada y front matter | 6 | — | 8 | 6 | 9 | **7,3** *(ver H1)* |
| Cap. 1 Introducción | 9 | 8 | 9 | 8 | 8 | **8,4** |
| Cap. 2 Marco Teórico | 9 | 9 | 9 | 9 | 9 | **9,0** |
| Cap. 3 Marco Metodológico | 9 | 8 | 9 | 8 | 8 | **8,4** |
| Cap. 4 Diseño y Desarrollo | 9 | 9 | 9 | **6** *(ver H2)* | 8 | **8,2** |
| Cap. 5 Resultados y Validación | 6 | 5 | 8 | **3** *(ver H3)* | 8 | **6,0** |
| Cap. 6 Discusión | 9 | 9 | 9 | 9 | 9 | **9,0** |
| Cap. 7 Conclusiones | 9 | 8 | 9 | 8 | 8 | **8,4** |
| Cap. 8 Trabajos Futuros | 8 | 8 | 8 | 8 | 8 | **8,0** |
| Referencias y formato | 7 | — | 8 | 8 | — | **7,7** *(sujeto a §4)* |

*Nota sobre Cap. 5: la calidad académica (8) refleja que el capítulo es honesto y metodológicamente
correcto sobre lo que le falta — es precisamente esa honestidad la que hunde la coherencia interna
(3): el propio capítulo declara que sus resultados no están confirmados.*

---

## 3. Revisión metodológica consolidada (17 elementos)

| Elemento | Estado | Detalle |
|---|---|---|
| Tipo de investigación | **Presente** | Desarrollo tecnológico aplicado (§3.1), explícito y justificado. |
| Paradigma | **Presente** | "Pragmático-ingenieril" (§3.1). |
| Enfoque | **Presente** | Cualitativo-descriptivo con indicadores puntuales de ejecución. |
| Diseño | **Presente** | Iterativo-incremental, 5 incrementos funcionales delimitados (§3.2). |
| Población | **Ausente, declarado** | §3.3 declara explícitamente que no se define población — no hay estudio con usuarios. |
| Muestra | **Ausente, declarado** | Idem. |
| Muestreo | **Ausente, declarado** | Idem; no aplica dada la naturaleza del trabajo. |
| Variables | **Parcial** | Las del scoring están operacionalizadas (Tabla 5); la del objetivo general ("carga administrativa") se declara explícitamente NO operacionalizada, con una definición propuesta para trabajo futuro (§1.5). |
| Categorías | **Presente** | HOT/WARM/COLD; estados del lead y del trabajo (Tabla 9). |
| Instrumentos | **Parcial** | Protocolo de ejecución (Tabla 4) detallado; no hay instrumento de relevamiento primario (encuesta/entrevista), declarado como limitación (§3.3). |
| Validez | **Parcial, declarada** | "De diseño y no empírica" para el scoring (§3.1, §6). Tres amenazas a la validez declaradas explícitamente (§3.7). |
| Confiabilidad | **Ausente, declarado** | El propio Cap. 5 declara: "no puede establecerse repetibilidad" — los 13 escenarios se corrieron una sola vez sin registro de valores. |
| Protocolo | **Presente** | Tabla 4, exhaustivo (entorno, repeticiones, criterio de fallo, reejecución tras corrección). |
| Análisis estadístico | **No aplica, declarado** | El trabajo no formula hipótesis en sentido estadístico (§3.1). |
| Análisis cualitativo | **Presente, limitado** | Análisis documental de tres fuentes (§3.3); sin codificación formal ni criterio de saturación, declarado. |
| Amenazas a la validez | **Presente** | §3.7: sesgo del evaluador, selección de datos de prueba, validez externa nula sobre conversión comercial. |
| Limitaciones | **Presente, extenso** | §1.7, §6.2, Cap. 8 — probablemente la sección más completa de todo el documento. |

**Lectura de conjunto:** para un trabajo de *desarrollo tecnológico aplicado* (no un estudio empírico
con muestra), el patrón "ausente pero declarado explícitamente" en población/muestra/muestreo es
correcto y no debería penalizarse como si fuera un estudio empírico fallido — el propio documento lo
encuadra bien en §3.1. Lo que sí pesa en contra es la fila **Confiabilidad**: no es que no aplique,
es que el trabajo se propuso acreditarla (Tabla 4) y hoy no puede.

---

## 4. Revisión bibliográfica

Verificación delegada a un subagente con búsqueda web sobre las **25** referencias (paragraphs
456–480 del `.docx`; la cuenta de "24" de la primera versión de este informe fue un error de conteo
de esta misma auditoría, ya corregido en el bloque de metadatos).

**Resultado: 7 verificadas sin objeción, 2 con error (corregidos en el `.docx`), 1 parcialmente
verificada, 15 no auditadas individualmente en esta pasada** (6 libros de texto y 9 páginas de
documentación/producto sin DOI — no se buscaron una por una; no se reportan como limpias, se reportan
como no auditadas).

| # | Entrada | Estado |
|---|---|---|
| 1 | American Psychological Association (2020) | Verificada |
| 2 | Bucaioni, Cicchetti & Ciccozzi (2022) | Verificada |
| 3 | Fielding (2000) | No verificable (fetch sin contenido) |
| 4–5, 10, 19–21 | Fowler; Hohpe & Woolf; Kotler & Armstrong; Pressman & Maxim; Richardson; Sommerville | No auditadas (libros sin DOI) |
| 6, 11, 17, 22–23 | HubSpot; Make; Pipedrive; Supabase; Vercel/Next.js | No auditadas (doc./producto de proveedor) |
| 7 | ISO/IEC 25010:2023 | Verificada |
| 8 | Järvinen & Taiminen (2016) | Verificada |
| 9 | Kässi & Lehdonvirta (2018) | Verificada |
| 12 | Mero, Tarkiainen & Tobon (2020) | Verificada |
| 13 | **Moreira et al. (2025)** | **Corregido**: "Moreira, F." → "Moreira, S." (Sílvia Moreira) |
| 14, 18 | n8n; PostgreSQL Global Development Group | No auditadas (documentación de proveedor) |
| 15 | Organización Internacional del Trabajo (2025) | Parcialmente verificada (URL resuelve a un PDF real de ~2,3 MB; no se pudo extraer el texto interno) |
| 16 | OWASP Foundation (2025) | Verificada |
| 24 | **Wu, Andreev & Benyoucef (2023)** | **Corregido**: "Wu, J." → "Wu, M." (Migao Wu), confirmado por la API de Semantic Scholar (JSON estructurado) |

**Detalle de los dos errores corregidos:**
- **Moreira**: dblp (`dblp.org/rec/journals/access/MoreiraM024.html`) y una búsqueda independiente
  coinciden en "Sílvia Moreira" como primera autora; ninguna fuente consultada devolvió "F. Moreira".
  Confianza alta pero indirecta (el fetch directo al artículo específico falló con `ECONNRESET`).
- **Wu**: fetch directo a `api.semanticscholar.org` para el DOI de la referencia devolvió
  `authors: ["Migao Wu", "P. Andreev", "Morad Benyoucef"]`. Confianza alta y directa (dato
  estructurado, no síntesis).

**Métricas:**
- Antigüedad (base 2026): 44 % de los últimos 3 años (2024–2026), 56 % de los últimos 5 años
  (2022–2026).
- Por tipo de fuente: 6 artículos arbitrados · 2 normas técnicas · 1 manual de estilo editorial (APA)
  · 1 informe institucional (OIT) · 1 tesis doctoral (Fielding) · 4 documentación técnica de
  proveedor · 4 páginas comerciales de precios (declaradas como tales en §2.7) · 6 libros.
- APA 7.ª ed.: orden alfabético correcto en las 25; DOI en formato URL correcto en las 7 que lo
  llevan; mayúsculas de título sin anomalías (la única variación, en ISO/IEC 25010:2023, reproduce
  fielmente el título oficial de la norma); "Recuperado el [fecha], de [URL]" presente en las 9
  fuentes web sin fecha de publicación propia, que es el uso correcto de APA 7 para ese caso.

**Observación adicional, sin depender de la verificación externa:**
- Fecha de corte declarada del corpus: la mayoría de las páginas de proveedor (HubSpot, Pipedrive,
  Zapier, Make, n8n, Supabase, Vercel, PostgreSQL) se marcan "Recuperado el 17 de agosto de 2026" —
  consistente entre sí y con la fecha de las estimaciones de costo del Capítulo 6.
- Mezcla de fuentes: 8 arbitradas/técnicas con DOI o ISBN de editorial reconocida (Bucaioni et al.
  2022, Fielding 2000, Järvinen y Taiminen 2016, Kässi y Lehdonvirta 2018, Mero et al. 2020, Moreira
  et al. 2025, Wu et al. 2023, más los libros de Fowler/Hohpe-Woolf/Pressman/Richardson/Sommerville),
  4 páginas comerciales de precios (HubSpot, Pipedrive, Zapier, Make) explícitamente declaradas como
  tales en §2.7 ("las fuentes de la comparación son las de los propios evaluados"), y el resto,
  documentación técnica oficial de las herramientas usadas. Es una composición razonable para un
  trabajo de este tipo, y la naturaleza de cada fuente está declarada, no oculta.
- Todas las entradas de la lista tienen correspondencia en el cuerpo del texto (se verificó por
  búsqueda de cada apellido/organización citante durante la lectura completa del documento en esta
  sesión) — a diferencia del dictamen v4, que había encontrado cuatro referencias huérfanas
  (HubSpot, Pipedrive, Zapier, Make sin cita `(Autor, año)` en el cuerpo); ese hallazgo aparece
  resuelto: las cuatro se citan explícitamente en §2.7.

---

## 5. Revisión de tablas

21 tablas (índice propio del documento hasta la Tabla 21, en Anexo D/E/F/G). Contra los 10 criterios
del protocolo (numeración, título, fuente, calidad visual, alineación, consistencia, legibilidad,
relación con el texto, explicación, referencias):

- **Numeración y título:** consistentes, correlativos, todas citadas desde el cuerpo por número.
- **Fuente:** todas llevan nota "Elaboración propia a partir de [archivo concreto del repositorio]" —
  superior a la práctica habitual de solo decir "elaboración propia".
- **Consistencia con el código:** se verificaron contra el repositorio actual (esta sesión corrió
  `npm run test:afirmaciones`, que recalcula automáticamente varias de estas cifras): coinciden
  exactamente (141 nodos funcionales, 157 total, 12 webhooks, 5 tablas, 2 vistas, 7 enums, umbrales
  70/40). La Tabla 15 (composición por tipo de nodo) también coincide con el conteo real del flujo.
- **Relación con el texto y explicación:** alta — cada tabla se referencia y se glosa en prosa antes o
  después de aparecer.
- **Hallazgo (H5, medio):** las Tablas 12, 17, 18 y 19 (escenarios E1–E14, matriz de trazabilidad OE,
  RF y RNF) tienen la mayoría de sus celdas de resultado en `[registrar]` — no es un defecto de la
  tabla en sí (están bien diseñadas, con columnas correctas), sino que documentan honestamente una
  tarea pendiente. Vale como hallazgo porque una tabla con datos de resultado vacíos, presentada como
  el capítulo de resultados, es lo que un tribunal notará primero.

---

## 6. Revisión de figuras

12 criterios del protocolo, aplicados a las 17 figuras presentes (más la 18ª, con placeholder
explícito).

### 6.1 Resolución (medida real, no declarada)

Se extrajeron las 17 imágenes y se calculó el ppi efectivo = píxeles del archivo ÷ tamaño mostrado en
el documento (en pulgadas). Umbral del protocolo: 300 ppi para calidad de impresión.

| Figura | Resolución (px) | Tamaño mostrado | ppi efectivo | ¿≥300 ppi? |
|---|---|---|---|---|
| 1 | 1700×1720 | 6,00×6,07 in | 283 | No |
| 2 | 1693×1230 | 5,98×4,35 in | 283 | No |
| 3 | 1798×1145 | 5,98×3,81 in | **300** | Sí (límite) |
| 4 | 1687×1382 | 5,98×4,90 in | 282 | No |
| 5 | 928×1922 | 5,12×10,60 in | 181 | No |
| 6 | 1010×820 | 5,91×4,79 in | 171 | No |
| 7 | 879×778 | 4,72×4,18 in | 186 | No |
| 8 | 1600×185 | 6,10×0,71 in | 262 | No |
| 9 | 1330×288 | 6,10×1,32 in | 218 | No |
| 10 | 796×361 | 5,31×2,41 in | 150 | No |
| 11 | 1068×201 | 6,10×1,15 in | 175 | No |
| 12 | 1206×420 | 6,10×2,13 in | 198 | No |
| 13 | 603×606 | 4,02×4,04 in | 150 | No |
| 14 | 559×293 | 3,73×1,95 in | 150 | No |
| 16 | 793×137 | 5,29×0,91 in | 150 | No |
| 17 | 538×131 | 3,54×0,86 in | 152 | No |
| 18 | 1594×1242 | 6,00×4,68 in | 266 | No |

**Hallazgo (B1, bajo):** 16 de 17 figuras están por debajo del umbral de 300 ppi que exige el
protocolo para calidad de impresión; varias capturas de pantalla (10, 13, 14, 16) rondan 150 ppi. En
pantalla se ven nítidas (son capturas a la resolución nativa del dispositivo); impresas a tamaño
completo se verían borrosas. Severidad baja: es un criterio formal de impresión, no de comprensión —
ningún jurado va a imprimir la tesis a página completa para verificar esto, pero es un hallazgo
correcto del protocolo y se documenta como tal.

### 6.2 Elaboración propia vs. capturas — correctamente declarado

Las Figuras 1–4 se declaran "Elaboración propia a partir de [archivo]" y efectivamente son diagramas
originales (arquitectura en 3 capas, diagrama entidad-relación, máquinas de estados, diagrama de
secuencia) de calidad profesional, bien etiquetados, legibles, con leyenda. Las Figuras 5–18 se
declaran "Captura propia" y efectivamente son capturas de pantalla reales de la aplicación o del
lienzo de n8n. No hay ninguna figura mal clasificada en esta dimensión.

### 6.3 Correspondencia entre lo declarado y lo que la figura muestra — **el hallazgo más serio de la primera pasada de esta auditoría, ya resuelto**

> **Resuelto (21-ago-2026, mismo día).** Las Figuras 9 y 10 se recapturaron desde una instancia de
> n8n descartable con el workflow actual importado. Se deja el detalle original de abajo porque
> documenta el método y porque es la evidencia de por qué el hallazgo era real, no una sospecha.

**H1 (era Crítico, C-1 — resuelto).** §4.3.3 citaba la **Figura 10** como evidencia del flujo de pago con MercadoPago:
*"el sistema no falla: cae a un modo de desarrollo declarado, en el que el enlace de la factura es
GET /webhook/pago-confirmado, el mismo endpoint que documentaban versiones anteriores de este
apartado (**Figura 10**, véase Anexo A)"*. Se inspeccionó la Figura 10 directamente: es una captura
del lienzo de n8n con el título propio del sticky note **"RAMA 8 · Pago simulado"** y la leyenda "El
link del PDF marca la factura COBRADA + Telegram. Idempotente" — muestra el flujo **anterior a
MercadoPago**, de un solo camino (`Webhook - Pago Simulado → Code - Validar Pago → Postgres - Marcar
Cobrado → IF → Telegram/Notion`). No aparece ningún nodo de los que el propio §4.3.3 describe como
parte del flujo actual (`Crear Preferencia MP`, `Obtener Pago MP`, `Procesar Pago MP`, `Marcar
Cobrado MP`, el webhook `POST /mp/notificacion`). La leyenda de la propia figura ("Flujo de
confirmación de **pago simulado**") tampoco fue actualizada.

**Impacto:** es exactamente el patrón que el dictamen v5 original señalaba en su eje C ("evidencia
visual que no corresponde a lo declarado... en la Fig. 10") — y sigue sin resolverse, porque requiere
volver a capturar el lienzo de n8n desde una instancia real con la rama de MercadoPago importada, algo
que no se puede hacer sin el sistema levantado.

**H4 (Medio, M-1).** La **Figura 14** (correo de envío de factura) muestra, en la miniatura del PDF
adjunto visible dentro de la captura, el texto sin reemplazar **"[TU NOMBRE / EMPRESA]"** en la
plantilla del emisor. La Figura 15 —adyacente, del mismo comprobante— fue retirada explícitamente por
el propio documento por este motivo exacto (nota de la Figura 15: *"la plantilla del emisor sin
configurar —«[TU NOMBRE / EMPRESA]»...— [...] no podía seguirse de punta a punta"*), pero el mismo
defecto quedó sin corregir en la Figura 14, más pequeña y menos notoria, que sí sigue en el documento.

**B2 (Bajo).** La **Figura 9** (aceptación y facturación, RAMA 2) tampoco muestra los nodos que
§4.3.2/§4.3.3 describen como parte de la aceptación (`Crear Preferencia MP`, `Resolver Link de Pago`)
— a diferencia de la Figura 10, acá la severidad es baja porque el texto de §4.3.2 no cita
explícitamente esta figura como evidencia de esos nodos (los describe en el párrafo de §4.3.3, sin
remitir a una figura concreta para esa parte), así que no hay una afirmación textual que la figura
contradiga directamente — pero sigue siendo una captura desactualizada del estado real del flujo.

### 6.4 Figuras faltantes / pendientes

- **Figura 15** (comprobante en PDF): reemplazada por un placeholder explícito
  `[ Figura 15 — pendiente de regeneración ]`, con la justificación completa en el texto. Es el
  patrón correcto para un dato pendiente — visible, no oculto.
- **Figura 12** (procesos programados) declara en su propia nota que el tercer proceso (reporte
  diario) no está documentado en la captura.
- Ninguna figura falta sin explicación.

### 6.5 Consistencia gráfica y legibilidad

Las Figuras 1–4 (diagramas propios) son consistentes entre sí en tipografía y estilo. Las capturas de
n8n (8–12) usan los colores por defecto de cada rama del lienzo (fondo verde/rojo/violeta/morado),
sin un criterio unificado — es un detalle menor, no un hallazgo per se, dado que son capturas
directas de una herramienta externa y no diagramas de autoría propia.

---

## 7. Revisión técnica (Ingeniería/Informática)

| Elemento | Presente | Observación |
|---|---|---|
| Diagrama de arquitectura | Sí | Figura 1, en tres capas, de elaboración propia y de calidad alta. |
| Diagrama entidad-relación | Sí | Figura 2, completo con tipos, claves y restricciones. |
| Diagrama de secuencia | Sí | Figura 4, con la frontera transaccional marcada explícitamente. |
| Máquinas de estados | Sí | Figura 3, dos máquinas (comercial y de ejecución) con su invariante declarado. |
| UML formal / notación C4 | No | Los diagramas son esquemáticos, no UML estándar ni C4 — aceptable para el nivel del trabajo, no exigible en un TUP. |
| BPMN | No | No se usa notación BPMN estándar para los flujos de negocio; se documentan en prosa y en tablas (Tabla 14). No es un defecto grave dado que el propio flujo exportado (JSON de n8n) es la fuente de verdad ejecutable. |
| Patrones de diseño nombrados | Sí | Arquitectura orientada a eventos (Hohpe y Woolf), BaaS, defensa en profundidad, degradación defensiva — todos nombrados y justificados con literatura. |
| Consistencia arquitectura↔evidencia | **Parcial** | Ver H1/B2 — la arquitectura general (Figura 1) sí coincide con el código; dos figuras de flujo específicas no. |
| Terminología de licencias | Sí, y con matiz correcto | §2.2 distingue explícitamente que n8n es "fair-code", no open source en sentido estricto de la OSI — un matiz que muchos trabajos pasan por alto. |
| Dependencias no declaradas | No se detectaron | Las herramientas y versiones de la Tabla 3 coinciden con `package.json` / `docker-compose.yml` reales del repositorio (verificado en esta sesión). |

---

## 8. Revisión de resultados

- **¿Responden a los objetivos?** Sí, están trazados objetivo por objetivo (Anexo E, Tabla 17), pero
  la columna "Resultado" de esa misma tabla está en `[registrar tras la reejecución]` para 4 de los 5
  objetivos específicos.
- **¿Poseen suficiente evidencia?** No, todavía no. El propio Capítulo 5 lo declara sin rodeos: *"no
  puede establecerse repetibilidad"*. Es la brecha más grande del documento completo.
- **¿Están correctamente interpretados / hay sobreinterpretación?** No se detectó sobreinterpretación
  — al contrario, el documento es inusualmente cuidadoso en no afirmar más de lo que puede sostener
  (ver Cap. 7: "queda sugerido, pero no demostrado...").
- **¿Hay afirmaciones no sustentadas?** Una: el resumen ejecutivo y la Tabla 12 fueron corridos
  *"de forma informal... sin registro documentado"* según el propio Cap. 5, así que cualquier
  afirmación de que "los trece escenarios funcionaron" descansa en memoria de los autores, no en
  evidencia archivada — y el documento lo dice así, en vez de ocultarlo.

---

## 9. Revisión de la discusión

Cumple con creces el estándar del protocolo de "discusión crítica, no meramente descriptiva":
contrasta contra la literatura citada (§6, primer párrafo), cuantifica el argumento de costo con
supuestos declarados (Tabla 13) en vez de darlo por sentado, y dedica una subsección completa (§6.2)
a limitaciones "que comprometen las afirmaciones del trabajo" — una autocrítica que la mayoría de las
tesis de grado no incluye. Score alto, sin reservas.

---

## 10. Revisión de las conclusiones

Responden a los objetivos uno por uno, distinguen explícitamente demostrado/sugerido/no demostrado, no
introducen resultados ni bibliografía nueva, no repiten literalmente los resultados (los reformulan en
términos de qué se puede afirmar). La sección "7.1 Aprendizajes del proceso" es un valor agregado poco
habitual: cuatro lecciones concretas, ancladas en errores reales del propio proceso de desarrollo
(incluida la lección directamente relacionada con H1: *"las decisiones etiquetadas como 'provisorias'
deben revisarse con el mismo criterio que las definitivas"*, en referencia al pago simulado).

---

## 11. Revisión de anexos y reproducibilidad

| Anexo | Contenido | Reproducibilidad |
|---|---|---|
| A. Evidencias visuales | 17 figuras + 1 placeholder | Parcial — ver H1/H4/B1/B2. |
| B. Flujos de n8n | Composición por tipo de nodo y por proceso (Tablas 15–16) | Total — coincide con el JSON real del repositorio. |
| C. Seguridad a nivel de fila | Fragmento de `db/schema.sql` reproducido | Total — y **verificado ejecutablemente** por este mismo repositorio (`npm run test:rls`, 24 casos OK contra un Postgres real). |
| D. Contrato de datos del formulario | Tabla 18 (campos, tipos, normalización) | Total. |
| E. Matriz de trazabilidad | OE / RF / RNF → escenario → resultado | Parcial — columnas de resultado en `[registrar]`. |
| F. DDL completo | — | No verificado en esta pasada (no se leyó el Anexo F completo); referenciado consistentemente desde el cuerpo. |
| G. Puesta en marcha del entorno | — | No verificado en esta pasada. |

**Veredicto de reproducibilidad: parcial.** El artefacto (código, esquema, workflow) es totalmente
reproducible y, de hecho, **más verificado de lo que el propio documento afirma**: el repositorio
tiene una suite de tests (`npm test`, `npm run test:docker`) que ni siquiera se menciona en el cuerpo
del `.docx` — es una discrepancia a favor del trabajo, no en contra, pero vale la pena señalarla:
`docs/verificacion-y-seguridad.md` documenta esta suite y no está citada desde la tesis.

---

## 12. Auditoría de calidad de escritura científica

Métricas calculadas sobre el cuerpo (Cap. 1–8, 14.909 palabras, 568 oraciones estimadas):

| Métrica | Medido | Umbral del protocolo | Lectura |
|---|---|---|---|
| Longitud oracional promedio | 26,2 palabras | 20–25 recomendado | Levemente por encima; aceptable. |
| Oraciones > 35 palabras | 26,2 % | Alerta | Uno de cada cuatro oraciones es larga. |
| Oraciones > 50 palabras | 9,9 % | Alerta crítica | Una de cada diez oraciones es crítica; la más larga tiene 122 palabras. |
| Nominalizaciones (-ción/-miento/-ización/-idad) | 5,67 cada 100 palabras | Alerta > 4 | Por encima del umbral — estilo denso, típico de prosa académica pero perfectible. |
| Léxico vago ("algunos", "adecuado", "razonable"...) | 0,05 cada 100 palabras | — | **Fortaleza**: precisión léxica alta, casi no hay relleno impreciso. |
| Conectores lógicos explícitos | 0,11 por oración | 0,25–0,35 esperado | Por debajo de lo esperado — bajo esta heurística de lista de conectores; nótese que el documento logra cohesión por otros medios (referencias cruzadas explícitas "§X.Y", numeración de hallazgos), así que esta métrica aislada puede subestimar la cohesión real. |
| Voz impersonal con "se" | 32,6 por 100 oraciones | — | Alto, pero es el registro esperado y convencional del español académico (no es "voz pasiva" penalizable como en inglés). |
| Repeticiones literales de 6 palabras | 252 fragmentos, mayoría boilerplate de notas de figura/tabla ("Nota. Elaboración propia a partir de...") | — | No es un hallazgo real: son leyendas estandarizadas, prácticas de estilo consistente, no plagio interno del argumento. |

**Puntuación de calidad de escritura (0–10, promedio de siete ejes):** voz activa/impersonal
adecuada al registro (8) · claridad (7) · precisión (8, por el bajo léxico vago) · concisión (6, por
las oraciones largas) · fluidez (7) · coherencia discursiva (8, por las referencias cruzadas
explícitas) · estilo científico (8). **Promedio: 7,3/10.**

**Hallazgo (B3, bajo):** las oraciones de más de 50 palabras concentran información importante (p. ej.
la definición de la delimitación del objetivo general, §1.5) en una única oración subordinada varias
veces — dividirlas mejoraría la legibilidad sin perder contenido.

---

## 13. Tabla de riesgos de rechazo

Un hallazgo "Crítico" es aquel capaz por sí solo de motivar una observación mayor del tribunal o
comprometer la validez de un capítulo completo.

| ID | Severidad | Capítulo | Problema detectado | Impacto | Estado |
|---|---|---|---|---|---|
| ~~H1~~ | ~~Crítico~~ | Cap. 4 / Anexo A | La Figura 10 mostraba el flujo viejo ("RAMA 8 · Pago simulado") en vez del real con MercadoPago | Evidencia que contradecía al texto que la cita | **Resuelto.** Recapturada desde n8n con el workflow actual. |
| ~~H2~~ | ~~Crítico~~ | Portada | El título ("Sistema de Tickets para Freelancers") no correspondía al CRM descrito | Primera impresión desalineada con el resto del documento | **Resuelto.** Renombrado a "Automatización del Ciclo de Vida del Cliente para Freelancers con n8n". |
| **H3** | Alto | Cap. 5 / Anexo E | La mayoría de las celdas de resultado de la validación funcional están en `[registrar]`; el propio capítulo declara que no hay repetibilidad establecida | Si se defiende hoy, no hay evidencia archivada que respalde "el sistema funciona", solo la afirmación de los autores | **Abierto.** Necesita `npm run test:escenarios` contra el sistema real con credenciales del usuario — fuera del alcance de esta sesión. |
| ~~H4~~ | ~~Medio~~ | Anexo A | La Figura 14 mostraba `[TU NOMBRE / EMPRESA]` sin completar — mismo defecto por el que se había retirado la Figura 15 | Inconsistencia entre figuras adyacentes | **Resuelto en el origen.** El nodo `Code - Generar Factura HTML` ya usa "SODEROS S.A." (igual que los otros 5 templates). Figura 15 regenerada con el HTML real vía Gotenberg. Figura 14 (captura de Gmail) sigue pendiente: exige enviar un correo real. |
| **H5** | Alto | Cap. 6 | Incidente de seguridad abierto (claves de Supabase filtradas por canal inseguro), declarado como "preferentemente antes de la defensa" y todavía sin resolver | Pregunta previsible del tribunal con respuesta desfavorable si no se cierra | **Abierto.** Requiere acceso a un proyecto de Supabase de un tercero — fuera del alcance de esta sesión. |
| ~~A1~~ | ~~Alto~~ | Referencias | "Moreira, F." y "Wu, J." — iniciales de autor incorrectas | Cita técnicamente inexacta | **Resuelto.** Verificado contra Semantic Scholar/dblp y corregido a "Moreira, S." y "Wu, M." |
| M1 | Medio | Cap. 4 §4.3.1 | Tres de nueve valores ponderados del scoring son inalcanzables desde el formulario público | El propio documento ya lo declara y lo prioriza en Trabajos Futuros — hallazgo ya mitigado por autocrítica | Sin acción adicional; ya está bien encuadrado |
| M2 | Medio | Cap. 4 §4.6 | Siete de doce webhooks sin autenticación de origen | Declarado, priorizado como acción #1 de Cap. 8 | Sin acción adicional |
| B1 | Bajo | Anexo A | 16 de 17 figuras originales por debajo de 300 ppi de resolución efectiva | Formal, no de comprensión | Opcional: recapturar a mayor resolución si se imprime |
| ~~B2~~ | ~~Bajo~~ | Anexo A | Figura 9 no mostraba los nodos de MercadoPago | Menor | **Resuelto** junto con H1. |
| B3 | Bajo | General | 9,9 % de oraciones superan las 50 palabras | Legibilidad | Dividir las oraciones más largas en la revisión final |

---

## 14. Calificación por capítulo (ponderada)

| Capítulo | Peso | Nota | Ponderado |
|---|---|---|---|
| Portada / front matter | 6 % | 7,3 | 0,44 |
| Cap. 1 Introducción | 8 % | 8,4 | 0,67 |
| Cap. 2 Marco Teórico | 9 % | 9,0 | 0,81 |
| Cap. 3 Marco Metodológico | 9 % | 8,4 | 0,76 |
| Cap. 4 Diseño y Desarrollo | 28 % | 8,2 | 2,30 |
| Cap. 5 Resultados y Validación | 14 % | 6,0 | 0,84 |
| Cap. 6 Discusión | 12 % | 9,0 | 1,08 |
| Cap. 7 Conclusiones | 8 % | 8,4 | 0,67 |
| Cap. 8 Trabajos Futuros | 6 % | 8,0 | 0,48 |
| **Total** | **100 %** | | **≈ 8,05** |

Este es el puntaje ponderado por capítulo **antes** de aplicar el ajuste global de la sección 16, que
tiene en cuenta que H1 y H2 son hallazgos transversales (afectan la credibilidad general del
documento, no solo el capítulo donde se detectan).

---

## 15. Calificación global

**Fortalezas principales (con evidencia):**
1. Honestidad metodológica excepcional: el objetivo general fue reformulado con una explicación
   documentada de por qué (§1.5), hay una sección entera dedicada a limitaciones que "comprometen las
   afirmaciones del trabajo" (§6.2), y un incidente de seguridad se declara como tal en vez de
   esconderse (§6.3).
2. Verificabilidad real: los números que la tesis afirma (nodos, webhooks, umbrales) coinciden
   exactamente con lo que el repositorio produce hoy — se confirmó ejecutando la suite de tests del
   propio proyecto durante esta auditoría, no solo leyendo el texto.
3. El pago pasó de simulado a real (MercadoPago, verificado contra la API del proveedor antes de
   confirmar cualquier cobro) — resuelve una de las críticas centrales del dictamen v5 original.
4. La RLS, criticada en v5 por "no estar probada", ahora se verifica con 24 casos ejecutables contra
   un PostgreSQL real (`npm run test:rls`), no solo declarada en el script.
5. Autocrítica de proceso genuina en "Aprendizajes" (§7.1) — cuatro lecciones concretas, no genéricas.

**Debilidades principales (con evidencia):**
1. Dos figuras del Anexo A (10 y, en menor medida, 9) muestran un estado del sistema anterior al
   descrito en el texto que las cita (H1, B2).
2. El título no corresponde al contenido (H2).
3. El capítulo de resultados está honestamente incompleto: la evidencia de las corridas todavía no
   existe (H3).
4. Persiste un incidente de seguridad abierto y sin resolver, con recomendación propia de cerrarlo
   antes de la defensa (H5).

**Riesgos para la defensa:**

| Pregunta previsible | Respuesta disponible hoy | Hallazgo asociado |
|---|---|---|
| "¿Los resultados del Capítulo 5 están confirmados?" | No — el propio capítulo lo dice | H3 (abierto) |
| "¿Rotaron las claves filtradas de Supabase?" | Según el documento, no todavía | H5 (abierto) |
| "¿Cómo se calcula el umbral de scoring de 300 dólares?" | Sí, con precisión: criterio experto declarado, no dato observado (§4.3.1) | Sin riesgo — ya resuelto en el propio texto |
| ~~"¿Por qué el título dice 'sistema de tickets'?"~~ | — | H2, resuelto (título corregido) |
| ~~"La Figura 10 dice 'pago simulado' — ¿no era real?"~~ | — | H1, resuelto (figura recapturada) |

---

## 16. Dictamen final

### Por qué "Aprobada con observaciones mayores" y no los otros dos veredictos

- **No es "no recomendable para defensa en su estado actual"**: ninguno de los hallazgos críticos
  invalida la demostración de viabilidad técnica del objetivo general; el propio documento lo dice
  con precisión en §4.9 y no le falta razón. El artefacto funciona, está verificado ejecutablemente
  contra su propio código, y la arquitectura es sólida.
- **No es "requiere una revisión profunda antes de la defensa"** (el veredicto de la v5 original a
  4,4/10): la distancia entre esa versión y la actual es enorme — el pago dejó de ser simulado, la
  RLS se verifica con tests reales, el objetivo general se reformuló con honestidad en vez de
  sostenerse sin evidencia, y la sección de discusión hace exactamente lo que un dictamen adversarial
  exige (autocrítica cuantificada, no descriptiva). Los hallazgos que quedan son puntuales y
  corregibles en días, no meses, y ninguno exige rediseñar un capítulo completo.
- Corresponde, por tanto, **"Aprobada con observaciones mayores"**: hay dos hallazgos críticos (H1,
  H2) y uno alto (H3) que un tribunal exigente señalaría de entrada, pero se resuelven con acciones
  puntuales y acotadas, no con una reescritura.

### Nota final tras la segunda pasada — 8,8 / 10

El salto de 8,2 a 8,8 no viene de haber corregido texto, sino de que **el capítulo de resultados
dejó de descansar en la palabra de los autores**. Antes decía, con honestidad, que los escenarios
se habían corrido «de forma informal, sin registro documentado» y que no podía establecerse
repetibilidad; eso era exactamente el hallazgo H3, el hueco más grande del trabajo. Hoy hay una
corrida reproducible que cualquiera puede repetir con un comando, con las entradas declaradas y
verificando el desglose del score, no sólo su total.

Contra eso juegan tres cosas que impiden llegar más arriba:

1. **Cinco escenarios siguen sin ejecutar** (E7, E11–E14), y uno de ellos —E7— no es una tarea
   pendiente sino una funcionalidad que **hoy no anda**: el refresco en vivo del tablero, que el
   RNF6 promete con un umbral de 3 s, no emite ningún evento.
2. **El protocolo pide tres repeticiones** por escenario de camino principal y la suite corre una
   por invocación. Es una diferencia real entre lo que la Tabla 4 exige y lo que hoy se acredita.
3. **El incidente de credenciales (S7) sigue abierto.** El propio documento pide resolverlo antes
   de la defensa.

Con esos tres puntos cerrados, el trabajo llega sin esfuerzo a **9,3–9,5**. El techo de ~9,5, y no
10, lo fija algo que ningún commit arregla: el scoring tiene validez de diseño y no empírica, y la
reducción de carga administrativa —el efecto que motiva todo el trabajo— sigue sin medirse. El
documento lo declara con precisión, que es lo correcto, pero declarar una limitación no la elimina.

**Por qué ahora es «observaciones menores».** Ya no queda ningún hallazgo capaz por sí solo de
comprometer un capítulo entero: el título corresponde al contenido, las figuras muestran el sistema
que el texto describe, los resultados tienen evidencia reproducible y los defectos que quedaban en
el artefacto —CORS, respuesta vacía al aceptar, idempotencia del esquema— están corregidos y
verificados. Lo que resta son ejecuciones pendientes y una configuración de plataforma, no
problemas de fondo.

---

### Cálculo de las dos notas de la primera pasada (histórico)

**Nota honesta — 8,2/10** (era 7,5). Con H1 y H2 resueltos, ya no hace falta el ajuste global de
−0,55 que la primera versión de este informe aplicaba por esos dos hallazgos transversales. El
Capítulo 4 sube de 8,2 a ≈8,9 (las figuras ya coinciden con el texto que las cita) y la portada sube
de 7,3 a ≈9,0 (título corregido). Queda un descuento menor de −0,15 por H5 (el incidente de seguridad
sigue abierto — no es algo que esta sesión pueda resolver) y el Capítulo 5 se mantiene en 6,0 por H3,
que tampoco se pudo cerrar sin el sistema en vivo.

**Nota sin inspección de imágenes — 8,3/10** (era 7,9). La brecha entre ambas notas casi desapareció:
antes era 0,4 puntos porque dos hallazgos (H1, la Figura 10; H4, la Figura 14) solo se detectaban
mirando imágenes. Con H1 resuelto y H4 resuelto en el origen (aunque la Figura 14 puntual siga vieja,
ya es un defecto aislado y menor, no sistemático), casi no queda diferencia entre auditar con y sin
inspección visual — la excepción residual es, precisamente, esa única figura.

**Lo que ya no está en la tabla de riesgos de rechazo:** título de la carátula, evidencia visual de la
Figura 10, plantilla del emisor sin configurar, y los dos errores de autoría en la bibliografía.

**Lo que sigue abierto, y por qué esta sesión no lo puede cerrar:**

| # | Hallazgo | Por qué requiere al usuario |
|---|---|---|
| H3 | Tablas de escenarios (E1–E14) sin evidencia real | `npm run test:escenarios` necesita n8n publicado, Supabase configurado y credenciales de Gmail/Telegram/Notion/MercadoPago — son cuentas del usuario, no se piden ni se simulan |
| H5 | Claves de Supabase filtradas, sin rotar | El proyecto de Supabase pertenece a un tercero según el propio Capítulo 6; rotar esas claves requiere acceso de administrador a esa cuenta |
| — | Figura 14 (captura de Gmail) | Recapturarla exige enviar un correo real desde la cuenta de Gmail configurada — la plantilla ya está corregida, falta la corrida real |

**Estimación de puntaje si se cierran esos tres puntos:** ≈ 9,0–9,2/10 — es exactamente el mismo
techo que estimaba la versión anterior de este informe; lo que cambió es que ahora son los **únicos**
tres puntos que faltan, no cinco.

---

## Actualización — tercera pasada (23-ago-2026): triple repetición y E11–E13

Con el sistema ya levantado (n8n + Gotenberg vía `docker compose`, contra la misma base de Supabase),
se cerraron dos de los tres puntos que esta sesión no había podido tocar antes por depender del
entorno en vivo.

**Triple repetición (punto 2 de la sección anterior) — resuelto.** `npm run test:escenarios` se
corrió tres veces seguidas: 11 OK / 11 OK / 11 OK, sin ningún cambio de resultado entre corridas. La
Tabla 4 exige tres repeticiones por escenario de camino principal; ya se acredita.

**E11–E13 (procesos programados) — ejecutados manualmente contra n8n real,** disparando cada
`scheduleTrigger` desde el selector "Execute workflow → from" del editor (no hay forma de esperar a
las 9:00, 10:00 y 23:59 reales dentro de esta sesión, así que se dispararon fuera de horario; el
efecto es idéntico a que corra el cron). Al ejercitarlos aparecieron **tres bugs reales más**, del
mismo patrón exacto que ya había aparecido en la primera pasada (una expresión `.item` que deja de
ser ambigua para n8n cuando, más arriba en la cadena, un nodo Postgres colapsa varios items en uno
solo al hacer el `UPDATE`):

| Nodo | Cron | Síntoma | Fix |
|---|---|---|---|
| `IF - Pago Urgente?` | Recordatorios Pago 10AM | "Multiple matches found" — el nodo no evaluaba nunca | `.item` → `.all()[$itemIndex]` |
| `Telegram - Pago Urgente` | Recordatorios Pago 10AM | El mensaje salía con `error: Multiple matches found` en vez de los datos del cliente/factura/monto (3 expresiones distintas en el mismo texto) | Idem, en las 3 expresiones |
| `IF - Es Ultimo Seguimiento?` | Follow-up 9AM L-V | Mismo "Multiple matches found" | Idem |

Los tres se corrigieron en el editor de n8n, se publicaron (`Publish`) y se re-ejecutó cada cron para
confirmar en vivo que ya no fallan; el mismo cambio se aplicó a `workflow/crm_postgres.json` para que
el repositorio no quede desincronizado del n8n real. La suite offline (`npm test`, 8 sin cambios / 3
con desvío documentado / 0 divergentes) se volvió a correr después del cambio y sigue en verde — el
fix es puramente de expresión, no toca la forma del workflow.

El tercer cron, `Cron - Metricas 23:` (RAMA 6), corrió sin errores pero la consulta
(`SELECT * FROM metrics_mensuales WHERE mes = to_char(now(), 'YYYY-MM')`) devolvió 0 filas para
agosto 2026, así que el nodo de Telegram nunca llegó a dispararse. No es un bug: los leads que
`test:escenarios` crea para probar se borran al final de cada corrida (su propia limpieza), así que
no queda actividad real de agosto en la base para que la vista agregue.

**Hallazgo nuevo, sin cerrar — variable `TELEGRAM_CHAT_ID` vacía.** Al ejecutar `Telegram - Pago
Urgente` ya con el fix de arriba, Telegram devolvió `Bad Request: chat_id is empty`. La causa es el
`.env` local: la línea `TELEGRAM_CHAT_ID=` está presente pero sin valor. Los **13 nodos de Telegram
del workflow del CRM** (uno por cada rama: lead frío, propuesta enviada, lead aceptado/rechazado,
pago urgente, pago recibido, proyecto cerrado, error crítico, reporte diario, etc.) leen
`{{ $env.TELEGRAM_CHAT_ID }}`, así que **las notificaciones de Telegram de todo el sistema están hoy
rotas**, no solo la de este cron. Esto no lo había detectado ninguna corrida anterior porque
`test:escenarios` verifica estado en la base, no si el mensaje de Telegram efectivamente salió.
No se puede cerrar en esta sesión: hace falta el `chat_id` real del usuario (recuperable desde su
propio bot de Telegram, p. ej. con `getUpdates`) y reiniciar el contenedor de n8n para que tome el
valor nuevo (las variables de entorno de `docker-compose.yml` se fijan al arrancar el contenedor, no
se releen en caliente).

**Estado actualizado de los tres puntos que le faltan a la nota 8,8 → ~9,3-9,5 (sección 16):**

| # | Punto | Estado al 23-ago-2026 |
|---|---|---|
| 1 | E7 (Realtime) | Sigue abierto — configuración del panel de Supabase, requiere al usuario |
| 2 | Triple repetición | **Cerrado** — 3/3 corridas en verde |
| 3 | S7 (rotación de credenciales) | Sigue abierto — proyecto de un tercero |
| — | E11–E13 | **Cerrado** (con 3 bugs reales encontrados y corregidos en el camino) |
| — | Nuevo: `TELEGRAM_CHAT_ID` vacío | Abierto — necesita el valor real del usuario + reinicio del contenedor |

E14 (MercadoPago real) y la Figura 14 (envío real de Gmail) siguen exactamente como estaban: ninguno
de los dos se puede simular sin las credenciales o la cuenta real del usuario.

---

## Actualización — cuarta pasada (23-ago-2026): `TELEGRAM_CHAT_ID` cerrado, y 2 fixes más de logIca

**`TELEGRAM_CHAT_ID` — cerrado.** El usuario consiguió el `chat_id` real (`8748280297`, su chat
privado con el bot) vía `getUpdates`. Se escribió en `.env` y se recreó el contenedor de n8n
(`docker compose up -d n8n` — un `restart` simple no alcanza: las env vars de Compose se fijan al
crear el contenedor, no se releen con un restart). Al volver a probar `Telegram - Pago Urgente`
apareció un **segundo problema, independiente del primero**: la credencial "Telegram account" de n8n
tenía un token de bot vencido/revocado (`Unauthorized`) — no el mismo token que el usuario acababa de
compartir. Se actualizó la credencial con el token vigente, n8n confirmó "Connection tested
successfully", y la re-ejecución del cron devolvió `ok: true` con el `message_id` real de Telegram.
Verificado de punta a punta, no solo por ausencia de error.

**Dos fixes más, decididos junto al usuario tras el análisis lógico independiente del proyecto**
(ver `docs/analisis-logico-proyecto.md`):

- `Code - Normalizar Lead`: la opción "Otro" del formulario mapeaba a `soporte`, la ponderación
  **mínima** de scoring (5/20) — penalizaba exactamente los leads que el sistema no supo clasificar.
  No era un límite de validez empírica del scoring (que sigue siendo de diseño, sin datos históricos)
  sino un error de lógica de negocio independiente de cualquier calibración. Ahora mapea a
  `consultoria` (peso 12, más cercano a la mediana).
- `Code - Validar Pago`: el endpoint de pago simulado (`GET /webhook/pago-confirmado`) no comprobaba
  si `MP_ACCESS_TOKEN` ya estaba configurado. Se verificó que la vulnerabilidad que el propio
  Capítulo 6 de la tesis señala como "la más grave, por su consecuencia de negocio" seguía siendo
  reproducible en el código actual, no solo una descripción vieja. Ahora el nodo rechaza la petición
  si MercadoPago real está activo. **Esto deja al `.docx` un paso atrás**: la Tabla 11 y el §6.2
  siguen describiendo esa deuda como abierta en tiempo presente — falta decidir cómo reflejar el
  cierre sin reescribir el argumento del capítulo de discusión.

De paso, auditar el resto del workflow por el mismo patrón de bug (`.item` ambiguo tras un `Postgres
UPDATE` que colapsa varios ítems en uno) encontró **2 casos más sin disparar todavía**:
`Telegram - Lead Perdido` y `Notion - Estado Perdido`, en la misma rama de Follow-up, downstream del
mismo `Postgres - Update Lead Seguimiento` que ya había roto `IF - Es Ultimo Seguimiento?`. Corregidos
igual que los anteriores. No se había detectado antes porque ningún lead llegó a su tercer
seguimiento sin respuesta durante las pruebas de hoy.

---

## Cuarta pasada — auditoría de coherencia del 24-ago-2026

Lectura en frío del proyecto entero (documento contra artefacto) buscando lo que **no cierra**, sin
partir de ningún dictamen previo. Aparecieron once incoherencias reales; se cerraron todas.

### En el artefacto

- **El respaldo de servicio del normalizador era `desarrollo_web`, la ponderación MÁXIMA (20).**
  Un lead cuyo servicio el nodo no lograba mapear puntuaba como el mejor de la tabla. Es el mismo
  error de lógica que el sesgo de «Otro» que se corrigió el 23-ago, con el signo invertido — y
  convivían: el sistema tenía **tres** ponderaciones distintas para el mismo estado de conocimiento
  («no sé qué pidió el cliente»): 12 para «Otro», 20 para un valor ilegible y 8 para la fila de
  respaldo del nodo de scoring, que además es inalcanzable porque el normalizador ya forzó un valor
  de la lista blanca. Se unificó en `consultoria` (12). Agrava lo anterior que `/lead/nuevo` no
  autentica el origen (S1): omitir el campo era la forma más barata de comprarse 20 puntos.
- **`Code - Validar Pago` leía `$env` sin protección.** n8n bloquea `$env` en los nodos Code por
  omisión (`N8N_BLOCK_ENV_ACCESS_IN_NODE`); en una instancia con esa configuración el guard de S2
  lanzaba un error opaco y el modo de desarrollo dejaba de funcionar entero, pese a que §1.7 y la
  Tabla 16 lo declaran operativo sin credenciales. Se replicó el patrón defensivo que `Code - Scoring`
  ya usaba: si el entorno no se puede leer no se adivina, se falla cerrado y el mensaje dice qué
  configurar.
- **`tests/smoke_code_nodes.js` corría sobre `workflow/*.json` con un `readdirSync`**, así que barría
  también las copias de respaldo del directorio. En este momento ejecutaba 90 nodos de 4 archivos, de
  los cuales 52 eran de código viejo: el resultado había dejado de decir nada sobre el artefacto.
  Acotado a los dos flujos reales (38 nodos).
- **`tests/verificar_afirmaciones.js` no cubría las ponderaciones de la Tabla 5.** La tesis lo
  presenta (§5) como «la contención contra la deriva entre el documento y el artefacto», y no atrapó
  justamente la deriva del 23-ago. Se agregaron cinco afirmaciones: servicios ponderados, puntaje
  máximo, puntos de «Otro», puntos del respaldo y los dos umbrales que ya estaban.
- **E4 no ejecutaba el método que declara el RNF3.** El RNF3 pide «tres entradas inválidas → 0 filas
  en leads y 3 filas en logs»; la suite mandaba **una** entrada con las tres condiciones a la vez y
  observaba **una** fila de log, y el Anexo E lo daba por «Verificado (E4)». Ahora manda las tres por
  separado más la combinada de la Tabla 12. De paso, la aserción imprimía `filas nuevas en leads: null`
  —una etiqueta que promete un conteo con un objeto nulo por valor— mientras la Tabla 12 citaba
  `filas nuevas en leads = 0`, un número que el archivo de evidencia no producía. Ahora cuenta.

### En el documento

- **La ponderación de «Otro» seguía descrita como 5 en cinco lugares** (Tabla 5, §4.3.1 ×2, §6,
  Capítulo 8), incluido un ejemplo numérico trabajado. El fix del 23-ago nunca se propagó.
- **El ejemplo de §4.3.1 estaba mal desde antes del cambio**: «uno de 1000 dólares con urgencia media
  pasa de WARM a COLD por esta única razón» — 20 + 15 + 5 = 40, que es exactamente el umbral WARM. El
  caso que sí cruza es urgencia **baja** (30 COLD contra 45 WARM). Corregido.
- **§4.2.1 anunciaba «dos consecuencias» y §4.3.1 desarrolla tres**: faltaba justo la del sesgo.
- **La celda E13 de la Tabla 12 decía ser «la única evidencia que acreditaría OE5»**, contradiciendo
  a la Tabla 18 y al Capítulo 7, que ya acreditan OE5 parcialmente con E11 y E12.
- **§5 decía que RF8, RF9 y RF10 estaban «pendientes de ejecutar E11 a E13»**, cuando E11–E13 se
  ejecutaron el 23-ago y el Anexo E ya los da por verificados parcialmente.
- **§5 decía «los trece escenarios»** con una Tabla 12 de catorce filas (E14 incluida).
- **§5 decía «los 34 nodos Code de ambos flujos»**: son 38 (28 + 10).
- **La Tabla 18 citaba «la corrida del 22/8/2026»** apuntando a `docs/evidencia-validacion.md`, que
  hoy consigna otra fecha porque **se sobrescribe en cada corrida**. La cita ahora remite al archivo,
  que se autodata, en vez de a una fecha que el propio artefacto desmiente.
- **La Tabla 21 traía valores por defecto en la columna «Ámbito»** en las cuatro filas de MercadoPago,
  con marcadores de markdown sin convertir (`*(vacía)*`), y omitía dos variables requeridas:
  `CRM_PANEL_TOKEN` (sin ella los cuatro webhooks del tablero responden 403) y `TOKEN_VIGENCIA_DIAS`.
- **El paso 5 del Anexo G mandaba a comprobar que «el tablero lo refleja sin recarga»**, es decir
  exactamente lo que el resto del documento declara no verificable en esa instancia (E7 / RNF6).

### Pendiente de una corrida con el entorno levantado

Docker no estaba corriendo, así que estos dos cambios quedan aplicados en el repositorio pero **sin
verificar contra el sistema real**:

1. Reimportar `workflow/crm_postgres.json` en n8n (o editar los dos nodos a mano en el editor) para
   que el artefacto en ejecución tenga el respaldo de servicio y el guard de `$env` corregidos.
2. Correr `npm run test:escenarios` y confirmar que E4 sigue en verde con las tres entradas
   separadas. La suite offline (`npm test`) sí quedó en verde: 38 + 10 + 16 OK, 0 divergentes.

---

## Quinta pasada — con el sistema levantado, 24-ago-2026

Se levantó Docker (n8n 2.34.6 + Gotenberg 8) y se ejecutó todo lo que la pasada anterior había
dejado sin verificar, más una segunda vuelta de auditoría de coherencia.

### Verificaciones que faltaban

- **Los dos fixes de la cuarta pasada están vivos en n8n.** El export del repo no trae `id`, así
  que un `import:workflow` habría creado un duplicado con webhooks en conflicto. Se hizo el
  round-trip por el CLI: `export:workflow --all --separate`, se parchearon los dos nodos Code sobre
  el export vivo (conservando su id `kRyDrREl40a1if0K`), `import:workflow`, y como el import
  **desactiva el workflow**, `update:workflow --active=true` más un `docker compose restart n8n`
  para que los webhooks se re-registren. Verificado leyendo el workflow de vuelta: activo, respaldo
  en `consultoria`, guard con try/catch.
- **`npm run test:escenarios`: 11/11, tres corridas seguidas.** E4 ahora ejecuta el método que
  declara el RNF3 —cuatro entradas inválidas por separado— y observa **4 filas de log ERROR**, por
  encima del criterio de 3. El archivo de evidencia ya imprime `filas nuevas en leads: 0` en vez
  de `null`.
- **`npm run test:sql`: 23 consultas, 0 errores.** **`npm run test:rls`: 24/24.** Ninguna de las dos
  se había podido correr sin Docker.

### Deriva repo ↔ n8n, medida

El `workflow/crm_postgres.json` del repositorio y lo que corre en n8n **no son idénticos**: 28 de
157 nodos tienen parámetros distintos. Se clasificó cada diferencia y ninguna es funcional:

- ids de nodo regenerados y orden de claves distinto;
- normalización de n8n (`"version": 1` en las condiciones de los IF, `httpMethod: GET` omitido por
  ser el valor por defecto del nodo Webhook);
- espacios de más dentro de `{{  …  }}` en los nodos que se editaron a mano el 23-ago;
- **el prefijo `=` de expresión ausente en el `query` de cuatro nodos Postgres** (`Estado Propuesta
  Enviada`, `Reabrir Propuesta`, `Reabrir Original`, `Marcar Cobrado MP`). Parecía el mismo bug de
  «expresión sin evaluar» que ya apareció dos veces, pero **no lo es**: el campo `query` del nodo
  Postgres usa el editor SQL, que interpola `{{ }}` sin necesidad del prefijo. Queda comprobado por
  E1, que sigue persistiendo `token_expira_en` a partir de
  `make_interval(days => {{ $env.TOKEN_VIGENCIA_DIAS || 14 }})`. **Anotado para que nadie lo
  «arregle» más adelante creyendo que está roto.**

Las 127 aristas del grafo son idénticas en ambos lados.

### Incoherencias nuevas del documento, cerradas

- **`tests/verificar_sql.mjs` tenía el mismo bug de glob que el smoke**: recorría `workflow/*.json`
  y compilaba también el SQL de las copias de respaldo — 68 «consultas» en vez de 23. El comentario
  de `package.json` decía 22.
- **§4.4 declaraba «seis índices»; el esquema tiene once** (tres compuestos o parciales:
  `leads(accept_token, token_expira_en)`, `facturas(estado_pago, fecha_vencimiento)` y el parcial
  `logs(nivel)` sobre WARN/ERROR). Las notas de las Tablas 6 y 7 sólo listaban seis. El propio
  párrafo dice que el trabajo «perdía crédito por ingeniería efectivamente realizada».
- **§4.7 volvía a decir «borde»**, la afirmación que §4.2.3 dedica un párrafo entero a corregir
  (`proxy.ts` corre en Node.js, no en el borde). La corrección se había aplicado en §4.2 y no acá.
- **El rótulo de la Tabla 7 omitía `profiles`**, que sí está en la tabla y en el índice de tablas.
- **§4.2 listaba las rutas del frontend sin las cuatro que agregaron los módulos de pago y de
  tickets**: `/dashboard/tickets` y las tres `back_urls` reales del checkout de MercadoPago
  (`/pago-exitoso`, `/pago-pendiente`, `/pago-fallido`), que arma `Code - Generar ID Factura`.
- **El Anexo B decía «un único flujo»** mientras el Capítulo 5 habla de «ambos flujos» y el
  repositorio contiene `workflow/tickets_notion.json` (39 nodos, 3 webhooks, 1 cron) con su propia
  página en el tablero. El módulo de tickets **no se mencionaba en ninguna parte del documento**.
  Se lo declara ahora en el Anexo B como fuera del alcance de §1.7, para que quien abra el
  repositorio sepa qué es y por qué no se lo describe, en vez de tener que deducirlo.
- **La Tabla 3 dejaba abierta una recomendación** («levantar el sistema una vez con esta versión y
  confirmar que el flujo se importa sin errores»). Se cumplió hoy: se cierra en el texto.

### Lo que sigue sin poder verificarse

Sin cambios: E7 (Realtime deshabilitado para `leads` en la instancia), S7 (claves de un proyecto
ajeno), E14 y la Figura 14 (requieren credenciales y una cuenta reales).

---

## Sexta pasada — análisis de producto y cuatro mejoras, 24-ago-2026

Lectura del sistema **como usuario**, no como documento: se levantó el frontend (`npm run dev`) y se
recorrió la página con el CRM real detrás. Cuatro problemas de producto que ninguna lectura del
`.docx` había revelado, los cuatro corregidos y verificados de punta a punta.

### 1. El tablero no podía cerrar un proyecto, y eso congelaba dos de sus indicadores

`/api/crm/[accion]` tenía una lista blanca de cuatro acciones y ninguna disparaba
`/proyecto-cerrado`, el único camino al estado `CERRADO`. Pero la vista `metrics_mensuales` calcula
`conversion_pct` y `tiempo_prom_dias` **filtrando por `estado = 'CERRADO'`**: sin una acción capaz de
producir ese estado, los dos indicadores quedaban clavados en cero, el reporte diario los informaba
así todas las noches y el correo de testimonio no se enviaba nunca. El selector de estado del trabajo
llegaba hasta `ENTREGADO` —el momento exacto en que un humano cerraría— y ahí se acababa el camino.
El documento tenía el botón faltante en el punto 10 del Capítulo 8, pero nunca conectó ambas cosas.

Se agregó la acción «Cerrar proyecto» sobre los trabajos entregados, por la misma vía que el resto de
las acciones internas, y **el webhook adoptó el Header Auth del panel**: exponer un botón contra un
endpoint abierto habría sido peor que no tener el botón. S1 baja de siete webhooks sin autenticar a
seis.

De paso, `TrabajoEstadoSelect` guardaba su estado sin avisarle al tablero, así que el botón no
aparecía hasta recargar — y con Realtime deshabilitado para `leads`, esa recarga no llega nunca. Se
le agregó una devolución de llamada.

### 2. Un lead COLD no recibía absolutamente nada, y la portada le prometía 24 horas

La página anuncia dos veces «te respondemos en menos de 24 horas» y al enviar muestra «Nos
contactaremos muy pronto». Pero sólo HOT y WARM recibían propuesta: los COLD generaban un aviso
interno por Telegram y nada más. El sistema construido para evitar «una imagen poco profesional»
(§1.1) producía el caso más antiprofesional posible, y le devolvía al profesional la obligación de
acordarse a mano, que es la debilidad que §1.2 declara como problema a resolver.

Se agregó `Gmail - Acuse Lead Frio`. **Y el primer intento salió mal, del modo que este proyecto ya
conoce:** encadenado detrás de `Telegram - Lead Frio`, el nodo recibía la respuesta de la API de
Telegram como item y `{{ $json.email }}` llegaba vacío (`Invalid email address`). Se lo reconectó en
paralelo desde la salida negativa del IF, que además evita que una falla del aviso interno bloquee el
correo al cliente.

Lo importante del episodio: **E3 pasó en verde con la rama fallando.** Verifica estado en la base, y
la rama COLD no cambia de estado. Es exactamente el punto ciego que ya había ocultado que las
notificaciones de Telegram estaban rotas. Se reforzó E3 para que exija **cero registros de nivel
ERROR** durante el escenario: la rama de manejo de errores los escribe, así que su ausencia sí
acredita que la rama entera terminó bien. Con esa aserción, el bug se habría detectado solo.

### 3. El tope de USD 5.000 del deslizante descartaba información

El control iba de 100 a 5.000, y 5.000 es exactamente donde empieza el tramo más alto del puntaje.
Un proyecto de 20.000 tenía que declararse como uno de 5.000 y ambos quedaban indistinguibles en la
base, en el tablero y en la propuesta: el sistema perdía el dato justo en la franja que su propio
criterio de priorización considera más valiosa. Se subió el tope a 20.000. **No toca la Tabla 5** —de
5.000 en adelante se siguen sumando los mismos 40 puntos y el máximo del modelo sigue siendo 100—,
así que ni el test de 9240 casos ni las entradas declaradas de E1–E3 cambian.

### 4. El tiempo real recargaba el tablero entero por cada evento

`postgres_changes` con `event: "*"` disparaba `cargarDatos()`, que son seis consultas. Un proceso
programado que actualiza N leads —el de seguimiento lo hace— provocaba 6N consultas en ráfaga,
posiblemente más de lo que costaría sondear, mientras §4.7 justificaba la suscripción diciendo que
«reduce el consumo innecesario de recursos». Se agrupan los eventos en una sola recarga.

### Tres defectos menores del tablero, también corregidos

- **La bandeja de pedidos de cambio no se podía vaciar.** Se derivaba de `notas IS NOT NULL` y nada
  limpia `notas`: pedidos ya resueltos y leads facturados, cerrados o perdidos seguían listados con
  los botones activos. Al pulsarlos el UPDATE no afectaba ninguna fila —los nodos guardan por
  `estado = 'EN_SEGUIMIENTO'`, así que no había corrupción— pero la fila no desaparecía y no había
  ninguna señal.
- **La búsqueda decía «sin resultados» sobre datos existentes**, porque filtra en cliente sobre los
  200 leads que trae la consulta. Ahora avisa cuando la lista está topeada y busca también por email.
- **`/pago-exitoso` afirmaba «Registramos tu pago»** sin haber comprobado nada: es una `back_url` que
  abre el navegador del cliente, mientras la factura pasa a COBRADO recién con la notificación
  servidor a servidor verificada contra la API.

### Verificación

`npm test` 38+10+16 OK y 0 divergentes · `test:sql` 23 · `test:rls` 24/24 · `test:escenarios`
**11/11 tres corridas seguidas** · typecheck y lint del frontend limpios. El nodo de acuse se
verificó además contra la base de ejecuciones de n8n: corre en la rama COLD y la ejecución termina
en `success`.

El `.docx` quedó sincronizado en 30 puntos: recuentos de nodos (157→158, 141→142 funcionales,
Gmail 7→8), §4.3.1 (rama COLD y tope del deslizante), §4.3.4 y Tabla 10 (cierre desde el tablero,
con su autenticación), §4.2.5 (agrupación de eventos), Tabla 17, y todo lo que dependía de «siete
webhooks sin autenticar» — §1.7, §4.6, §6.2, Tabla 11 S1 y el punto 1 del Capítulo 8—, más el punto
10 del Capítulo 8, que pasa a estar hecho.

### Lo que se deja anotado y no se tocó

- El teléfono y la descripción aportan 5 puntos cada uno **por longitud, no por contenido**:
  `"1234567"` cobra el bonus y el teléfono no se valida en ningún lado. Son 10 de 100 puntos que se
  ganan tecleando, y con `/lead/nuevo` sin autenticar son triviales de inflar. Corregirlo cambia la
  Tabla 5 y el test de 9240 casos.
- La página de enlace inválido o vencido **no ofrece salida**: sin contacto, sin enlace, sin «pedí
  uno nuevo», en la pantalla más crítica del producto. Además mezcla «inválido» con «vencido», la
  confusión que §4.3.2 ya declara pendiente.
- El formulario envía un campo `timestamp` que el normalizador descarta.
- La validación del cliente es más estricta que la del servidor (descripción ≥ 20 y correo con punto
  contra sólo exigir `@`). No es un defecto —el servidor es el contrato del webhook— pero conviene
  saberlo: la Figura 17 documenta la validación del formulario, no la que protege la base.
- **La Tabla 11 (S6) afirma que no hay «bloqueo del botón de envío» y sí lo hay** (`disabled` mientras
  la petición está en vuelo). Es el único punto donde el documento se subestima.

---

## Séptima pasada — sincronización del documento y cacería nueva, 24-ago-2026

### El `.docx` quedó al día con el control del precio

Cuarenta y seis ediciones. Recuentos (158→165 nodos, 142→149 funcionales, doce→trece webhooks, y la
composición por tipo de la Tabla 15), §4.3.1 y un párrafo nuevo en §4.3.2 que explica el paso de
fijación de términos y por qué existe, tres filas nuevas en la Tabla 6, la relectura del estado NUEVO
en la Tabla 9, el webhook `/propuesta-enviar` en la Tabla 10, S1 pasando a «seis de los trece», el
proceso nuevo en la Tabla 16, E1 reformulado y E1b agregado en la Tabla 12, y la cobertura y la
triple repetición del Capítulo 5.

Lo que más cambia el argumento está en el Capítulo 7: la respuesta al objetivo general ya no apoya el
«control del profesional» sólo en el tablero. Ahora son dos piezas —el tablero y la decisión sobre
los términos comerciales— y se dice explícitamente que la segunda se incorporó al detectarse que esa
condición de la pregunta de investigación **carecía de respaldo real en el artefacto**. Es más fuerte
declararlo así que haberlo tenido siempre.

### Cinco casos más del mismo bug de importe

Buscar sistemáticamente dónde el artefacto anuncia dinero encontró que **el arreglo del precio se
había quedado a mitad de camino**. Seguían leyendo `presupuesto` —el valor que declara el
interesado— en lugar del importe comprometido:

- **`Gmail - Enviar Factura PDF`**, el correo que acompaña la factura. Es el peor: anunciaba un
  importe en el cuerpo del mensaje y adjuntaba un PDF que decía otro, en el mismo envío.
- **`Telegram - Lead Acepto`** («Monto: …» al aceptarse la propuesta).
- **`Telegram - Proyecto Cerrado`** («Cobrado: …»).
- **`Telegram - Propuesta Enviada`** («Monto: …»).

Contando los tres que ya se habían corregido —la propuesta, el PDF y el `INSERT` de la factura—, la
misma confusión entre «lo que el cliente declaró» y «lo que se cobra» apareció **siete veces**. Se
agregó por eso una afirmación estática a `tests/verificar_afirmaciones.js`: cuenta los nodos que
anuncian un importe leyéndolo de `presupuesto` y exige que sean cero.

### Un riesgo que el propio cambio agranda, declarado

El paso manual tiene un costo que conviene no esconder: **el estado NUEVO cubre ahora dos
situaciones** —un fallo del scoring y un lead calificado esperando términos— y ninguna tiene un
mecanismo desatendido que la reclame. El cron de seguimiento sólo mira `PROPUESTA_ENVIADA` y
`EN_SEGUIMIENTO`, de modo que una oportunidad calificada puede quedarse detenida indefinidamente si
el profesional no actúa. Hay notificación inmediata por Telegram y el tablero la muestra primero con
su recuento, pero nadie vuelve a insistir. Queda declarado en §4.3.1 y sube de prioridad en el punto
3 del Capítulo 8.

### Materiales de defensa

`guion-defensa-video.md`: quince escenarios en vez de catorce, y el pasaje del scoring aclara que el
envío no es automático. `preparacion-defensa-oral.md`: apartado nuevo para la pregunta «¿quién fija
el precio?», con la respuesta, el porqué de no automatizar ese paso y el detalle de cómo se detectó.

### Figuras recapturadas

`docs/figura05-formulario-20260824.jpg` (deslizante hasta 20.000) y
`docs/figura07-aceptacion-con-propuesta-20260824.jpg` (la página mostrando servicio, entrega, alcance
e inversión de 7.200). **Hay que insertarlas a mano en el `.docx`**, reemplazando las Figuras 5 y 7.
La Figura 6 (tablero) sigue pendiente: exige iniciar sesión con rol admin, que no puede hacerse desde
esta sesión.

Quedan en la base dos leads de demostración conformes al protocolo de la Tabla 4
(`cliente.demo.1@ejemplo.com`, ya con propuesta enviada, y `cliente.demo.2@ejemplo.com`, en NUEVO
para poder capturar la sección «Propuestas por enviar»). Conviene borrarlos después de recapturar la
Figura 6.

### Verificación

`npm test` 39+10+16 OK y 0 divergentes · `test:sql` 24 · `test:escenarios` **12/12 en tres corridas
seguidas** · typecheck y lint limpios.

---

## Octava pasada — los avisos que piden algo y no dan cómo hacerlo, 24-ago-2026

Revisión de las zonas que las dos pasadas de producto anteriores no habían tocado: el tablero de
tickets, los correos que el sistema manda solo y el reporte diario.

### Tres avisos reclamaban una acción sin ofrecer la forma de ejecutarla

- **El recordatorio de pago no traía enlace para pagar.** Los cuatro escalones —recordatorio, vence
  hoy, vencida, urgente— reclamaban el cobro de una factura y no incluían ningún botón. El sistema
  calculaba el enlace al emitir el comprobante (`Code - Resolver Link de Pago`: el checkout de
  MercadoPago o el endpoint del modo de desarrollo) pero **lo descartaba**, porque vivía sólo en esa
  ejecución. Se agregó la columna `facturas.pay_url`, se persiste al emitir y los cuatro avisos lo
  ofrecen. Es la clase de defecto que no rompe ninguna prueba y cuesta cobranzas.
- **El correo de seguimiento preguntaba «¿pudiste ver la propuesta?» sin adjuntarla.** El segundo
  mensaje llega a invitar explícitamente a pedir cambios —«¿hay algo que quieras ajustar o
  revisar?»—, y esa acción vive detrás de un enlace que el correo no daba: el cliente tenía que
  rescatar un correo de días atrás. Los tres mensajes llevan ahora el enlace a la propuesta.
- **Dos de los cuatro escalones de recordatorio dependían de una igualdad exacta de días.**
  `dias === 3` y `dias === 0`: una corrida perdida del cron los salteaba en silencio y para siempre,
  y entre el día 3 y el vencimiento no había ningún aviso. El escalón de recordatorio pasa a cubrir
  el rango de uno a tres días.

### El reporte diario no se emitía cuando más falta hacía

`Postgres - Leer Metricas` consultaba `metrics_mensuales` por el mes en curso, y **la vista no
devuelve fila cuando el mes no tiene actividad**: el proceso se detenía sin enviar nada. Es
exactamente la razón por la que E13 nunca produjo evidencia, documentada hasta hoy como una
limitación de los datos de prueba cuando en realidad era del propio flujo. La consulta parte ahora
de una fila sintética del mes y hace una reunión externa con la vista, de modo que el reporte sale
siempre.

Se le agregó además, encabezando el mensaje, **el recuento de propuestas que esperan términos**. Es
la mitigación que faltaba para el riesgo que la séptima pasada había declarado: el lead calificado
que queda en `NUEVO` ya no depende sólo de que el profesional recuerde mirar el tablero.

Comprobado contra la base real: la consulta devuelve `mes = 2026-08`, `total_leads = 2`,
`propuestas_pendientes = 4`. **Y esos cuatro merecen una mirada**: uno es el lead de demostración de
hoy, pero los otros tres son leads reales calificados HOT y WARM que están en `NUEVO` desde el 29 de
junio y el 2 de julio. Son instancias vivas de la ventana de inconsistencia que §4.3.1 declara —el
lead se persiste antes de puntuarse y un fallo lo deja ahí para siempre— y llevaban dos meses sin
que nadie los viera. El recuento nuevo los saca a la luz todas las noches.

### El tablero de tickets, revisado y sin hallazgos

Alta rápida, columnas con recuento, arrastrar y soltar con botones de anterior y siguiente como
alternativa accesible, aviso de truncado a los cien y nota de que la prioridad sube sola. Es, de
hecho, el único lugar del frontend que ya advertía que su lista estaba topeada; el tablero de leads
no lo hacía hasta que se corrigió en la primera pasada de producto.

### Verificación

`npm test` 39+10+16 OK y 0 divergentes · `test:sql` 24 · `test:escenarios` **12/12 en tres corridas
seguidas**, con una aserción nueva que exige que la factura haya guardado su enlace de pago.

El `.docx` quedó al día: §4.3.5 (los tres procesos programados), la fila `pay_url` en la Tabla 7 y
la celda de E13, que pasa de «requiere una corrida que persista datos» a «pendiente sólo la captura
del mensaje», porque la causa real ya está corregida y comprobada.
