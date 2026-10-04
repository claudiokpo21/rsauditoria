import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useOrgRows } from '../../db/hooks';
import { newId, saveRecord } from '../../db/repo';
import { db } from '../../db/db';
import { useAuth, can } from '../auth/AuthProvider';
import { Badge, Button, Empty, Field, Input, Modal, PageHeader, Select, TextArea, useToast } from '../../components/ui';
import { LABELS, type Template, type TemplateCategory, type TemplateVersion } from '../../types';

export function TemplatesPage() {
  const { orgId, role } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const templates = (useOrgRows<Template>('hse_templates') ?? []).sort((a, b) => a.name.localeCompare(b.name));
  const versions = useOrgRows<TemplateVersion>('hse_template_versions') ?? [];
  const [creating, setCreating] = useState<{ name: string; category: TemplateCategory; description: string } | null>(null);

  const create = async () => {
    if (!creating || creating.name.trim().length < 2) { toast('Indique el nombre', 'bad'); return; }
    const t = await saveRecord<Template>('hse_templates', { id: newId(), organization_id: orgId, name: creating.name.trim(), category: creating.category, description: creating.description || null, active: true } as Template);
    await saveRecord<TemplateVersion>('hse_template_versions', { id: newId(), organization_id: orgId, template_id: t.id, version_number: 1, status: 'borrador', scoring_method: 'ponderado', scoring_config: {}, change_notes: 'Versión inicial' } as TemplateVersion, [db.hse_templates]);
    setCreating(null); nav(`/plantillas/${t.id}`);
  };

  return (
    <div>
      <PageHeader title="Plantillas de auditoría" subtitle="Cada auditoría queda atada a la versión publicada con la que se ejecutó."
        actions={can(role, 'templates') ? <>
          <Link className="btn btn-secondary" to="/plantillas/importar">Importar Excel</Link>
          <Button onClick={() => setCreating({ name: '', category: 'seguridad_higiene', description: '' })}>Nueva plantilla</Button>
        </> : null} />
      {templates.length === 0 ? <Empty>No hay plantillas. Cree una o importe una lista de verificación en Excel.</Empty> : (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Plantilla</th><th>Categoría</th><th>Versión publicada</th><th>Borrador</th><th>Metodología</th></tr></thead>
          <tbody>{templates.map(t => {
            const vs = versions.filter(v => v.template_id === t.id);
            const pub = vs.find(v => v.status === 'publicada'); const draft = vs.find(v => v.status === 'borrador');
            const ref = pub ?? draft;
            return (
              <tr key={t.id} className="clickable" onClick={() => nav(`/plantillas/${t.id}`)}>
                <td><strong>{t.name}</strong><div className="muted small">{t.description}</div></td>
                <td>{LABELS.category[t.category]}</td>
                <td>{pub ? <Badge tone="ok">v{pub.version_number}</Badge> : <span className="muted">—</span>}</td>
                <td>{draft ? <Badge tone={draft.validation_status === 'pendiente' ? 'warn' : 'neutral'}>v{draft.version_number} · {LABELS.validationStatus[draft.validation_status]}</Badge> : '—'}</td>
                <td className="small">{ref?.scoring_method === 'situacion_promedio_secciones' ? 'NC/OBS/OPM/OK · promedio de secciones' : 'Ponderada (cumple / no cumple)'}</td>
              </tr>);
          })}</tbody>
        </table></div>
      )}
      <Modal open={!!creating} title="Nueva plantilla" onClose={() => setCreating(null)}
        footer={<><Button variant="secondary" onClick={() => setCreating(null)}>Cancelar</Button><Button onClick={create}>Crear y editar</Button></>}>
        {creating ? <>
          <Field label="Nombre" required><Input value={creating.name} onChange={e => setCreating({ ...creating, name: e.target.value })} /></Field>
          <Field label="Categoría"><Select value={creating.category} onChange={e => setCreating({ ...creating, category: e.target.value as TemplateCategory })} options={Object.entries(LABELS.category).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Descripción"><TextArea value={creating.description} onChange={e => setCreating({ ...creating, description: e.target.value })} /></Field>
          <p className="muted small">Se crea con la metodología ponderada estándar: Cumple suma el peso del ítem, No cumple suma 0 y N/A queda fuera del máximo. Para metodologías propias (p. ej. NC/OBS/OPM/OK) importe la lista desde Excel: así las reglas quedan trazadas y validadas.</p>
        </> : null}
      </Modal>
    </div>
  );
}
