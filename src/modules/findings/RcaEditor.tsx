import { useState } from 'react';
import { patchRecord } from '../../db/repo';
import { Button, Field, Select, TextArea, useToast } from '../../components/ui';
import { LABELS, type Finding, type IshikawaCat, type RcaData } from '../../types';

const CATS = Object.keys(LABELS.ishikawa) as IshikawaCat[];

/** Análisis de causa raíz: 5 porqués, Ishikawa (6M) u otro método, con la conclusión (causa raíz). */
export function RcaEditor({ finding, readOnly }: { finding: Finding; readOnly: boolean }) {
  const toast = useToast();
  const [method, setMethod] = useState<NonNullable<Finding['rca_method']>>(finding.rca_method ?? 'cinco_porques');
  const [data, setData] = useState<RcaData>(finding.rca_data ?? {});
  const [cause, setCause] = useState(finding.root_cause ?? '');
  const [editing, setEditing] = useState(false);
  const whys = data.whys?.length ? data.whys : ['', '', '', '', ''];

  if (!editing) {
    return (
      <div className="stack small">
        {finding.rca_method ? <div><strong>Método:</strong> {LABELS.rcaMethod[finding.rca_method]}</div> : null}
        {finding.rca_method === 'cinco_porques' && finding.rca_data?.whys?.some(Boolean) ? (
          <ol className="whys">{finding.rca_data.whys.filter(Boolean).map((w, i) => <li key={i}><span className="muted">¿Por qué? </span>{w}</li>)}</ol>
        ) : null}
        {finding.rca_method === 'ishikawa' && finding.rca_data?.ishikawa ? (
          <dl className="ishikawa">{CATS.filter(c => finding.rca_data?.ishikawa?.[c]).map(c => <div key={c}><dt>{LABELS.ishikawa[c]}</dt><dd className="pre">{finding.rca_data!.ishikawa![c]}</dd></div>)}</dl>
        ) : null}
        {finding.rca_data?.notes ? <div className="pre">{finding.rca_data.notes}</div> : null}
        <div><strong>Causa raíz:</strong> <span className="pre">{finding.root_cause || <span className="muted">sin registrar</span>}</span></div>
        {!readOnly ? <div><Button variant="secondary" className="btn-sm" onClick={() => setEditing(true)}>{finding.root_cause ? 'Editar análisis' : 'Registrar análisis'}</Button></div> : null}
      </div>
    );
  }

  const save = async () => {
    if (cause.trim().length < 5) { toast('Indique la causa raíz identificada', 'bad'); return; }
    const clean: RcaData = method === 'cinco_porques' ? { whys: whys.map(w => w.trim()).filter(Boolean), notes: data.notes }
      : method === 'ishikawa' ? { ishikawa: Object.fromEntries(CATS.filter(c => data.ishikawa?.[c]?.trim()).map(c => [c, data.ishikawa![c]!.trim()])), notes: data.notes }
      : { notes: data.notes };
    await patchRecord<Finding>('hse_findings', finding.id, { rca_method: method, rca_data: clean, root_cause: cause.trim() });
    setEditing(false); toast('Análisis de causa raíz guardado');
  };
  return (
    <div className="stack">
      <Field label="Método"><Select value={method} onChange={e => setMethod(e.target.value as typeof method)} options={Object.entries(LABELS.rcaMethod).map(([value, label]) => ({ value, label }))} /></Field>
      {method === 'cinco_porques' ? whys.map((w, i) => (
        <Field key={i} label={`${i + 1}.º ¿Por qué?`}><TextArea rows={1} value={w} onChange={e => { const x = [...whys]; x[i] = e.target.value; setData({ ...data, whys: x }); }} /></Field>
      )) : null}
      {method === 'ishikawa' ? <div className="grid grid-2">{CATS.map(c => (
        <Field key={c} label={LABELS.ishikawa[c]}><TextArea rows={2} value={data.ishikawa?.[c] ?? ''} onChange={e => setData({ ...data, ishikawa: { ...(data.ishikawa ?? {}), [c]: e.target.value } })} /></Field>
      ))}</div> : null}
      <Field label="Notas del análisis"><TextArea rows={2} value={data.notes ?? ''} onChange={e => setData({ ...data, notes: e.target.value })} /></Field>
      <Field label="Causa raíz identificada" required hint="Obligatoria para cerrar una no conformidad"><TextArea rows={2} value={cause} onChange={e => setCause(e.target.value)} /></Field>
      <div className="row gap"><Button variant="secondary" onClick={() => setEditing(false)}>Cancelar</Button><Button onClick={save}>Guardar análisis</Button></div>
    </div>
  );
}
