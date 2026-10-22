#!/usr/bin/env python3
"""
The link-preview images of the explorers (og:image, twitter:image): one 1200x630 PNG per chain profile,
frontend/src/resources/previews/chain-<id>.png, rendered with headless Chromium from an HTML card.
Marks and colours as in frontend/src/app/chain/modules/<id>/index.ts and chain/marks.ts.
  python3 chains/previews.py
"""
import os, subprocess, tempfile, glob

CHAINS = {
    'ecash': ('eCash', '#2ec4b6', 'eCash (ECX) with BIP300/301 drivechains', ['M16 3.5l10.8 6.25v12.5L16 28.5 5.2 22.25V9.75z', 'M11 16h10'], []),
    'thunder': ('Thunder', '#a585ff', 'A payments sidechain of eCash', ['M18.5 3.5 9 18h6.5L13.5 28.5 23 14h-6.5z'], []),
    'bitnames': ('BitNames', '#5aa6ff', 'A naming sidechain of eCash', ['M9 5h15a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H9a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z', 'M9 5v22', 'M13 12h8', 'M13 17h6'], []),
    'bitassets': ('BitAssets', '#f5b83d', 'An asset sidechain of eCash', ['M6 9c0-2.2 4.5-4 10-4s10 1.8 10 4-4.5 4-10 4S6 11.2 6 9z', 'M6 9v14c0 2.2 4.5 4 10 4s10-1.8 10-4V9', 'M6 16c0 2.2 4.5 4 10 4s10-1.8 10-4'], []),
    'hivemind': ('Hivemind', '#7bd88f', 'A prediction market sidechain of eCash', ['M28 16a12 12 0 1 1-24 0 12 12 0 1 1 24 0', 'M10.5 16.5l3.5 3.5 7-7.5'], []),
    'zside': ('zSide', '#f26b9c', 'A shielded sidechain of eCash', ['M16 4l10 4v7c0 6-4 10.5-10 13-6-2.5-10-7-10-13V8z', 'M16 12a3 3 0 0 0-1 5.8V21h2v-3.2A3 3 0 0 0 16 12z'], []),
    'coinshift': ('Coinshift', '#ff8a3d', 'A swap sidechain of eCash', ['M7 16a9 9 0 0 1 15-6.7', 'M22 5v5h-5', 'M25 16a9 9 0 0 1-15 6.7', 'M10 27v-5h5'], []),
}

HTML = """<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;width:1200px;height:630px;background:#0e1018;font-family:-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Liberation Sans',sans-serif}}
.card{{position:absolute;inset:0;background:radial-gradient(circle at 18% 30%,{color}33 0,transparent 55%),linear-gradient(160deg,#151826,#0b0d14);}}
.mark{{position:absolute;left:90px;top:150px}}
.name{{position:absolute;left:330px;top:165px;color:#f2f4f7;font-size:110px;font-weight:800;letter-spacing:-2px}}
.ex{{position:absolute;left:336px;top:300px;color:{color};font-size:38px;font-weight:700;letter-spacing:14px}}
.tag{{position:absolute;left:90px;top:440px;right:90px;color:#c9ced8;font-size:34px;line-height:1.35}}
.bar{{position:absolute;left:0;right:0;bottom:0;height:12px;background:{color}}}
</style></head><body><div class="card">
<svg class="mark" width="200" height="200" viewBox="0 0 32 32"><g fill="none" stroke="{color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">{shapes}</g></svg>
<div class="name">{name}</div><div class="ex">EXPLORER</div><div class="tag">{tagline}</div><div class="bar"></div></div></body></html>"""

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, '..', 'frontend', 'src', 'resources', 'previews')
    chrome = sorted(glob.glob(os.path.expanduser('~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell')))[-1]
    with tempfile.TemporaryDirectory(dir=os.path.join(here, 'logs') if os.path.isdir(os.path.join(here, 'logs')) else None) as tmp:
        for cid, (name, color, tagline, paths, rects) in CHAINS.items():
            shapes = ''.join(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}"/>' for x, y, w, h, rx in rects) + ''.join(f'<path d="{d}"/>' for d in paths)
            page = os.path.join(tmp, cid + '.html')
            with open(page, 'w') as f:
                f.write(HTML.format(color=color, name=name, tagline=tagline, shapes=shapes))
            png = os.path.join(out, f'chain-{cid}.png')
            subprocess.run([chrome, '--no-sandbox', '--hide-scrollbars', '--window-size=1200,630', f'--screenshot={png}', 'file://' + page],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
            print(png)

if __name__ == '__main__':
    main()
