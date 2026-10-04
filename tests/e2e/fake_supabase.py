"""
Servidor Supabase simulado para pruebas de navegador (Playwright).

Reproduce el contrato que usa el cliente y que se verificó contra Supabase real
(supabase/tests/sync_push_protocol.sql): REST de lectura incremental, RPC
hse_bootstrap / hse_sync_push / hse_sync_confirm, Storage (subida estándar sin
sobrescritura) y carga reanudable TUS por partes. Permite inyectar fallas:
caída total, respuesta perdida después de aplicar un lote, y corte a mitad de una
carga reanudable.
"""
import base64, json, re, threading, uuid, urllib.parse
from datetime import datetime, timezone, timedelta

def now_iso():
    return datetime.now(timezone.utc).isoformat()

WRITABLE = {
    'hse_audits': ['template_version_id','company_id','location_id','title','audit_type','status','scheduled_date','started_at','completed_at','lead_auditor_id','audit_team','scope','summary','latitude','longitude','deleted_at','client_updated_at'],
    'hse_audit_responses': ['audit_id','item_id','answer','rating','numeric_value','text_value','comment','deleted_at','client_updated_at'],
    'hse_evidences': ['audit_id','response_id','finding_id','action_id','storage_path','file_name','mime_type','size_bytes','caption','taken_at','latitude','longitude','uploaded_by','deleted_at','client_updated_at'],
    'hse_findings': ['audit_id','response_id','item_id','company_id','location_id','title','description','requirement','finding_type','severity','category','process_id','responsible_user_id','status','root_cause','rca_method','rca_data','immediate_action','legal_reference','detected_at','due_date','verification_notes','effectiveness','deleted_at','client_updated_at'],
    'hse_actions': ['finding_id','description','action_type','responsible_user_id','responsible_name','responsible_company_id','due_date','status','progress_notes','effectiveness_criteria','verification_notes','effectiveness','deleted_at','client_updated_at'],
    'hse_audit_participants': ['audit_id','user_id','participant_role','deleted_at','client_updated_at'],
    'hse_companies': ['name','tax_id','company_type','parent_company_id','contact_name','contact_email','contact_phone','csms_status','csms_valid_until','active','deleted_at','client_updated_at'],
    'hse_locations': ['company_id','parent_location_id','name','location_type','address','latitude','longitude','active','deleted_at','client_updated_at'],
}
CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,HEAD,DELETE,OPTIONS,PUT',
    'Access-Control-Expose-Headers': 'Location, Upload-Offset, Upload-Length, Tus-Resumable, Upload-Metadata, Content-Range',
}

