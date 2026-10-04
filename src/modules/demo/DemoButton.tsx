import { useState } from 'react';
import { supabase, errorMessage } from '../../lib/supabase';
import { runSync } from '../../sync/scheduler';
import { useAuth } from '../auth/AuthProvider';
import { Button, Modal, useToast } from '../../components/ui';

/**
 * Crea una organización APARTE llamada "Organización de ejemplo", con plantillas, contratistas,
 * auditorías, hallazgos y acciones ficticias (RPC hse_load_demo). No toca los datos reales:
 * se cambia de organización desde la barra superior.
 */
export function DemoButton({ variant = 'secondary' }: { variant?: 'primary' | 'secondary' }) {
  const { refresh, selectOrg, memberships } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const existing = memberships.find(m => m.organization_name === 'Organización de ejemplo');

  if (existing) return <Button variant={variant} onClick={() => void selectOrg(existing.organization_id)}>Ir a la organización de ejemplo</Button>;

  const create = async () => {
    setBusy(true);
    try {
      const payload = (await import('./hp-payload.json')).default;
      const { data, error } = await supabase.rpc('hse_load_demo', { p_payload: payload });
      if (error) throw error;
      await refresh();
      await selectOrg(data as string);
      void runSync();
      toast('Organización de ejemplo creada');
      setOpen(false);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      toast(code === 'PGRST202' || /hse_load_demo/.test(errorMessage(e)) ? 'Falta actualizar la base de datos del servidor (migración 0024) para crear la organización de ejemplo.' : errorMessage(e), 'bad');
    } finally { setBusy(false); }
  };

  return <>
    <Button variant={variant} onClick={() => setOpen(true)} disabled={!navigator.onLine} title={navigator.onLine ? undefined : 'Requiere conexión'}>Crear organización de ejemplo</Button>
    <Modal open={open} title="Organización de ejemplo" onClose={() => setOpen(false)}
      footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button busy={busy} onClick={create}>Crear y abrir</Button></>}>
      <p style={{ margin: 0 }}>Se crea una organización aparte, con datos ficticios, para recorrer la aplicación sin mezclar información real:</p>
      <ul className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
        <li>La lista de verificación CSMS a segundas partes (H&P) publicada, y una inspección de seguridad e higiene ponderada.</li>
        <li>Tres contratistas de ejemplo con 8 auditorías: una con las respuestas de la planilla original (resultado 6,27 – Bueno), otras Muy Bueno, Regular y Crítico, planificadas y en curso.</li>
        <li>Hallazgos con análisis de causa raíz, planes de acción vencidos y por vencer, verificaciones de eficacia y hallazgos recurrentes.</li>
      </ul>
      <p className="small muted" style={{ margin: 0 }}>Usted queda como administrador. Para volver a su organización, elíjala en la barra superior.</p>
    </Modal>
  </>;
}
