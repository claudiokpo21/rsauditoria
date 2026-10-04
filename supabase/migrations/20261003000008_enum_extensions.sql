-- =====================================================================
-- HSE Audit Manager · 0008 · Extensión de tipos para metodologías CSMS
-- (ALTER TYPE ... ADD VALUE se aísla en su propia migración: los valores
-- nuevos no pueden usarse en la misma transacción en que se crean)
-- =====================================================================

-- Escala de situación: NC / OBS / OPM / OK / N/A (lista H&P de segunda parte)
alter type public.hse_response_type add value if not exists 'situacion';

-- "NC" sin distinción mayor/menor, tal como la usa la lista H&P
alter type public.hse_finding_type add value if not exists 'no_conformidad' before 'nc_mayor';
