"""Datos de prueba H&P compartidos: plantilla importada del Excel, cuatro auditorías completadas y fotos."""
import json, os, uuid
from fake_supabase import FakeSupabase, now_iso

HERE = os.path.dirname(os.path.abspath(__file__))
PAYLOAD = json.load(open(os.path.join(HERE, '..', '..', 'src', 'modules', 'demo', 'hp-payload.json'), encoding='utf-8'))

POINTS = {'nc': 0, 'obs': 1, 'opm': 2, 'ok': 3, 'na': 0}
def profile_answer(profile, rn, seed):   # igual que hse_demo_answer (0024)
    k = (rn * 7 + seed) % 10
    if profile == 'muy_bueno': return 'ok' if k < 7 else 'opm' if k < 9 else 'obs'
    if profile == 'regular': return 'ok' if k < 4 else 'opm' if k < 5 else 'obs' if k < 7 else 'nc'
    return 'ok' if k < 2 else 'opm' if k < 3 else 'obs' if k < 5 else 'nc'

def band_of(v):
    for b in PAYLOAD['version']['scoring_config']['bands']:
        if (b['min'] is None or v >= b['min']) and (b['max'] is None or v <= b['max']): return b['label']

class Fake(FakeSupabase):
    def seed(self):
        super().seed()
        A = self.users['A']
        t = self.put('hse_templates', {'id': str(uuid.uuid4()), 'name': PAYLOAD['template']['name'], 'category': 'csms', 'description': None, 'active': True})
        v = self.put('hse_template_versions', {'id': str(uuid.uuid4()), 'template_id': t['id'], 'version_number': 1, 'status': 'publicada',
            'scoring_method': 'situacion_promedio_secciones', 'scoring_config': PAYLOAD['version']['scoring_config'], 'validation_status': 'validada', 'published_at': now_iso()})
        self.hp_sections = []          # (section_id, title, [item ids by key])
        keymap = {}
        for si, s in enumerate(PAYLOAD['sections']):
            sec = self.put('hse_template_sections', {'id': str(uuid.uuid4()), 'version_id': v['id'], 'title': s['title'], 'sort_order': si, 'code': None, 'description': None})
            ids = []
            for ii, it in enumerate(s['items']):
                row = self.put('hse_template_items', {'id': str(uuid.uuid4()), 'version_id': v['id'], 'section_id': sec['id'], 'code': it.get('code'), 'original_number': it.get('original_number'),
                    'question': it['question'], 'response_type': 'situacion', 'weight': 1, 'is_critical': False, 'evidence_required_on_fail': False, 'is_required': True,
                    'sort_order': ii, 'process_id': None, 'review_flags': [], 'guidance': None, 'legal_reference': None, 'source_ref': it.get('source_ref')})
                keymap[it['key']] = row['id']; ids.append((it['key'], row['id']))
            self.hp_sections.append((sec['id'], s['title'], ids))
        excel = PAYLOAD['validation_cases'][0]['answers']
        # caso de validación importado con el Excel (respuestas por ítem), como queda al importar la planilla
        self.hp_template = t['id']
        self.put('hse_template_validation_cases', {'id': str(uuid.uuid4()), 'version_id': v['id'], 'name': 'Resultados de prueba del Excel (planilla H&P)', 'source_ref': None,
            'answers': {keymap[k]: a for k, a in excel.items()}, 'expected': {'sections': {}, 'final': 6.2711}, 'computed': None, 'matches': True, 'max_abs_diff': 0, 'last_run_at': now_iso()})
        rn = {k: n + 1 for n, k in enumerate(k for _, _, ids in self.hp_sections for k, _ in ids)}
        companies = [self.company] + [self.put('hse_companies', {'id': str(uuid.uuid4()), 'name': n, 'company_type': 'contratista', 'csms_status': 'aprobada', 'active': True, 'tax_id': None, 'parent_company_id': None})['id']
                                      for n in ('Transportes Cuenca Neuquina S.R.L.', 'Montajes Industriales del Sur')]
        specs = [('AUD-2026-0010', 'CSMS a segundas partes – Servicios Petroleros del Comahue', companies[0], lambda k: excel[k], '2026-05-07'),
                 ('AUD-2026-0011', 'CSMS a segundas partes – Transportes Cuenca Neuquina', companies[1], lambda k: profile_answer('muy_bueno', rn[k], 3), '2026-07-01'),
                 ('AUD-2026-0012', 'CSMS a segundas partes – Montajes Industriales del Sur', companies[2], lambda k: profile_answer('critico', rn[k], 5), '2026-08-05'),
                 ('AUD-2026-0013', 'Seguimiento CSMS – Servicios Petroleros del Comahue', companies[0], lambda k: profile_answer('regular', rn[k], 1), '2026-09-14')]
        self.hp_audits = []
        for code, title, comp, ans, date in specs:
            aid = str(uuid.uuid4()); secres = []
            for sid, stitle, ids in self.hp_sections:
                raw = sum(POINTS[ans(k)] for k, _ in ids); target = 3 * len(ids)
                secres.append({'section_id': sid, 'title': stitle, 'raw': raw, 'target': target, 'score': round(10 * raw / target, 4), 'items': len(ids), 'answered': len(ids), 'na': 0})
            final = sum(10 * s['raw'] / s['target'] for s in secres) / len(secres)
            self.put('hse_audits', {'id': aid, 'template_version_id': v['id'], 'company_id': comp, 'location_id': None, 'code': code, 'title': title, 'audit_type': 'csms',
                'status': 'completada', 'scheduled_date': date, 'lead_auditor_id': A, 'created_by': A, 'score': round(final, 2), 'max_score': 10, 'compliance_pct': round(final * 10, 2),
                'critical_failures': 0, 'result_band': band_of(round(final, 2)), 'summary': None, 'reviewed_by': None, 'reviewed_at': None, 'review_notes': None, 'closed_by': None,
                'completed_at': date + 'T15:00:00Z', 'section_results': secres})
            self.put('hse_audit_participants', {'id': str(uuid.uuid4()), 'audit_id': aid, 'user_id': A, 'participant_role': 'lider'})
            for k, iid in ((k, i) for _, _, ids in self.hp_sections for k, i in ids):
                self.put('hse_audit_responses', {'id': str(uuid.uuid5(uuid.UUID('6f1c0d5e-2b7a-4f0e-9a61-3c2d8e4b7a10'), f'{aid}:{iid}')), 'audit_id': aid, 'item_id': iid, 'answer': ans(k), 'comment': None, 'rating': None, 'numeric_value': None, 'text_value': None})
            self.hp_audits.append((aid, round(final, 2), band_of(round(final, 2))))
        # fotos de la primera auditoría: una del requisito 1 y otra de un hallazgo del requisito 2
        import io
        from PIL import Image
        a1 = self.hp_audits[0][0]
        resp = {r['item_id']: r for r in self.tables['hse_audit_responses'].values() if r['audit_id'] == a1}
        i1, i2 = self.hp_sections[0][2][0][1], self.hp_sections[0][2][1][1]
        fid = str(uuid.uuid4())
        self.put('hse_findings', {'id': fid, 'audit_id': a1, 'response_id': resp[i2]['id'], 'item_id': i2, 'company_id': companies[0], 'location_id': None, 'code': 'HAL-2026-0001',
            'title': 'Falta registro de capacitación', 'description': 'Sin constancias.', 'finding_type': 'nc_menor', 'severity': 'media', 'status': 'abierto', 'root_cause': None,
            'immediate_action': None, 'legal_reference': None, 'detected_at': '2026-05-07T12:00:00Z', 'due_date': '2026-06-07', 'closed_at': None, 'closed_by': None, 'requirement': None,
            'category': None, 'process_id': None, 'responsible_user_id': None, 'rca_method': None, 'rca_data': None, 'recurrence_key': None, 'recurrence_of': None, 'recurrence_count': 0,
            'verification_notes': None, 'effectiveness': None, 'verified_by': None, 'verified_at': None})
        for n, (color, cap, rid, f) in enumerate([((200, 40, 40), 'Extintor sin tarjeta', resp[i1]['id'], None), ((40, 90, 200), 'Planilla de capacitación vacía', None, fid)]):
            buf = io.BytesIO(); Image.new('RGB', (640, 480), color).save(buf, 'JPEG'); path = f'org/{a1}/foto{n}.jpg'
            self.files[path] = (buf.getvalue(), 'image/jpeg'); self.objects[path] = len(buf.getvalue())
            self.put('hse_evidences', {'id': str(uuid.uuid4()), 'audit_id': a1, 'response_id': rid, 'finding_id': f, 'action_id': None, 'storage_path': path, 'file_name': f'foto{n}.jpg',
                'mime_type': 'image/jpeg', 'size_bytes': len(buf.getvalue()), 'caption': cap, 'taken_at': f'2026-05-07T1{n}:00:00Z', 'latitude': None, 'longitude': None, 'uploaded_by': A})

