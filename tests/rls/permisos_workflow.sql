-- Ejecutar tras bootstrap.sql + schema.sql en PostgreSQL desechable.
-- PREPARE no comprueba los GRANT: estas sentencias se ejecutan con el rol real.
\set ON_ERROR_STOP on
DO $$
DECLARE
  permiso text;
BEGIN
  FOREACH permiso IN ARRAY ARRAY[
    'hitos.stripe_checkout_reservado_en',
    'hitos.stripe_checkout_url',
    'hitos_eventos.correo_avisado_en',
    'hitos_eventos.aviso_avisado_en',
    'checkout_revisiones.aviso_avisado_en'
  ] LOOP
    IF NOT has_column_privilege('n8n_writer', split_part(permiso, '.', 1), split_part(permiso, '.', 2), 'UPDATE') THEN
      RAISE EXCEPTION 'n8n_writer no puede actualizar %', permiso;
    END IF;
  END LOOP;
END $$;

BEGIN;
SET LOCAL ROLE n8n_writer;
UPDATE hitos SET stripe_checkout_reservado_en = now(), stripe_checkout_url = 'https://example.invalid/test' WHERE false;
UPDATE hitos_eventos SET correo_avisado_en = now(), aviso_avisado_en = now() WHERE false;
UPDATE checkout_revisiones SET aviso_avisado_en = now() WHERE false;
ROLLBACK;

-- La configuración se comprueba ANTES de reclamar cualquier movimiento.
DO $$
BEGIN
  BEGIN
    PERFORM * FROM hitos_por_mover(false);
    RAISE EXCEPTION 'se reclamaron movimientos sin Stripe';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Stripe no configurado: no se reclamaron movimientos' THEN
      RAISE;
    END IF;
  END;
END $$;
