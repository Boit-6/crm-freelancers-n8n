# FormularioLeads — CRM automatizado para freelancers

Captación → calificación → propuesta → factura → cobro, sin tareas manuales. Sobre esa base, una plataforma
donde varios desarrolladores tienen su espacio, los clientes publican proyectos y el pago se protege por hitos.

<!-- Completar cuando estén publicados: el link de la demo, el del video y las cuentas. -->
▶ **Video (2 min):** _próximamente_ · 🔗 **Demo:** _próximamente_ · cuentas de prueba en la pantalla de ingreso

**Stack:** Next.js 16 · React 19 · n8n · Supabase (PostgreSQL + RLS + Realtime) · Stripe Connect · Gotenberg · Docker

---

## Qué hace

**Para el desarrollador (panel en tiempo real)**
- Formulario público propio (`/f/<espacio>`): cada consulta entra calificada como HOT, WARM o COLD.
- Propuesta con precio, plazo y alcance; el cliente la acepta, la rechaza o pide cambios desde un enlace.
- Factura en PDF y cobro con Stripe Connect en USD, con la comisión de la plataforma descontada.
- Tablero de trabajo con tickets, avisos por correo y Telegram, y un inicio con «Requiere tu atención».

**Para el cliente**
- Publica un proyecto, recibe postulaciones, conversa con los postulantes (los datos de contacto quedan
  ocultos hasta elegir) y elige, o deja que elija la plataforma.
- Paga por hitos: la plata queda retenida hasta que aprueba la entrega, se libera sola a los 7 días y,
  si hay un problema, abre una disputa.
- Califica con estrellas al cerrar; la reputación se ve en el perfil público del desarrollador.

**Bolsa de proyectos:** si un desarrollador no puede tomar un pedido y el cliente lo autorizó, el pedido se
publica sin datos personales para que otros se postulen. Hay filtros, etiquetas y alertas por servicio.

## Arquitectura

```
Navegador ──▶ Next.js (Vercel) ──▶ n8n (webhooks + crons) ──▶ PostgreSQL (Supabase)
                    │                       │
                    └── lee con sesión ─────┘── Gotenberg (PDF) · Stripe · Gmail · Telegram
                        y RLS por espacio
```

- El front nunca escribe en las tablas de negocio: las mutaciones pasan por n8n o por funciones
  `SECURITY DEFINER` acotadas. El panel lee con la clave pública bajo sesión y RLS por espacio.
- El flujo principal de n8n tiene 21 webhooks, 9 procesos programados y 314 nodos funcionales.
- Aceptación atómica por token, pagos idempotentes con firma verificada, rate limiting en los webhooks
  públicos y conciliación de los casos inciertos.

## Cómo está probado

| Prueba | Qué cubre |
|---|---|
| `npm test` | Los nodos Code del workflow, el scoring, la firma de Stripe, el escape de HTML y la consistencia de la documentación |
| `npm run test:rls` | 291 casos de RLS contra PostgreSQL real: qué ve y qué puede tocar cada rol |
| `npm run test:sql` | Compila cada consulta de los workflows contra el esquema |
| `npm run test:front` | 240 pruebas de Vitest y Testing Library del front |

## Origen

Empezó como mi Trabajo Final de la Tecnicatura Universitaria en Programación (UTN FRM), aprobado en 2026,
que hice con Mateo Morgui. Después de la tesis lo convertí en una plataforma de varios desarrolladores, con
bolsa de proyectos, mensajes, reputación y pago protegido por hitos.

📄 [Informe del Trabajo Final](FormularioLeads/Informe-Trabajo-Final.pdf) ·
🔧 [Documentación técnica e instalación](docs/README-tecnico.md) ·
🚀 [Despliegue de la demo](docs/despliegue-demo.md)
