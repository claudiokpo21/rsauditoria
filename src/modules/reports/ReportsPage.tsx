import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useOrgRows, useNameMap } from '../../db/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Button, Card, Field, Input, PageHeader, Select, useToast } from '../../components/ui';
import { loadAuditReport } from './reportData';
import { buildAuditPdf } from './pdf';
import { buildAuditXlsx, buildOrgXlsx, downloadBlob } from './excel';
import { loadSummary } from './summary';
import { buildMgmtPdf, buildMgmtXlsx, loadMgmtDetail } from './management';
import { LABELS, type Audit, type Company } from '../../types';

const safe = (s: string) => s.replace(/[^\w\-.]+/g, '_').slice(0, 60);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function ReportsPage() {
  const { current, orgId } = useAuth();
  const toast = useToast();
  const [sp] = useSearchParams();
  const audits = (useOrgRows<Audit>('hse_audits') ?? []).sort((a, b) => (b.scheduled_date ?? '').localeCompare(a.scheduled_date ?? ''));
  const companies = useOrgRows<Company>('hse_companies') ?? [];
  const cName = useNameMap('hse_companies');
  const [sel, setSel] = useState(sp.get('audit') ?? '');
  const [photos, setPhotos] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 365 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));
  const [company, setCompany] = useState('');
  const orgName = current?.organization_name ?? '';

  const run = async (kind: 'pdf' | 'xlsx' | 'org' | 'mpdf' | 'mxlsx') => {
    setBusy(kind);
    try {
      if (kind === 'org') { downloadBlob(await buildOrgXlsx(orgId, orgName), `HSE_${safe(orgName)}_${iso(new Date())}.xlsx`); return; }
      if (kind === 'mpdf' || kind === 'mxlsx') {
        const f = { from: from || null, to: to || null, company: company || null, companyName: company ? cName.get(company) : undefined };
        const [s, det] = await Promise.all([loadSummary(orgId, f.from, f.to, f.company), loadMgmtDetail(orgId, f)]);
        if (s.source === 'dispositivo') toast('Sin conexión: los indicadores se calcularon con los datos del dispositivo', 'info');
        const base = `Gestion_HSE_${safe(orgName)}_${f.from ?? ''}_${f.to ?? ''}`;
        if (kind === 'mpdf') downloadBlob(await buildMgmtPdf(orgName, f, s, det), `${base}.pdf`);
        else downloadBlob(await buildMgmtXlsx(orgName, f, s, det), `${base}.xlsx`);
        return;
      }
      const r = await loadAuditReport(sel, orgName);
      const base = `Auditoria_${safe(r.audit.code ?? r.audit.title)}`;
      if (kind === 'pdf') downloadBlob(await buildAuditPdf(r, { includePhotos: photos }), `${base}.pdf`);
      else downloadBlob(await buildAuditXlsx(r), `${base}.xlsx`);
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'bad'); } finally { setBusy(null); }
  };

  return (
    <div className="stack-lg">
      <PageHeader title="Informes" subtitle="Se generan en el dispositivo. Los resultados de cada auditoría son los oficiales que calculó el servidor con las reglas versionadas de la plantilla." />
      <Card title="Informe de una auditoría">
        <div className="stack">
          <Field label="Auditoría"><Select placeholder="Elegir…" value={sel} onChange={e => setSel(e.target.value)}
            options={audits.map(a => ({ value: a.id, label: `${a.code ?? '(sin código)'} · ${a.title} · ${cName.get(a.company_id ?? '') ?? ''} · ${LABELS.auditStatus[a.status]}` }))} /></Field>
          <label className="row gap small"><input type="checkbox" checked={photos} onChange={e => setPhotos(e.target.checked)} /> Incluir registro fotográfico en el PDF</label>
          <p className="muted small">Contenido: datos generales, resultado oficial y por sección, conclusiones, checklist, hallazgos con pregunta, requisito, clasificación, responsable, vencimiento, análisis de causa raíz, plan de acción con criterio y verificación de eficacia, fotografías e historial.</p>
          <div className="row gap wrap">
            <Button disabled={!sel} busy={busy === 'pdf'} onClick={() => void run('pdf')}>Descargar PDF</Button>
            <Button variant="secondary" disabled={!sel} busy={busy === 'xlsx'} onClick={() => void run('xlsx')}>Descargar Excel</Button>
          </div>
        </div>
      </Card>
      <Card title="Informe de gestión">
        <div className="stack">
          <div className="grid grid-3">
            <Field label="Desde"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
            <Field label="Hasta"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
            <Field label="Empresa"><Select placeholder="Todas" value={company} onChange={e => setCompany(e.target.value)} options={companies.map(c => ({ value: c.id, label: c.name }))} /></Field>
          </div>
          <p className="muted small">Resultados por categoría de plantilla y por sección, distribución de hallazgos, planes de acción, eficacia, hallazgos recurrentes, empresas, evolución mensual y seguimiento de auditorías, hallazgos y acciones vencidas. Con conexión los indicadores los calcula el servidor; sin conexión, el dispositivo (se indica en el informe).</p>
          <div className="row gap wrap">
            <Button busy={busy === 'mpdf'} onClick={() => void run('mpdf')}>Descargar PDF</Button>
            <Button variant="secondary" busy={busy === 'mxlsx'} onClick={() => void run('mxlsx')}>Descargar Excel</Button>
          </div>
        </div>
      </Card>
      <Card title="Consolidado de datos">
        <p className="muted small">Todas las auditorías, hallazgos y acciones sincronizados en un libro Excel con filtros.</p>
        <Button variant="secondary" busy={busy === 'org'} onClick={() => void run('org')}>Descargar consolidado (.xlsx)</Button>
      </Card>
    </div>
  );
}
