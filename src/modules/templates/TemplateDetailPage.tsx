import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useOrgRows, useRecord, useNameMap } from '../../db/hooks';
import { newId, patchRecord, saveRecord, softDelete } from '../../db/repo';
import { supabase, errorMessage } from '../../lib/supabase';
import { runSync } from '../../sync/scheduler';
import { useAuth, can } from '../auth/AuthProvider';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, TextArea, displayText, fmtDateTime, useToast } from '../../components/ui';
import { LABELS, type ResponseType, type Template, type TemplateItem, type TemplateSection, type TemplateVersion } from '../../types';
import { ValidationPanel } from './ValidationPanel';
import { MethodologyCard } from './MethodologyCard';

export function TemplateDetailPage() {
  const { id } = useParams();
  const { orgId, role } = useAuth();
  const toast = useToast();
  const tpl = useRecord<Template>('hse_templates', id);
  const versions = (useOrgRows<TemplateVersion>('hse_template_versions') ?? []).filter(v => v.template_id === id).sort((a, b) => b.version_number - a.version_number);
  const [selId, setSelId] = useState<string | null>(null);
  const sel = versions.find(v => v.id === selId) ?? versions.find(v => v.status === 'borrador') ?? versions.find(v => v.status === 'publicada') ?? versions[0];
  const sections = (useOrgRows<TemplateSection>('hse_template_sections', [sel?.id]) ?? []).filter(s => s.version_id === sel?.id).sort((a, b) => a.sort_order - b.sort_order);
  const items = (useOrgRows<TemplateItem>('hse_template_items', [sel?.id]) ?? []).filter(i => i.version_id === sel?.id);
  const processes = useNameMap('hse_processes');
  const editable = can(role, 'templates') && sel?.status === 'borrador';
  const [busy, setBusy] = useState(false);
  const [secEdit, setSecEdit] = useState<Partial<TemplateSection> | null>(null);
  const [itemEdit, setItemEdit] = useState<Partial<TemplateItem> | null>(null);
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const bySection = useMemo(() => {
    const m = new Map<string, TemplateItem[]>();
    for (const i of items) { const a = m.get(i.section_id) ?? []; a.push(i); m.set(i.section_id, a); }
    for (const a of m.values()) a.sort((x, y) => x.sort_order - y.sort_order);
    return m;
  }, [items]);

  if (tpl === undefined) return null;
  if (tpl === null) return <Empty>Plantilla no encontrada en este dispositivo.</Empty>;

  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    if (!navigator.onLine) { toast('Esta acción requiere conexión', 'bad'); return; }
    setBusy(true);
    try {
      await runSync();                                  // enviar antes los cambios locales
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw error;
      await runSync(); toast(ok); return data;
    } catch (e) { toast(errorMessage(e), 'bad'); } finally { setBusy(false); }
  };

  const saveSection = async () => {
    if (!secEdit?.title?.trim() || !sel) return;
    await saveRecord<TemplateSection>('hse_template_sections', { id: secEdit.id ?? newId(), organization_id: orgId, version_id: sel.id, title: secEdit.title, description: secEdit.description ?? null, code: secEdit.code ?? null, sort_order: secEdit.sort_order ?? sections.length } as TemplateSection);
    setSecEdit(null);
  };
  const saveItem = async () => {
    if (!itemEdit?.question || itemEdit.question.trim().length < 3 || !sel || !itemEdit.section_id) { toast('Complete la pregunta', 'bad'); return; }
    const siblings = bySection.get(itemEdit.section_id) ?? [];
    await saveRecord<TemplateItem>('hse_template_items', {
      id: itemEdit.id ?? newId(), organization_id: orgId, version_id: sel.id, section_id: itemEdit.section_id,
      code: itemEdit.code || null, question: itemEdit.question, guidance: itemEdit.guidance || null,
      response_type: itemEdit.response_type ?? (sel.scoring_method === 'situacion_promedio_secciones' ? 'situacion' : 'cumplimiento'),
      weight: Number(itemEdit.weight ?? 1), is_critical: !!itemEdit.is_critical, evidence_required_on_fail: itemEdit.evidence_required_on_fail ?? true,
      legal_reference: itemEdit.legal_reference || null, sort_order: itemEdit.sort_order ?? siblings.length, process_id: itemEdit.process_id || null,
    } as TemplateItem);
    setItemEdit(null);
  };
  const move = async (list: { id: string; sort_order: number }[], idx: number, dir: -1 | 1, table: 'hse_template_sections' | 'hse_template_items') => {
    const j = idx + dir; if (j < 0 || j >= list.length) return;
    const a = list[idx], b = list[j];
    await patchRecord(table, a.id, { sort_order: b.sort_order === a.sort_order ? a.sort_order + dir : b.sort_order } as never);
    await patchRecord(table, b.id, { sort_order: a.sort_order } as never);
  };
  const rtOptions = Object.entries(LABELS.responseType)
    .filter(([k]) => sel?.scoring_method === 'situacion_promedio_secciones' ? k === 'situacion' : k !== 'situacion')
    .map(([value, label]) => ({ value, label }));
  const hasDraft = versions.some(v => v.status === 'borrador');

  return (
    <div className="stack-lg">
      <PageHeader title={tpl.name} subtitle={<>{LABELS.category[tpl.category]} · {tpl.description}</>}
        actions={can(role, 'templates') ? <>
          <Button variant="secondary" onClick={() => setNameEdit(tpl.name)}>Renombrar</Button>
          {!hasDraft ? <Button variant="secondary" busy={busy} onClick={() => void rpc('hse_new_template_version', { p_template: tpl.id, p_from_version: sel?.id ?? null }, 'Borrador creado a partir de la versión seleccionada')}>Nueva versión</Button> : null}
          {sel?.status === 'borrador' ? <Button busy={busy} disabled={!['no_requerida', 'validada'].includes(sel.validation_status) || items.length === 0}
            title={sel.validation_status === 'pendiente' ? 'Debe validarse antes de publicar' : undefined}
            onClick={() => void rpc('hse_publish_template_version', { p_version: sel.id }, 'Versión publicada')}>Publicar v{sel.version_number}</Button> : null}
        </> : null} />

      <div className="row gap wrap">
        {versions.map(v => (
          <button key={v.id} className={`tab ${v.id === sel?.id ? 'active' : ''}`} onClick={() => setSelId(v.id)}>
            v{v.version_number} · {LABELS.versionStatus[v.status]}
          </button>
        ))}
      </div>

      {sel ? <>
        <div className="row gap wrap">
          <Badge tone={sel.status === 'publicada' ? 'ok' : sel.status === 'borrador' ? 'info' : 'neutral'}>{LABELS.versionStatus[sel.status]}</Badge>
          <Badge tone={sel.validation_status === 'validada' ? 'ok' : sel.validation_status === 'pendiente' ? 'warn' : sel.validation_status === 'rechazada' ? 'bad' : 'neutral'}>{LABELS.validationStatus[sel.validation_status]}</Badge>
          {sel.published_at ? <span className="muted small">Publicada {fmtDateTime(sel.published_at)}</span> : null}
          {sel.source_file_name ? <span className="muted small">Origen: {sel.source_file_name} · SHA-256 <span className="mono">{sel.source_sha256?.slice(0, 12)}…</span></span> : null}
          <span className="muted small">{sections.length} secciones · {items.length} ítems</span>
        </div>
        {sel.status === 'borrador' && sel.validation_status === 'pendiente' ? <div className="alert alert-warn">Esta versión no puede publicarse hasta revisar las incidencias de importación, verificar los casos de validación y validarla con fundamento.</div> : null}

        <MethodologyCard version={sel} />
        {sel.validation_status !== 'no_requerida' ? <ValidationPanel version={sel} sections={sections} items={items} onRpc={rpc} busy={busy} /> : null}

        <Card title="Contenido" actions={editable ? <Button className="btn-sm" onClick={() => setSecEdit({})}>Agregar sección</Button> : null}>
          {sections.length === 0 ? <Empty>Sin secciones.</Empty> : (
            <div className="stack">
              {sections.map((s, si) => {
                const its = bySection.get(s.id) ?? [];
                return (
                  <div key={s.id} className="section-block">
                    <div className="section-head" style={{ cursor: 'default' }}>
                      <h3>{displayText(s.title)} <span className="muted small">({its.length})</span></h3>
                      {editable ? <div className="row gap">
                        <Button variant="ghost" className="btn-sm" onClick={() => void move(sections, si, -1, 'hse_template_sections')} aria-label="Subir">↑</Button>
                        <Button variant="ghost" className="btn-sm" onClick={() => void move(sections, si, 1, 'hse_template_sections')} aria-label="Bajar">↓</Button>
                        <Button variant="ghost" className="btn-sm" onClick={() => setSecEdit(s)}>Editar</Button>
                        <Button variant="ghost" className="btn-sm" onClick={() => setItemEdit({ section_id: s.id, weight: 1, evidence_required_on_fail: true })}>+ Ítem</Button>
                      </div> : null}
                    </div>
                    {its.map((it, ii) => (
                      <div key={it.id} className="item">
                        <div className="item-q">
                          <span className="item-num">{it.original_number ?? it.code ?? '—'}</span>
                          <div className="grow">
                            <div className="pre">{displayText(it.question)}</div>
                            <div className="row gap wrap small muted" style={{ marginTop: '.3rem' }}>
                              {it.process_id ? <Badge>{processes.get(it.process_id)}</Badge> : null}
                              <span>{LABELS.responseType[it.response_type]}</span>
                              {sel.scoring_method === 'ponderado' ? <span>Peso {it.weight}</span> : null}
                              {it.is_critical ? <Badge tone="bad">Crítico</Badge> : null}
                              {it.legal_reference ? <span>{it.legal_reference}</span> : null}
                              {it.review_flags?.map(f => <Badge key={f} tone="warn">{f.replace(/_/g, ' ')}</Badge>)}
                              {it.source_ref ? <span className="mono">{it.source_ref}</span> : null}
                            </div>
                          </div>
                          {editable ? <div className="row gap" style={{ alignItems: 'flex-start' }}>
                            <Button variant="ghost" className="btn-sm" onClick={() => void move(its, ii, -1, 'hse_template_items')} aria-label="Subir">↑</Button>
                            <Button variant="ghost" className="btn-sm" onClick={() => void move(its, ii, 1, 'hse_template_items')} aria-label="Bajar">↓</Button>
                            <Button variant="ghost" className="btn-sm" onClick={() => setItemEdit(it)}>Editar</Button>
                          </div> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </> : <Empty>La plantilla no tiene versiones.</Empty>}

      <Modal open={!!secEdit} title={secEdit?.id ? 'Editar sección' : 'Nueva sección'} onClose={() => setSecEdit(null)}
        footer={<>{secEdit?.id ? <Button variant="danger" onClick={async () => { await softDelete('hse_template_sections', secEdit.id!); setSecEdit(null); }}>Eliminar</Button> : null}<div className="grow" /><Button variant="secondary" onClick={() => setSecEdit(null)}>Cancelar</Button><Button onClick={saveSection}>Guardar</Button></>}>
        {secEdit ? <>
          <Field label="Título" required><Input value={secEdit.title ?? ''} onChange={e => setSecEdit({ ...secEdit, title: e.target.value })} /></Field>
          <Field label="Código"><Input value={secEdit.code ?? ''} onChange={e => setSecEdit({ ...secEdit, code: e.target.value })} /></Field>
          <Field label="Descripción"><TextArea value={secEdit.description ?? ''} onChange={e => setSecEdit({ ...secEdit, description: e.target.value })} /></Field>
        </> : null}
      </Modal>

      <Modal wide open={!!itemEdit} title={itemEdit?.id ? 'Editar ítem' : 'Nuevo ítem'} onClose={() => setItemEdit(null)}
        footer={<>{itemEdit?.id ? <Button variant="danger" onClick={async () => { await softDelete('hse_template_items', itemEdit.id!); setItemEdit(null); }}>Eliminar</Button> : null}<div className="grow" /><Button variant="secondary" onClick={() => setItemEdit(null)}>Cancelar</Button><Button onClick={saveItem}>Guardar</Button></>}>
        {itemEdit ? <>
          <Field label="Requisito / pregunta" required><TextArea rows={5} value={itemEdit.question ?? ''} onChange={e => setItemEdit({ ...itemEdit, question: e.target.value })} /></Field>
          <div className="grid grid-2">
            <Field label="Código / N.º"><Input value={itemEdit.code ?? ''} onChange={e => setItemEdit({ ...itemEdit, code: e.target.value })} /></Field>
            <Field label="Proceso"><Select placeholder="—" value={itemEdit.process_id ?? ''} onChange={e => setItemEdit({ ...itemEdit, process_id: e.target.value })} options={[...processes].map(([value, label]) => ({ value, label }))} /></Field>
            <Field label="Tipo de respuesta"><Select value={itemEdit.response_type ?? rtOptions[0]?.value} onChange={e => setItemEdit({ ...itemEdit, response_type: e.target.value as ResponseType })} options={rtOptions} /></Field>
            {sel?.scoring_method === 'ponderado' ? <Field label="Peso"><Input type="number" min={0} max={100} step="0.5" value={itemEdit.weight ?? 1} onChange={e => setItemEdit({ ...itemEdit, weight: Number(e.target.value) })} /></Field> : null}
            <Field label="Crítico"><Select value={itemEdit.is_critical ? 'si' : 'no'} onChange={e => setItemEdit({ ...itemEdit, is_critical: e.target.value === 'si' })} options={[{ value: 'no', label: 'No' }, { value: 'si', label: 'Sí' }]} /></Field>
            <Field label="Exigir evidencia ante desvío"><Select value={itemEdit.evidence_required_on_fail === false ? 'no' : 'si'} onChange={e => setItemEdit({ ...itemEdit, evidence_required_on_fail: e.target.value === 'si' })} options={[{ value: 'si', label: 'Sí' }, { value: 'no', label: 'No' }]} /></Field>
          </div>
          <Field label="Guía para el auditor"><TextArea value={itemEdit.guidance ?? ''} onChange={e => setItemEdit({ ...itemEdit, guidance: e.target.value })} /></Field>
          <Field label="Referencia legal / normativa"><Input value={itemEdit.legal_reference ?? ''} onChange={e => setItemEdit({ ...itemEdit, legal_reference: e.target.value })} placeholder="Ej.: Ley 19.587 · Dec. 351/79 Anexo IV" /></Field>
        </> : null}
      </Modal>

      <Modal open={nameEdit !== null} title="Renombrar plantilla" onClose={() => setNameEdit(null)}
        footer={<><Button variant="secondary" onClick={() => setNameEdit(null)}>Cancelar</Button><Button onClick={async () => { if (nameEdit && nameEdit.trim().length > 1) { await patchRecord('hse_templates', tpl.id, { name: nameEdit.trim() } as never); setNameEdit(null); } }}>Guardar</Button></>}>
        <Field label="Nombre"><Input value={nameEdit ?? ''} onChange={e => setNameEdit(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}
