#!/usr/bin/env node
// Operacionalización de la «carga administrativa» definida en §1.5.
//
//   carga administrativa = número de acciones manuales del profesional
//   por lead gestionado, desde el ingreso del contacto hasta el registro
//   del cobro. Acción manual = toda interacción del profesional con una
//   herramienta (redactar un correo, copiar datos entre sistemas, generar
//   un documento, actualizar una planilla).
//
// QUÉ MIDE Y QUÉ NO
// -----------------
// Mide el CONTEO de acciones del ciclo, no el tiempo ni el esfuerzo. Es una
// medición sobre el artefacto —de diseño—, no un estudio empírico con
// usuarios: no observa a ningún freelancer real ni cronometra nada. Sirve
// para afirmar «el sistema absorbe N de las M acciones del ciclo», que es
// una afirmación verificable; NO para afirmar cuánto trabajo ahorra en
// horas, que exigiría el estudio que plantea el Capítulo 8.
//
// CÓMO LO MIDE
// ------------
// Cada acción del ciclo se declara junto al nodo del flujo que la ejecuta.
// El script comprueba que ese nodo exista realmente en
// workflow/crm_postgres.json y falla si alguno desapareció, de modo que la
// medición se invalida sola si el artefacto cambia.
//
// Uso:  node scripts/medir-carga-administrativa.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLUJO = path.join(RAIZ, 'workflow', 'crm_postgres.json');

const SISTEMA = 'sistema';
const PROFESIONAL = 'profesional';

// Ciclo principal de un lead calificado, del ingreso al cierre.
// nodo: el que respalda la acción en el flujo exportado.
const CICLO = [
  ['Registrar el contacto entrante en el sistema de gestión', SISTEMA, 'Postgres - Insert Lead'],
  ['Calificar la oportunidad y asignarle prioridad',           SISTEMA, 'Code - Scoring'],
  ['Crear la ficha de seguimiento del cliente',                SISTEMA, 'Notion - Crear Card'],
  ['Acusar recibo al interesado',                              SISTEMA, 'Gmail - Acuse Lead Frio'],
  ['Decidir precio, plazo y alcance de la propuesta',          PROFESIONAL, 'Postgres - Guardar Terminos'],
  ['Redactar y enviar la propuesta',                           SISTEMA, 'Gmail - Enviar Propuesta'],
  ['Registrar que la propuesta salió',                         SISTEMA, 'Postgres - Estado Propuesta Enviada'],
  ['Insistir ante la falta de respuesta (hasta 3 veces)',      SISTEMA, 'Gmail - Enviar Follow-up'],
  ['Registrar cada seguimiento',                               SISTEMA, 'Postgres - Update Lead Seguimiento'],
  ['Registrar la aceptación del cliente',                      SISTEMA, 'Postgres - Marcar Aceptado'],
  ['Generar el comprobante en PDF',                            SISTEMA, 'HTTP - Gotenberg PDF'],
  ['Enviar la factura al cliente',                             SISTEMA, 'Gmail - Enviar Factura PDF'],
  ['Archivar la factura emitida',                              SISTEMA, 'Postgres - Insert Factura'],
  ['Generar el enlace de pago',                                SISTEMA, 'Code - Resolver Link de Pago'],
  ['Reclamar el pago vencido (hasta 4 avisos)',                SISTEMA, 'Gmail - Recordatorio Pago'],
  ['Registrar el cobro',                                       SISTEMA, 'Postgres - Marcar Cobrado Stripe'],
  ['Dar por cerrado el proyecto',                              PROFESIONAL, 'Postgres - Lead Cerrado'],
  ['Solicitar el testimonio',                                  SISTEMA, 'Gmail - Solicitar Testimonio'],
];

// Acciones que el profesional conserva sólo si el camino se desvía.
const CONTINGENTES = [
  ['Resolver un pedido de cambios del cliente', 'Postgres - Reabrir Propuesta'],
  ['Actualizar el estado de ejecución del trabajo', 'Postgres - Actualizar Estado Trabajo'],
  ['Cancelar un lead', 'Postgres - Marcar Cancelado'],
];

const flujo = JSON.parse(readFileSync(FLUJO, 'utf8'));
const nombres = new Set(flujo.nodes.map((n) => n.name));

const faltan = [...CICLO, ...CONTINGENTES]
  .map((f) => f[f.length - 1])
  .filter((n) => !nombres.has(n));

if (faltan.length) {
  console.error('El flujo ya no contiene estos nodos declarados por la medición:');
  for (const n of faltan) console.error('  ·', n);
  console.error('\nLa medición queda invalidada: hay que revisarla contra el artefacto.');
  process.exit(1);
}

const delSistema = CICLO.filter((a) => a[1] === SISTEMA);
const delProfesional = CICLO.filter((a) => a[1] === PROFESIONAL);
const pct = (100 * delSistema.length) / CICLO.length;

console.log('Carga administrativa por lead — definición operacional de §1.5\n');
console.log(`Acciones del ciclo, del ingreso al cierre: ${CICLO.length}\n`);

console.log('Las ejecuta el SISTEMA:');
for (const [a, , n] of delSistema) console.log(`   · ${a.padEnd(52)} ${n}`);

console.log('\nLas conserva el PROFESIONAL:');
for (const [a, , n] of delProfesional) console.log(`   · ${a.padEnd(52)} ${n}`);

console.log('\nSólo si el camino se desvía:');
for (const [a, n] of CONTINGENTES) console.log(`   · ${a.padEnd(52)} ${n}`);

console.log('\n' + '='.repeat(64));
console.log(`Delegadas en el sistema : ${delSistema.length} de ${CICLO.length}  (${pct.toFixed(0)} %)`);
console.log(`Conservadas manualmente : ${delProfesional.length} de ${CICLO.length}  (${(100 - pct).toFixed(0)} %)`);
console.log('='.repeat(64));
console.log('\nAlcance: conteo de acciones sobre el artefacto. No mide tiempo ni');
console.log('esfuerzo, y no sustituye al estudio con usuarios del Capítulo 8.');
