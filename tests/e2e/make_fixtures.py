"""Genera los archivos de prueba grandes (no se versionan): foto JPEG ~16 MB y PDF ~14,7 MB."""
import os, random
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
w, h = 8000, 6000                                   # 48 MP, como un celular actual
img = Image.frombytes('RGB', (w, h), os.urandom(w * h * 3))
img.save(os.path.join(HERE, 'foto_grande.jpg'), quality=95)
body = os.urandom(14_680_000)
pdf = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n% relleno\n' + body + b'\n%%EOF\n'
open(os.path.join(HERE, 'informe_grande.pdf'), 'wb').write(pdf)
print({f: os.path.getsize(os.path.join(HERE, f)) for f in ('foto_grande.jpg', 'informe_grande.pdf')})