class FakeSupabase:
    def __init__(self):
        self.lock = threading.Lock()
        self.tables = {t: {} for t in ['hse_companies','hse_locations','hse_processes','hse_templates','hse_template_versions','hse_template_sections',
                                        'hse_template_items','hse_template_import_issues','hse_template_validation_cases','hse_audits','hse_audit_responses',
                                        'hse_findings','hse_actions','hse_evidences','hse_memberships','hse_profiles',
                                        'hse_audit_participants','hse_notifications']}
        self.receipts = {}            # op_id -> row_version
        self.objects = {}             # path -> bytes length
        self.tus = {}                 # id -> {path, length, offset, chunks}
        self.down = False             # caída total del servidor / red
        self.lose_next_push_response = 0   # aplica el lote pero "se corta" la respuesta
        self.fail_tus_patch = 0       # cortes a mitad de carga reanudable
        self.calls = {'push': 0, 'push_ops': 0, 'upload': 0, 'tus_post': 0, 'tus_patch': 0, 'tus_head': 0}
        self.users = {}
        self.org = str(uuid.uuid4())
        self.seed()

    # ------------------------------------------------------------------ datos iniciales
    def put(self, table, row):
        row.setdefault('organization_id', self.org)
        row.setdefault('created_at', now_iso()); row['updated_at'] = now_iso()
        row.setdefault('row_version', 1); row.setdefault('deleted_at', None)
        self.tables[table][row['id']] = row
        return row

    def seed(self):
        self.users = {'A': str(uuid.uuid4()), 'B': str(uuid.uuid4())}
        for k, u in self.users.items():
            self.put('hse_memberships', {'id': str(uuid.uuid4()), 'user_id': u, 'role': 'owner' if k == 'A' else 'auditor', 'company_id': None, 'active': True})
            self.tables['hse_profiles'][u] = {'id': u, 'email': f'{k.lower()}@test.local', 'full_name': f'Auditor {k}', 'job_title': None, 'updated_at': now_iso()}
        self.company = self.put('hse_companies', {'id': str(uuid.uuid4()), 'name': 'Contratista Patagonia SA', 'company_type': 'contratista', 'csms_status': 'aprobada', 'active': True, 'tax_id': None, 'parent_company_id': None})['id']
        t = self.put('hse_templates', {'id': str(uuid.uuid4()), 'name': 'Inspección de pozo', 'category': 'seguridad_higiene', 'description': None, 'active': True})
        v = self.put('hse_template_versions', {'id': str(uuid.uuid4()), 'template_id': t['id'], 'version_number': 1, 'status': 'publicada', 'scoring_method': 'ponderado', 'scoring_config': {}, 'validation_status': 'no_requerida', 'published_at': now_iso()})
        s = self.put('hse_template_sections', {'id': str(uuid.uuid4()), 'version_id': v['id'], 'title': 'Locación', 'sort_order': 0, 'code': None, 'description': None})
        self.items = []
        for i, q in enumerate(['¿La locación está señalizada y delimitada?', '¿Los extintores están vigentes y accesibles?', '¿Hay kit antiderrame en el área de combustible?']):
            it = self.put('hse_template_items', {'id': str(uuid.uuid4()), 'version_id': v['id'], 'section_id': s['id'], 'code': str(i + 1), 'original_number': str(i + 1), 'question': q,
                                                 'response_type': 'cumplimiento', 'weight': 1, 'is_critical': False, 'evidence_required_on_fail': True, 'is_required': True, 'sort_order': i, 'process_id': None, 'review_flags': [], 'guidance': None, 'legal_reference': None, 'source_ref': None})
            self.items.append(it['id'])
        self.audit = self.put('hse_audits', {'id': str(uuid.uuid4()), 'template_version_id': v['id'], 'company_id': self.company, 'location_id': None, 'code': 'AUD-2026-0001',
                                             'title': 'Auditoría pozo YPF-123', 'audit_type': 'interna', 'status': 'en_curso', 'scheduled_date': '2026-10-03', 'lead_auditor_id': self.users['A'],
                                             'compliance_pct': None, 'score': None, 'max_score': None, 'critical_failures': 0, 'result_band': None,
                                             'reviewed_by': None, 'reviewed_at': None, 'review_notes': None, 'closed_by': None, 'section_results': None, 'created_by': self.users['A']})['id']
        # equipo asignado (0017): A líder, B auditor
        for who, pr in (('A', 'lider'), ('B', 'auditor')):
            self.put('hse_audit_participants', {'id': str(uuid.uuid4()), 'audit_id': self.audit, 'user_id': self.users[who], 'participant_role': pr})

    def session(self, who):
        uid = self.users[who]
        exp = int((datetime.now(timezone.utc) + timedelta(hours=8)).timestamp())
        h = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').decode().rstrip('=')
        p = base64.urlsafe_b64encode(json.dumps({'sub': uid, 'role': 'authenticated', 'exp': exp, 'aud': 'authenticated'}).encode()).decode().rstrip('=')
        tok = f'{h}.{p}.firma'
        return {'access_token': tok, 'refresh_token': 'r-' + who, 'token_type': 'bearer', 'expires_in': 28800, 'expires_at': exp,
                'user': {'id': uid, 'aud': 'authenticated', 'role': 'authenticated', 'email': f'{who.lower()}@test.local', 'email_confirmed_at': now_iso(), 'app_metadata': {}, 'user_metadata': {}, 'created_at': now_iso()}}

    def user_from(self, headers):
        auth = headers.get('authorization', '')
        try:
            payload = auth.split(' ')[1].split('.')[1]
            payload += '=' * (-len(payload) % 4)
            return json.loads(base64.urlsafe_b64decode(payload))['sub']
        except Exception:
            return None

    # ------------------------------------------------------------------ protocolo de sincronización
    def sync_push(self, uid, ops):
        out, failed = [], set()
        for op in ops:
            op_id, t, payload, base = op.get('op_id'), op.get('table'), op.get('payload') or {}, op.get('base')
            rid = payload.get('id')
            if op_id in self.receipts:
                out.append({'op_id': op_id, 'status': 'duplicado', 'row_version': self.receipts[op_id]}); continue
            if rid in failed:
                out.append({'op_id': op_id, 'status': 'omitido'}); continue
            if t not in WRITABLE or payload.get('organization_id') != self.org:
                failed.add(rid); out.append({'op_id': op_id, 'status': 'rechazado', 'code': '42501', 'message': 'Sin permiso'}); continue
            cols = [c for c in payload if c in WRITABLE[t]]
            table = self.tables[t]
            cur = table.get(rid)
            if cur is None:
                if base is not None:
                    failed.add(rid); out.append({'op_id': op_id, 'status': 'rechazado', 'code': 'HS404', 'message': 'No existe'}); continue
                if t == 'hse_evidences' and payload.get('storage_path') not in self.objects:
                    failed.add(rid); out.append({'op_id': op_id, 'status': 'error', 'code': 'HS424', 'message': 'El archivo de la evidencia todavía no está en el servidor'}); continue
                row = {'id': rid, 'organization_id': self.org, 'created_by': uid}
                for c in cols: row[c] = payload[c]
                if t == 'hse_audit_responses': row.update({'answered_by': uid, 'answered_at': now_iso()})
                self.put(t, row)
            else:
                if base is None: base = {c: None for c in cols}
                conf = [c for c in cols if c != 'client_updated_at' and (c not in base or (cur.get(c) != base.get(c) and cur.get(c) != payload.get(c)))]
                if conf:
                    failed.add(rid)
                    out.append({'op_id': op_id, 'status': 'conflicto', 'code': 'HS409', 'message': 'Otro usuario modificó en el servidor: ' + ', '.join(conf), 'fields': conf, 'row_version': cur['row_version'], 'server_row': dict(cur)}); continue
                for c in cols: cur[c] = payload[c]
                cur['row_version'] += 1; cur['updated_at'] = now_iso()
            row = table[rid]
            self.receipts[op_id] = row['row_version']
            out.append({'op_id': op_id, 'status': 'aplicado', 'row_version': row['row_version'], 'server_row': dict(row)})
        return out

    # ------------------------------------------------------------------ enrutamiento HTTP
    def handle(self, route):
        r = self._handle(route)
        if isinstance(r, tuple):
            _, obj, status = r
            route.fulfill(status=status, headers={**CORS, 'Content-Type': 'application/json'}, body=json.dumps(obj))

    def _handle(self, route):
        req = route.request
        if req.method == 'OPTIONS':
            return route.fulfill(status=204, headers=CORS)
        if self.down:
            return route.abort('internetdisconnected')
        url = urllib.parse.urlparse(req.url)
        path, q = url.path, urllib.parse.parse_qs(url.query)
        h = {k.lower(): v for k, v in req.headers.items()}
        uid = self.user_from(h)
        with self.lock:
            # ---- RPC
            m = re.match(r'^/rest/v1/rpc/(\w+)$', path)
            if m:
                fn, body = m.group(1), json.loads(req.post_data or '{}')
                if fn == 'hse_bootstrap':
                    who = 'A' if uid == self.users['A'] else 'B'
                    prof = self.tables['hse_profiles'][uid]
                    role = 'owner' if who == 'A' else 'auditor'
                    return self.json({'profile': {**prof, 'phone': None, 'default_organization_id': self.org},
                                      'memberships': [{'organization_id': self.org, 'organization_name': 'Operadora Neuquina (prueba)', 'role': role, 'company_id': None}]})
                if fn == 'hse_sync_push':
                    self.calls['push'] += 1; self.calls['push_ops'] += len(body['p_ops'])
                    res = self.sync_push(uid, body['p_ops'])
                    if self.lose_next_push_response > 0:
                        self.lose_next_push_response -= 1
                        return route.abort('connectionreset')     # aplicado en el servidor, respuesta perdida
                    return self.json(res)
                if fn == 'hse_refresh_notifications':
                    return self.json(0)
                if fn == 'hse_audit_readiness':
                    return self.json({'audit_id': body.get('p_audit'), 'target': body.get('p_target'), 'ok': True, 'issues': [], 'checked_at': now_iso()})
                if fn == 'hse_sync_confirm':
                    return self.json([{'op_id': o, 'row_version': self.receipts[o], 'received_at': now_iso()} for o in body['p_op_ids'] if o in self.receipts])
                return self.json({'message': 'rpc no simulada ' + fn}, 404)
            # ---- REST
            m = re.match(r'^/rest/v1/(\w+)$', path)
            if m:
                t = m.group(1)
                if req.method == 'POST' and t == 'hse_sync_events':
                    return route.fulfill(status=201, headers=CORS, body='')
                if req.method != 'GET' or t not in self.tables:
                    return self.json({'message': 'no simulado'}, 404)
                rows = list(self.tables[t].values())
                for k, vals in q.items():
                    if k in ('select', 'order', 'offset', 'limit'): continue
                    v = vals[0]
                    op, _, val = v.partition('.')
                    if op == 'eq': rows = [r for r in rows if str(r.get(k)) == val]
                    elif op == 'gt': rows = [r for r in rows if str(r.get(k) or '') > val]
                    elif op == 'in': ids = val.strip('()').split(','); rows = [r for r in rows if str(r.get(k)) in ids]
                rows.sort(key=lambda r: (r.get('updated_at') or '', r['id']))
                off = int(q.get('offset', ['0'])[0]); lim = int(q.get('limit', ['100000'])[0])
                rows = rows[off:off + lim]
                if 'vnd.pgrst.object' in h.get('accept', ''):
                    return self.json(rows[0]) if rows else self.json({'code': 'PGRST116', 'message': 'no rows'}, 406)
                return self.json(rows)
            # ---- Storage estándar
            m = re.match(r'^/storage/v1/object/hse-evidencias/(.+)$', path)
            if m and req.method in ('POST', 'PUT'):
                self.calls['upload'] += 1
                p = urllib.parse.unquote(m.group(1))
                if p in self.objects:
                    return self.json({'statusCode': '409', 'error': 'Duplicate', 'message': 'The resource already exists'}, 400)
                self.objects[p] = len(req.post_data_buffer or b'')
                return self.json({'Key': 'hse-evidencias/' + p, 'Id': str(uuid.uuid4())})
            # ---- TUS reanudable
            if path == '/storage/v1/upload/resumable' and req.method == 'POST':
                self.calls['tus_post'] += 1
                meta = dict(kv.split(' ') for kv in h.get('upload-metadata', '').split(',') if ' ' in kv)
                obj = base64.b64decode(meta.get('objectName', '')).decode()
                if obj in self.objects:
                    return route.fulfill(status=409, headers={**CORS, 'Tus-Resumable': '1.0.0'}, body='The resource already exists')
                tid = uuid.uuid4().hex
                data = req.post_data_buffer or b''
                self.tus[tid] = {'path': obj, 'length': int(h['upload-length']), 'offset': len(data)}
                self.finish_tus(tid)
                return route.fulfill(status=201, headers={**CORS, 'Tus-Resumable': '1.0.0', 'Location': f'{url.scheme}://{url.netloc}/storage/v1/upload/resumable/{tid}', 'Upload-Offset': str(len(data))}, body='')
            m = re.match(r'^/storage/v1/upload/resumable/(\w+)$', path)
            if m:
                u = self.tus.get(m.group(1))
                if not u: return route.fulfill(status=404, headers=CORS, body='')
                if req.method == 'HEAD':
                    self.calls['tus_head'] += 1
                    return route.fulfill(status=200, headers={**CORS, 'Tus-Resumable': '1.0.0', 'Upload-Offset': str(u['offset']), 'Upload-Length': str(u['length']), 'Cache-Control': 'no-store'}, body='')
                if req.method == 'PATCH':
                    self.calls['tus_patch'] += 1
                    if self.fail_tus_patch > 0:
                        self.fail_tus_patch -= 1
                        return route.abort('connectionreset')
                    if int(h['upload-offset']) != u['offset']:
                        return route.fulfill(status=409, headers=CORS, body='offset mismatch')
                    u['offset'] += len(req.post_data_buffer or b'')
                    self.finish_tus(m.group(1))
                    return route.fulfill(status=204, headers={**CORS, 'Tus-Resumable': '1.0.0', 'Upload-Offset': str(u['offset'])}, body='')
            if path.startswith('/auth/v1/'):
                return self.json({})
            return self.json({'message': 'no simulado ' + path}, 404)

    def finish_tus(self, tid):
        u = self.tus[tid]
        if u['offset'] >= u['length']:
            self.objects[u['path']] = u['offset']

    def json(self, obj, status=200):
        return ('json', obj, status)
