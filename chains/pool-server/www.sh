#!/bin/bash
# Static frontends for the eCash explorers: www/<explorer>/ = the en-US bundle of the frontend image with
# <base href="/<explorer>/"> and its own /<explorer>/resources/config.js; www/resources/ shared.
# www-config/<explorer>.js = the frontend's config.js for that explorer (CHAIN_PROFILE, CHAIN_NETWORK, EXPLORER_URLS, ...).
#   www.sh <frontend image> <out dir> <stage dir written by gen.py>
set -euo pipefail
IMG=$1 OUT=$2 STAGE=$3
URLS=$(cat "$STAGE/urls.env")
rm -rf "$OUT/www" "$OUT/www-config"; mkdir -p "$OUT/www" "$OUT/www-config"
id=$(docker create "$IMG")
docker cp "$id:/var/www/mempool/browser/en-US" "$OUT/en-US.tmp"
docker cp "$id:/var/www/mempool/browser/resources" "$OUT/www/resources"
docker rm "$id" >/dev/null
rm -f "$OUT/www/resources/config.js" "$OUT/www/resources/config.template.js"
python3 -c 'import json,sys
for e in json.load(open(sys.argv[1])): print(e["path"], e["profile"], e["network"], e["weight"])' "$STAGE/explorers.json" |
while read -r p profile network weight; do
  cp -r "$OUT/en-US.tmp" "$OUT/www/$p"
  sed -i -e "s#<base href=\"/\">#<base href=\"/$p/\">#" -e "s#src=\"/resources/config.js\"#src=\"/$p/resources/config.js\"#" "$OUT/www/$p/index.html"
  grep -q "<base href=\"/$p/\">" "$OUT/www/$p/index.html"
  # the network in the page title, and absolute links for crawlers and link previews (they do not run the app)
  case $network in ecash) n='eCash' ;; ecashbeta) n='eCash Betanet' ;; ecashtest) n='eCash Testnet' ;; *) n=$network ;; esac
  u="https://explorer.blockfab.org/$p"
  sed -i -e "s/eCash Explorer/$n Explorer/g" \
    -e "s#content=\"resources/previews/#content=\"$u/resources/previews/#g" -e "s#rel=\"canonical\" href=\"./\"#rel=\"canonical\" href=\"$u/\"#" "$OUT/www/$p/index.html"
  docker run --rm -e CHAIN_PROFILE="$profile" -e CHAIN_NETWORK="$network" -e CHAIN_EXPLORER_URLS="$URLS" -e BLOCK_WEIGHT_UNITS="$weight" \
    -e MINING_DASHBOARD=false -e HISTORICAL_PRICE=false -e MEMPOOL_WEBSITE_URL= -e LIQUID_WEBSITE_URL= -e SERVICES_API= -e ACCELERATOR_BUTTON=false -e NGINX_PROTOCOL=https -e NGINX_PORT=443 \
    "$IMG" cat /var/www/mempool/browser/resources/config.js 2>/dev/null | sed '1{/^\/var\/www/d}' > "$OUT/www-config/$p.js"
  grep -q "CHAIN_PROFILE = '$profile'" "$OUT/www-config/$p.js"
done
rm -rf "$OUT/en-US.tmp"
du -sh "$OUT/www"
