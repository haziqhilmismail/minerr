# Usage: python3 -I make-zip.py out.zip name=method:content ...   (method is stored or deflated)
import sys, zipfile

with zipfile.ZipFile(sys.argv[1], 'w') as z:
    for spec in sys.argv[2:]:
        name, rest = spec.split('=', 1)
        method, content = rest.split(':', 1)
        mode = zipfile.ZIP_STORED if method == 'stored' else zipfile.ZIP_DEFLATED
        z.writestr(name, content.encode('utf-8'), compress_type=mode)
