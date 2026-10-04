import { useState } from 'react';
import { useOrgRows, usePendingSet } from '../../db/hooks';
import { newId, saveRecord, softDelete } from '../../db/repo';
import { useAuth, can } from '../auth/AuthProvider';
import { Badge, Button, Empty, Field, Input, Modal, PageHeader, Select, TextArea, fmtDate, useToast } from '../../components/ui';
import { LABELS, type Company, type Location, type Process } from '../../types';

type Tab = 'empresas' | 'ubicaciones' | 'procesos';
const opts = (o: Record<string, string>) => Object.entries(o).map(([value, label]) => ({ value, label }));

export function MastersPage() {
  const [tab, setTab] = useState<Tab>('empresas');
  return (
    <div>
      <PageHeader title="Empresas, contratistas y ubicaciones" subtitle="Datos maestros de la organización. Disponibles sin conexión." />
      <div className="tabs" role="tablist">
        {(['empresas', 'ubicaciones', 'procesos'] as Tab[]).map(t => <button key={t} role="tab" className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t === 'empresas' ? 'Empresas y contratistas' : t === 'ubicaciones' ? 'Ubicaciones' : 'Procesos auditables'}</button>)}
      </div>
      {tab === 'empresas' ? <Companies /> : tab === 'ubicaciones' ? <Locations /> : <Processes />}
    </div>
  );
}

function Companies() {
  const { orgId, role } = useAuth();
  const toast = useToast();
  const rows = (useOrgRows<Company>('hse_companies') ?? []).sort((a, b) => a.name.localeCompare(b.name));
  const pending = usePendingSet('hse_companies');
  const [edit, setEdit] = useState<Partial<Company> | null>(null);
  const editable = can(role, 'master');
  const save = async () => {
    if (!edit?.name || edit.name.trim().length < 2) { toast('Indique el nombre', 'bad'); return; }
    if (rows.some(r => r.id !== edit.id && r.name.trim().toLowerCase() === edit.name!.trim().toLowerCase())) { toast('Ya existe una empresa con ese nombre', 'bad'); return; }
    await saveRecord<Company>('hse_companies', {
      id: edit.id ?? newId(), organization_id: orgId, name: edit.name.trim(), tax_id: edit.tax_id || null,
      company_type: edit.company_type ?? 'contratista', parent_company_id: edit.parent_company_id || null,
      contact_name: edit.contact_name || null, contact_email: edit.contact_email || null, contact_phone: edit.contact_phone || null,
      csms_status: edit.csms_status ?? 'no_evaluada', csms_valid_until: edit.csms_valid_until || null, active: edit.active ?? true,
    } as Company);
    setEdit(null); toast('Empresa guardada');
  };
  const name = new Map(rows.map(r => [r.id, r.name]));
  return (
    <div className="stack">
      {editable ? <div><Button onClick={() => setEdit({ company_type: 'contratista', csms_status: 'no_evaluada', active: true })}>Nueva empresa</Button></div> : null}
      {rows.length === 0 ? <Empty>No hay empresas cargadas.</Empty> : (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Nombre</th><th>Tipo</th><th>CUIT</th><th>Depende de</th><th>CSMS</th><th>Vigencia</th><th /></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id} className={editable ? 'clickable' : ''} onClick={() => editable && setEdit(r)}>
              <td><strong>{r.name}</strong> {!r.active ? <Badge>Inactiva</Badge> : null} {pending.has(r.id) ? <Badge tone="warn">Pendiente</Badge> : null}</td>
              <td>{LABELS.companyType[r.company_type]}</td><td>{r.tax_id ?? '—'}</td><td>{r.parent_company_id ? name.get(r.parent_company_id) : '—'}</td>
              <td><Badge tone={r.csms_status === 'aprobada' ? 'ok' : r.csms_status === 'rechazada' ? 'bad' : r.csms_status === 'condicional' ? 'warn' : 'neutral'}>{LABELS.csms[r.csms_status]}</Badge></td>
              <td>{fmtDate(r.csms_valid_until)}</td><td />
            </tr>))}</tbody>
        </table></div>
      )}
      <Modal open={!!edit} title={edit?.id ? 'Editar empresa' : 'Nueva empresa'} onClose={() => setEdit(null)}
        footer={<>{edit?.id ? <Button variant="danger" onClick={async () => { await softDelete('hse_companies', edit.id!); setEdit(null); toast('Empresa eliminada'); }}>Eliminar</Button> : null}<div className="grow" /><Button variant="secondary" onClick={() => setEdit(null)}>Cancelar</Button><Button onClick={save}>Guardar</Button></>}>
        {edit ? <>
          <Field label="Razón social" required><Input value={edit.name ?? ''} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
          <div className="grid grid-2">
            <Field label="Tipo"><Select value={edit.company_type} onChange={e => setEdit({ ...edit, company_type: e.target.value as Company['company_type'] })} options={opts(LABELS.companyType)} /></Field>
            <Field label="CUIT"><Input value={edit.tax_id ?? ''} onChange={e => setEdit({ ...edit, tax_id: e.target.value })} /></Field>
          </div>
          {edit.company_type === 'subcontratista' ? <Field label="Contratista principal"><Select placeholder="—" value={edit.parent_company_id ?? ''} onChange={e => setEdit({ ...edit, parent_company_id: e.target.value })} options={rows.filter(r => r.id !== edit.id).map(r => ({ value: r.id, label: r.name }))} /></Field> : null}
          <div className="grid grid-2">
            <Field label="Contacto"><Input value={edit.contact_name ?? ''} onChange={e => setEdit({ ...edit, contact_name: e.target.value })} /></Field>
            <Field label="Correo"><Input type="email" value={edit.contact_email ?? ''} onChange={e => setEdit({ ...edit, contact_email: e.target.value })} /></Field>
            <Field label="Teléfono"><Input value={edit.contact_phone ?? ''} onChange={e => setEdit({ ...edit, contact_phone: e.target.value })} /></Field>
            <Field label="Estado CSMS"><Select value={edit.csms_status} onChange={e => setEdit({ ...edit, csms_status: e.target.value as Company['csms_status'] })} options={opts(LABELS.csms)} /></Field>
            <Field label="CSMS vigente hasta"><Input type="date" value={edit.csms_valid_until ?? ''} onChange={e => setEdit({ ...edit, csms_valid_until: e.target.value })} /></Field>
            <Field label="Activa"><Select value={edit.active === false ? 'no' : 'si'} onChange={e => setEdit({ ...edit, active: e.target.value === 'si' })} options={[{ value: 'si', label: 'Sí' }, { value: 'no', label: 'No' }]} /></Field>
          </div>
        </> : null}
      </Modal>
    </div>
  );
}

