# Converte il build a file unico (dist-single/index.html) in una pagina per un artefatto claude.ai:
# titolo, stili e script inline, senza lo scheletro <html>/<head>.
# Uso: python3 scripts/to_artifact.py dist-single/index.html uscita.html
import re, sys
src = open(sys.argv[1]).read()
title = re.search(r'<title>(.*?)</title>', src, re.S).group(1)
styles = re.findall(r'<style[^>]*>.*?</style>', src, re.S)
scripts = re.findall(r'<script type="module"[^>]*>.*?</script>', src, re.S)
body = re.search(r'<body>(.*)</body>', src, re.S).group(1)
body = re.sub(r'<script type="module"[^>]*>.*?</script>', '', body, flags=re.S)
out = f'<title>{title}</title>\n' + '\n'.join(styles) + '\n<style>:root{color-scheme:dark}</style>\n' + body + '\n' + '\n'.join(scripts)
open(sys.argv[2], 'w').write(out)
print(len(out), title, len(styles), len(scripts))
