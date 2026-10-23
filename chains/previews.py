#!/usr/bin/env python3
"""
The link-preview images of the explorers (og:image, twitter:image): one 1200x630 PNG per chain profile,
frontend/src/resources/previews/chain-<id>.png, rendered with headless Chromium from an HTML card.
Marks and colours as in frontend/src/app/chain/modules/<id>/index.ts and chain/marks.ts.
  python3 chains/previews.py
"""
import os, subprocess, tempfile, glob

CHAINS = {
    'ecash': ('eCash', '#E6A849', 'eCash (ECX) with BIP300/301 drivechains', ['M16 3.5l10.8 6.25v12.5L16 28.5 5.2 22.25V9.75z', 'M11 16h10'], []),
    'thunder': ('Thunder', '#a585ff', 'A payments sidechain of eCash', ['M18.5 3.5 9 18h6.5L13.5 28.5 23 14h-6.5z'], []),
    'bitnames': ('BitNames', '#5aa6ff', 'A naming sidechain of eCash', ['M9 5h15a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H9a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z', 'M9 5v22', 'M13 12h8', 'M13 17h6'], []),
    'bitassets': ('BitAssets', '#f5b83d', 'An asset sidechain of eCash', ['M6 9c0-2.2 4.5-4 10-4s10 1.8 10 4-4.5 4-10 4S6 11.2 6 9z', 'M6 9v14c0 2.2 4.5 4 10 4s10-1.8 10-4V9', 'M6 16c0 2.2 4.5 4 10 4s10-1.8 10-4'], []),
    'truthcoin': ('Truthcoin', '#7bd88f', 'A prediction market sidechain of eCash', ['M28 16a12 12 0 1 1-24 0 12 12 0 1 1 24 0', 'M10.5 16.5l3.5 3.5 7-7.5'], []),
    'zside': ('zSide', '#f26b9c', 'A shielded sidechain of eCash', ['M16 4l10 4v7c0 6-4 10.5-10 13-6-2.5-10-7-10-13V8z', 'M16 12a3 3 0 0 0-1 5.8V21h2v-3.2A3 3 0 0 0 16 12z'], []),
    'flush': ('Flush', '#7d94ab', 'A sidechain of eCash: its DEX, assets and token launches', ['M4 6h24', 'M8 12.5h17', 'M12 19h10', 'M15 25.5h4'], []),
    'coinshift': ('Coinshift', '#ff8a3d', 'A swap sidechain of eCash', ['M7 16a9 9 0 0 1 15-6.7', 'M22 5v5h-5', 'M25 16a9 9 0 0 1-15 6.7', 'M10 27v-5h5'], []),
}

# eCash's round mark (frontend/src/app/chain/marks.ts ECASH_MARK_PATHS): eCash's own, and before each sidechain's mark
ECASH_MARK = ('<svg width="200" height="200" viewBox="170 166 460 468">'
              + ''.join(f'<path d="{d}" fill="#E6A849"/>' for d in ['M406.486,280.925 C472.249,280.925 525.561,334.237 525.561,400 C525.358,408.043 525.507,408.242 524.189,418.134 C523.947,419.947 523.456,421.719 523.09,423.511 C523.09,423.511 405.336,423.511 386.482,423.511 C370.04,423.511 370.04,384.532 386.482,384.483 C402.054,384.436 472.372,384.483 472.372,384.483 C466.039,353.583 436.989,333.042 406.486,332.27 C369.08,332.27 338.756,362.594 338.756,400 C338.756,437.406 369.08,467.73 406.486,467.73 L503.953,468.213 C482.286,500.711 444.793,518.106 406.486,519.075 C340.723,519.075 287.411,465.764 287.411,400 C287.645,390.728 287.36,395.905 288.518,384.483 C288.518,384.483 179.855,384.448 173.697,384.483 C173.487,383.519 176.227,361.201 177.054,359.229 C180.355,359.237 294.583,359.229 294.583,359.229 C313.423,311.336 355.039,282.226 406.486,280.925 L406.486,280.925 z', 'M405.602,168.039 C500.166,168.102 591.592,230.091 623.305,319.984 L557.167,319.984 C527.101,263.666 470.365,231.736 407.27,229.753 C343.525,230.368 289.192,265.152 257.645,319.744 L187.883,319.744 C220.501,227.325 309.303,171.991 405.602,168.039 L405.602,168.039 z', 'M234.989,423.511 C247.224,508.566 319.245,569.437 404.565,570.513 C471.073,570.482 535.175,530.189 561.39,468.467 L627.11,468.467 C597.06,566.545 506.089,630.683 404.565,631.961 C285.944,631.636 184.961,541.936 172.889,423.511 L234.989,423.511 z']) + '</svg>')
SIDECHAINS = {'thunder', 'bitnames', 'bitassets', 'truthcoin', 'zside', 'coinshift', 'flush'}

HTML = """<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;width:1200px;height:630px;background:#0e1018;font-family:-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Liberation Sans',sans-serif}}
.card{{position:absolute;inset:0;background:radial-gradient(circle at 18% 30%,{color}33 0,transparent 55%),linear-gradient(160deg,#151826,#0b0d14);}}
.marks{{position:absolute;left:90px;top:150px;display:flex;gap:30px}}
.name{{position:absolute;left:{text_left}px;top:165px;color:#f2f4f7;font-size:110px;font-weight:800;letter-spacing:-2px}}
.ex{{position:absolute;left:{ex_left}px;top:300px;color:{color};font-size:38px;font-weight:700;letter-spacing:14px}}
.tag{{position:absolute;left:90px;top:440px;right:90px;color:#c9ced8;font-size:34px;line-height:1.35}}
.bar{{position:absolute;left:0;right:0;bottom:0;height:12px;background:{color}}}
</style></head><body><div class="card">
<div class="marks">{ecash_mark}{own_mark}</div>
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
                ecash_mark = ECASH_MARK if cid == 'ecash' or cid in SIDECHAINS else ''
                own_mark = '' if cid == 'ecash' else (f'<svg width="200" height="200" viewBox="0 0 32 32"><g fill="none" stroke="{color}" '
                                                      f'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">{shapes}</g></svg>')
                wide = 230 if ecash_mark and own_mark else 0
                f.write(HTML.format(color=color, name=name, tagline=tagline, ecash_mark=ecash_mark, own_mark=own_mark,
                                    text_left=330 + wide, ex_left=336 + wide))
            png = os.path.join(out, f'chain-{cid}.png')
            subprocess.run([chrome, '--no-sandbox', '--hide-scrollbars', '--window-size=1200,630', f'--screenshot={png}', 'file://' + page],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
            print(png)

if __name__ == '__main__':
    main()
