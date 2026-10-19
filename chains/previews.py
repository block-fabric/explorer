#!/usr/bin/env python3
"""
The link-preview images of the explorers (og:image, twitter:image): one 1200x630 PNG per chain,
frontend/src/resources/previews/chain-<id>.png, rendered with headless Chromium from an HTML card.
Marks, colours and taglines as in frontend/src/app/chain/modules/<id>/index.ts.
  python3 chains/previews.py
"""
import os, subprocess, tempfile, glob

CHAINS = {
    'chains': ('Chains', '#b5f27e', 'The Chains drivechain mainchain (BIP300/BIP301)', ['M11 16h10'], [(3, 9, 12, 14, 3.5), (17, 9, 12, 14, 3.5)]),
    'thunder': ('Thunder', '#a585ff', 'Large blocks, for volume', ['M18.5 3.5L8 18h7.5l-2 10.5L24.5 14H17z', 'M3.5 11.5h4', 'M2.5 16.5h3', 'M4.5 21.5h3'], []),
    'bitnames': ('BitNames', '#b48cff', 'Names that point to keys, addresses and data, owned like coins', ['M4.5 9.5a3 3 0 0 1 3-3h11.3a3 3 0 0 1 2.1.9l6.6 6.5a3 3 0 0 1 0 4.2l-6.6 6.5a3 3 0 0 1-2.1.9H7.5a3 3 0 0 1-3-3z', 'M10 16a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M18 13.5l3 2.5-3 2.5'], []),
    'bitassets': ('BitAssets', '#2bc79a', 'Assets issued and traded on the sidechain: pools and Dutch auctions', ['M9.5 5h13l6.5 7.5L16 28 3 12.5z', 'M3 12.5h26', 'M12.5 5L10 12.5 16 28l6-15.5L19.5 5'], []),
    'fastblocks': ('FastBlocks', '#ff8a3d', 'Blocks of stake every 15 seconds, finalized by merged mining', ['M6 18a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'M13 3.5h6', 'M16 3.5V8', 'M24.2 9.8l1.8-1.8', 'M17.5 11.5l-5 7.5h4l-1.5 5.5 5-7.5h-4z'], []),
    'zside': ('zSide', '#f26b9c', 'Shielded payments (Zcash Orchard)', ['M16 3.5l10 3.8v8.2c0 6.3-4.2 10.7-10 13-5.8-2.3-10-6.7-10-13V7.3z', 'M11.5 11.5h9l-9 9h9'], []),
    'layers': ('Layers', '#8f7cff', 'Assets, pools and auctions on blocks of stake every 15 seconds', ['M16 4L29 11 16 18 3 11z', 'M3 16.5l13 7 13-7', 'M3 22l13 7 13-7'], []),
    'hivemind': ('Hivemind', '#f5b83d', 'Prediction markets, resolved by votecoin holders', ['M16 3.5l10.8 6.25v12.5L16 28.5 5.2 22.25V9.75z', 'M10.5 19.5l3.8-3.8 2.9 2.9 4.3-5.1', 'M21.5 13.5v3'], []),
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
