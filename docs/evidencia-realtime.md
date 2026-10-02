# evidencia realtime

> **Evidencia histórica (03-sep-2026):** la salida siguiente corresponde al
> medidor anterior y al lead que ya existía entonces. No es una medición del
> medidor actual con sesión autenticada y fixture propio, ni acredita el estado
> de Realtime de un despliegue actual. No se ejecutó una nueva medición aquí.

| campo | valor |
| --- | --- |
| comando | `node scripts/medir-realtime.mjs --n 20` |
| marca temporal (UTC) | 2026-09-03T00:22:04.104Z |
| commit | c09008d28176c2f909de5b119cf06b13f831e947 |
| commit (corto) | c09008d |
| arbol de trabajo | limpio |
| codigo de salida | 0 |
| duracion | 15.3 s |

## salida

```
Escenario E7 — actualización en tiempo real del tablero
Umbral RNF6: 3000 ms · repeticiones: 20

Lead observado: LD-E11E12-RECORDATORIO (Cliente E12 Recordatorio)
Canal abierto.

  repetición 1: 814 ms
  repetición 2: 538 ms
  repetición 3: 540 ms
  repetición 4: 540 ms
  repetición 5: 555 ms
  repetición 6: 537 ms
  repetición 7: 540 ms
  repetición 8: 541 ms
  repetición 9: 541 ms
  repetición 10: 539 ms
  repetición 11: 534 ms
  repetición 12: 535 ms
  repetición 13: 540 ms
  repetición 14: 540 ms
  repetición 15: 540 ms
  repetición 16: 543 ms
  repetición 17: 524 ms
  repetición 18: 527 ms
  repetición 19: 540 ms
  repetición 20: 542 ms

====================================================
Eventos recibidos : 20 de 20
Latencias (ms)    : 524, 527, 534, 535, 537, 538, 539, 540, 540, 540, 540, 540, 540, 540, 541, 541, 542, 543, 555, 814
Máxima            : 814 ms
p95               : 555 ms  (0.56 s)
Umbral RNF6       : 3000 ms
Resultado         : CUMPLE
====================================================
```
