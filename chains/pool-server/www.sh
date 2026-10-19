#!/bin/bash
# Static frontends for the Chains explorers: www/<chain>/ = the en-US bundle of the frontend image with
# <base href="/<chain>/"> and its own /<chain>/resources/config.js; www/resources/ shared.
# www-config/<chain>.js = the frontend's config.js for that chain (CHAIN_PROFILE, EXPLORER_URLS, ...).
#   www.sh <frontend image> <out dir> <urls.env> <config dir with <chain>.json>
set -euo pipefail
IMG=$1 OUT=$2 URLS=$(cat "$3") CFG=$4
PROFILES="chains thunder bitnames bitassets fastblocks zside layers hivemind"
rm -rf "$OUT/www" "$OUT/www-config"; mkdir -p "$OUT/www" "$OUT/www-config"
id=$(docker create "$IMG")
docker cp "$id:/var/www/mempool/browser/en-US" "$OUT/en-US.tmp"
docker cp "$id:/var/www/mempool/browser/resources" "$OUT/www/resources"
docker rm "$id" >/dev/null
rm -f "$OUT/www/resources/config.js" "$OUT/www/resources/config.template.js"
for p in $PROFILES; do
  cp -r "$OUT/en-US.tmp" "$OUT/www/$p"
  sed -i -e "s#<base href=\"/\">#<base href=\"/$p/\">#" -e "s#src=\"/resources/config.js\"#src=\"/$p/resources/config.js\"#" "$OUT/www/$p/index.html"
  grep -q "<base href=\"/$p/\">" "$OUT/www/$p/index.html"
  # the chain's name in the page title and link previews (index.html says "Chains Explorer")
  case $p in bitnames) n=BitNames ;; bitassets) n=BitAssets ;; fastblocks) n=FastBlocks ;; zside) n=zSide ;; *) n=${p^} ;; esac
  sed -i "s/Chains Explorer/$n Explorer/g" "$OUT/www/$p/index.html"
  w=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['MEMPOOL']['BLOCK_WEIGHT_UNITS'])" "$CFG/$p.json")
  docker run --rm -e CHAIN_PROFILE=$p -e CHAIN_NETWORK=testnet -e CHAIN_EXPLORER_URLS="$URLS" -e BLOCK_WEIGHT_UNITS=$w \
    -e MINING_DASHBOARD=false -e HISTORICAL_PRICE=false -e ACCELERATOR_BUTTON=false -e NGINX_PROTOCOL=https -e NGINX_PORT=443 \
    "$IMG" cat /var/www/mempool/browser/resources/config.js 2>/dev/null | sed '1{/^\/var\/www/d}' > "$OUT/www-config/$p.js"
  grep -q "CHAIN_PROFILE = '$p'" "$OUT/www-config/$p.js"
done
rm -rf "$OUT/en-US.tmp"
du -sh "$OUT/www"
