-- =====================================================================
-- HSE Audit Manager · 0010 · Códigos de respuesta de la escala de situación
-- Reemplaza el CHECK de hse_audit_responses.answer para admitir
-- nc / obs / opm / ok / na además de los códigos genéricos.
-- =====================================================================
alter table public.hse_audit_responses drop constraint hse_audit_responses_answer_check;
alter table public.hse_audit_responses add constraint hse_audit_responses_answer_check
  check (answer in ('cumple','no_cumple','no_aplica','si','no','nc','obs','opm','ok','na'));