function Locations() {
  const { orgId, role } = useAuth();
  const toast = useToast();
  const rows = (useOrgRows<Location>('hse_locations') ?? []).sort((a, b) => a.name.localeCompare(b.name));
  const companies = useOrgRows<Company>('hse_companies') ?? [];
  const pending = usePendingSet('hse_locations');
  const [edit, setEdit] = useState<Partial<Location> | null>(null);
  const editable = can(role, 'master');
  const cname = new Map(companies.map(c => [c.id, c.name]));
  const lname = new Map(rows.map(c => [c.id, c.name]));
  const gps = () => navigator.geolocation?.getCurrentPosition(p => setEdit(e => ({ ...e, latitude: +p.coords.latitude.toFixed(6), longitude: +p.coords.longitude.toFixed(6) })), () => toast('No se pudo obtener la ubicación', 'bad'));
  const save = async () => {
    if (!edit?.name || edit.name.trim().length < 2) { toast('Indique el nombre', 'bad'); return; }
    await saveRecord<Location>('hse_locations', {
      id: edit.id ?? newId(), organization_id: orgId, name: edit.name.trim(), company_id: edit.company_id || null,
      parent_location_id: edit.parent_location_id || null, location_type: edit.location_type ?? 'planta', address: edit.address || null,
      latitude: edit.latitude ?? null, longitude: edit.longitude ?? null, active: edit.active ?? true,
    } as Location);
    setEdit(null); toast('Ubicación guardada');
  };
  return (
    <div className="stack">
      {editable ? <div><Button onClick={() => setEdit({ location_type: 'planta', active: true })}>Nueva ubicación</Button></div> : null}
      {rows.length === 0 ? <Empty>No hay ubicaciones cargadas.</Empty> : (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Nombre</th><th>Tipo</th><th>Empresa</th><th>Dentro de</th><th>Dirección</th><th>Coordenadas</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id} className={editable ? 'clickable' : ''} onClick={() => editable && setEdit(r)}>
              <td><strong>{r.name}</strong> {pending.has(r.id) ? <Badge tone="warn">Pendiente</Badge> : null}</td><td>{LABELS.locationType[r.location_type]}</td>
              <td>{r.company_id ? cname.get(r.company_id) : '—'}</td><td>{r.parent_location_id ? lname.get(r.parent_location_id) : '—'}</td>
              <td>{r.address ?? '—'}</td><td className="mono">{r.latitude !== null && r.longitude !== null ? `${r.latitude}, ${r.longitude}` : '—'}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      <Modal open={!!edit} title={edit?.id ? 'Editar ubicación' : 'Nueva ubicación'} onClose={() => setEdit(null)}
        footer={<>{edit?.id ? <Button variant="danger" onClick={async () => { await softDelete('hse_locations', edit.id!); setEdit(null); }}>Eliminar</Button> : null}<div className="grow" /><Button variant="secondary" onClick={() => setEdit(null)}>Cancelar</Button><Button onClick={save}>Guardar</Button></>}>
        {edit ? <>
          <Field label="Nombre" required><Input value={edit.name ?? ''} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
          <div className="grid grid-2">
            <Field label="Tipo"><Select value={edit.location_type} onChange={e => setEdit({ ...edit, location_type: e.target.value as Location['location_type'] })} options={opts(LABELS.locationType)} /></Field>
            <Field label="Empresa"><Select placeholder="—" value={edit.company_id ?? ''} onChange={e => setEdit({ ...edit, company_id: e.target.value })} options={companies.map(c => ({ value: c.id, label: c.name }))} /></Field>
            <Field label="Dentro de"><Select placeholder="—" value={edit.parent_location_id ?? ''} onChange={e => setEdit({ ...edit, parent_location_id: e.target.value })} options={rows.filter(r => r.id !== edit.id).map(r => ({ value: r.id, label: r.name }))} /></Field>
          </div>
          <Field label="Dirección"><TextArea rows={2} value={edit.address ?? ''} onChange={e => setEdit({ ...edit, address: e.target.value })} /></Field>
          <div className="row gap wrap">
            <Field label="Latitud"><Input type="number" step="0.000001" value={edit.latitude ?? ''} onChange={e => setEdit({ ...edit, latitude: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            <Field label="Longitud"><Input type="number" step="0.000001" value={edit.longitude ?? ''} onChange={e => setEdit({ ...edit, longitude: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            <Button variant="secondary" onClick={gps} style={{ alignSelf: 'flex-end' }}>Usar mi ubicación</Button>
          </div>
        </> : null}
      </Modal>
    </div>
  );
}

function Processes() {
  const { orgId, role } = useAuth();
  const toast = useToast();
  const rows = (useOrgRows<Process>('hse_processes') ?? []).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const [name, setName] = useState('');
  const editable = can(role, 'master');
  const add = async () => {
    const n = name.trim();
    if (!n) return;
    if (rows.some(r => r.name.toLowerCase() === n.toLowerCase())) { toast('El proceso ya existe', 'bad'); return; }
    await saveRecord<Process>('hse_processes', { id: newId(), organization_id: orgId, name: n, sort_order: rows.length, active: true } as Process);
    setName('');
  };
  return (
    <div className="stack">
      <p className="muted small">Procesos o áreas que se auditan (p. ej. Dirección / Gerencia, HSE, OPER/RRHH). Se asignan a cada requisito de las plantillas.</p>
      {editable ? <div className="row gap"><Input placeholder="Nuevo proceso" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && void add()} style={{ maxWidth: 320 }} /><Button onClick={add}>Agregar</Button></div> : null}
      {rows.length === 0 ? <Empty>No hay procesos. Se crean automáticamente al importar una plantilla.</Empty> : (
        <div className="table-wrap"><table className="t"><tbody>
          {rows.map(r => <tr key={r.id}><td>{r.name}</td><td className="num">{editable ? <Button variant="ghost" className="btn-sm" onClick={() => void softDelete('hse_processes', r.id)}>Quitar</Button> : null}</td></tr>)}
        </tbody></table></div>
      )}
    </div>
  );
}
