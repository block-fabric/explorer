#!/bin/sh
__MEMPOOL_BACKEND_MAINNET_HTTP_HOST__=${BACKEND_MAINNET_HTTP_HOST:=127.0.0.1}
__MEMPOOL_BACKEND_MAINNET_HTTP_PORT__=${BACKEND_MAINNET_HTTP_PORT:=8999}
__MEMPOOL_FRONTEND_HTTP_PORT__=${FRONTEND_HTTP_PORT:=8080}

__PROXIED_SERVICES__=${PROXIED_SERVICES:=false}
__PROXIED_SERVICES_HOST__=${PROXIED_SERVICES_HOST:=https://mempool.space}

if [ "${__PROXIED_SERVICES__}" = "true" ]; then
  sed -i "s|proxy_pass https://mempool.space;|proxy_pass ${__PROXIED_SERVICES_HOST__};|g" /etc/nginx/conf.d/nginx-mempool.conf
fi

sed -i "s/__MEMPOOL_BACKEND_MAINNET_HTTP_HOST__/${__MEMPOOL_BACKEND_MAINNET_HTTP_HOST__}/g" /etc/nginx/conf.d/nginx-mempool.conf
sed -i "s/__MEMPOOL_BACKEND_MAINNET_HTTP_PORT__/${__MEMPOOL_BACKEND_MAINNET_HTTP_PORT__}/g" /etc/nginx/conf.d/nginx-mempool.conf

cp /etc/nginx/nginx.conf /patch/nginx.conf
sed -i "s/__MEMPOOL_FRONTEND_HTTP_PORT__/${__MEMPOOL_FRONTEND_HTTP_PORT__}/g" /patch/nginx.conf
cat /patch/nginx.conf > /etc/nginx/nginx.conf

if [ "${LIGHTNING_DETECTED_PORT}" != "" ];then
  export LIGHTNING=true
fi

# Runtime overrides - read env vars defined in docker compose

__MAINNET_ENABLED__=${MAINNET_ENABLED:=true}
__TESTNET_ENABLED__=${TESTNET_ENABLED:=false}
__TESTNET4_ENABLED__=${TESTNET4_ENABLED:=false}
__SIGNET_ENABLED__=${SIGNET_ENABLED:=false}
__REGTEST_ENABLED__=${REGTEST_ENABLED:=false}
__LIQUID_ENABLED__=${LIQUID_ENABLED:=false}
__LIQUID_TESTNET_ENABLED__=${LIQUID_TESTNET_ENABLED:=false}
__ITEMS_PER_PAGE__=${ITEMS_PER_PAGE:=10}
__KEEP_BLOCKS_AMOUNT__=${KEEP_BLOCKS_AMOUNT:=8}
__NGINX_PROTOCOL__=${NGINX_PROTOCOL:=http}
__NGINX_HOSTNAME__=${NGINX_HOSTNAME:=localhost}
__NGINX_PORT__=${NGINX_PORT:=8999}
__BLOCK_WEIGHT_UNITS__=${BLOCK_WEIGHT_UNITS:=4000000}
__MEMPOOL_BLOCKS_AMOUNT__=${MEMPOOL_BLOCKS_AMOUNT:=8}
__BASE_MODULE__=${BASE_MODULE:=mempool}
__ROOT_NETWORK__=${ROOT_NETWORK:=}
# eCash Explorer: '=' not ':=', so that an empty value stays empty instead of falling back to mempool.space
__MEMPOOL_WEBSITE_URL__=${MEMPOOL_WEBSITE_URL=https://mempool.space}
__LIQUID_WEBSITE_URL__=${LIQUID_WEBSITE_URL=https://liquid.network}
__MINING_DASHBOARD__=${MINING_DASHBOARD:=true}
__LIGHTNING__=${LIGHTNING:=false}
__AUDIT__=${AUDIT:=false}
__MAINNET_BLOCK_AUDIT_START_HEIGHT__=${MAINNET_BLOCK_AUDIT_START_HEIGHT:=0}
__TESTNET_BLOCK_AUDIT_START_HEIGHT__=${TESTNET_BLOCK_AUDIT_START_HEIGHT:=0}
__SIGNET_BLOCK_AUDIT_START_HEIGHT__=${SIGNET_BLOCK_AUDIT_START_HEIGHT:=0}
__REGTEST_BLOCK_AUDIT_START_HEIGHT__=${REGTEST_BLOCK_AUDIT_START_HEIGHT:=0}
__TESTNET4_BLOCK_AUDIT_START_HEIGHT__=${TESTNET4_BLOCK_AUDIT_START_HEIGHT:=0}
__MAINNET_TX_FIRST_SEEN_START_HEIGHT__=${MAINNET_TX_FIRST_SEEN_START_HEIGHT:=0}
__TESTNET_TX_FIRST_SEEN_START_HEIGHT__=${TESTNET_TX_FIRST_SEEN_START_HEIGHT:=0}
__TESTNET4_TX_FIRST_SEEN_START_HEIGHT__=${TESTNET4_TX_FIRST_SEEN_START_HEIGHT:=0}
__SIGNET_TX_FIRST_SEEN_START_HEIGHT__=${SIGNET_TX_FIRST_SEEN_START_HEIGHT:=0}
__REGTEST_TX_FIRST_SEEN_START_HEIGHT__=${REGTEST_TX_FIRST_SEEN_START_HEIGHT:=0}
__ACCELERATOR__=${ACCELERATOR:=false}
__ACCELERATOR_BUTTON__=${ACCELERATOR_BUTTON:=true}
__SERVICES_API__=${SERVICES_API=https://mempool.space/api/v1/services}
__PUBLIC_ACCELERATIONS__=${PUBLIC_ACCELERATIONS:=false}
__HISTORICAL_PRICE__=${HISTORICAL_PRICE:=true}
__ADDITIONAL_CURRENCIES__=${ADDITIONAL_CURRENCIES:=false}
__STRATUM_ENABLED__=${STRATUM_ENABLED:=false}

# eCash Explorer: the chain this container shows (frontend/src/app/chain/modules/<id>), its network
# (ecash | ecashbeta | ecashtest) and the other explorers' URLs ("ecash=https://...,ecashtest=https://...", by network id)
__CHAIN_PROFILE__=${CHAIN_PROFILE:=ecash}
__CHAIN_NETWORK__=${CHAIN_NETWORK:=ecashbeta}
__CHAIN_EXPLORER_URLS__=${CHAIN_EXPLORER_URLS:=}
# a sidechain explorer's UI: 'full' (upstream mempool's pages, websocket and APIs on the sidechain's upstream-shaped
# backend, plus its sidechain pages and panels) or 'lean' (the L2 page set alone, on /api/v1/chain and /api/v1/l2/*);
# the eCash explorer ignores it
__CHAIN_UI__=${CHAIN_UI:=full}
case "${__CHAIN_UI__}" in
  full|lean) ;;
  *) echo "CHAIN_UI must be full or lean, not '${__CHAIN_UI__}': using full" >&2; __CHAIN_UI__=full ;;
esac
export __CHAIN_PROFILE__
export __CHAIN_UI__
export __CHAIN_NETWORK__
export __CHAIN_EXPLORER_URLS__

# eCash Explorer: the chain's and network's name in the page title and link previews (index.html says "eCash Explorer")
# (the sidechain explorers, frontend/src/app/chain/modules/<id>, keep the eCash network's name in the suffix)
__CHAIN_DESC__=
case "${CHAIN_PROFILE:-ecash}" in
  thunder) __CHAIN_NAME__=Thunder ;;
  bitnames) __CHAIN_NAME__=BitNames ;;
  bitassets) __CHAIN_NAME__=BitAssets ;;
  hivemind) __CHAIN_NAME__=Hivemind ;;
  zside) __CHAIN_NAME__=zSide ;;
  coinshift) __CHAIN_NAME__=Coinshift ;;
  *) __CHAIN_NAME__=eCash ;;
esac
if [ "${__CHAIN_NAME__}" != "eCash" ]; then
  __CHAIN_DESC__="Explore ${__CHAIN_NAME__}, a drivechain sidechain of eCash: blocks, transactions, addresses, deposits and withdrawals."
fi
case "${CHAIN_NETWORK:-ecashbeta}" in
  ecash) __NETWORK_SUFFIX__= ;; ecashtest) __NETWORK_SUFFIX__=" (Testnet)" ;; *) __NETWORK_SUFFIX__=" (Betanet)" ;;
esac
# ... and absolute links for crawlers and link previews (which do not run the app): this explorer's public URL from
# CHAIN_EXPLORER_URLS (keyed by network); without one, the links stay relative to the page
__CHAIN_URL__=$(echo "${CHAIN_EXPLORER_URLS:-}" | tr ',' '\n' | grep "^${CHAIN_NETWORK:-ecashbeta}=" | cut -d= -f2- | sed 's#/*$##')
# The link preview image: chain-<profile>.png, else eCash's
__CHAIN_PREVIEW__=chain-${CHAIN_PROFILE:-ecash}.png
if [ -z "$(find /var/www/mempool -path "*/resources/previews/${__CHAIN_PREVIEW__}" | head -n 1)" ]; then
  __CHAIN_PREVIEW__=chain-ecash.png
fi
for f in $(find /var/www/mempool -name index.html); do
  # (with the name and network suffix of an earlier start matched too, so that a restart does not add another)
  sed -i -E -e "s/(eCash|Thunder|BitNames|BitAssets|Hivemind|zSide|Coinshift) Explorer( \((Betanet|Testnet)\))?/${__CHAIN_NAME__} Explorer${__NETWORK_SUFFIX__}/g" \
    -e "s#resources/previews/chain-[a-z0-9]+\.png#resources/previews/${__CHAIN_PREVIEW__}#g" "$f"
  if [ -n "$__CHAIN_DESC__" ]; then
    sed -i -E -e "s#content=\"Explore [^\"]*\"#content=\"${__CHAIN_DESC__}\"#g" "$f"
  fi
  if [ -n "$__CHAIN_URL__" ]; then
    sed -i -e "s#content=\"resources/previews/#content=\"${__CHAIN_URL__}/resources/previews/#g" -e "s#rel=\"canonical\" href=\"./\"#rel=\"canonical\" href=\"${__CHAIN_URL__}/\"#" "$f"
  fi
done

# Export as environment variables to be used by envsubst
export __MAINNET_ENABLED__
export __TESTNET_ENABLED__
export __TESTNET4_ENABLED__
export __SIGNET_ENABLED__
export __REGTEST_ENABLED__
export __LIQUID_ENABLED__
export __LIQUID_TESTNET_ENABLED__
export __ITEMS_PER_PAGE__
export __KEEP_BLOCKS_AMOUNT__
export __NGINX_PROTOCOL__
export __NGINX_HOSTNAME__
export __NGINX_PORT__
export __BLOCK_WEIGHT_UNITS__
export __MEMPOOL_BLOCKS_AMOUNT__
export __BASE_MODULE__
export __ROOT_NETWORK__
export __MEMPOOL_WEBSITE_URL__
export __LIQUID_WEBSITE_URL__
export __MINING_DASHBOARD__
export __LIGHTNING__
export __AUDIT__
export __MAINNET_BLOCK_AUDIT_START_HEIGHT__
export __TESTNET_BLOCK_AUDIT_START_HEIGHT__
export __SIGNET_BLOCK_AUDIT_START_HEIGHT__
export __REGTEST_BLOCK_AUDIT_START_HEIGHT__
export __TESTNET4_BLOCK_AUDIT_START_HEIGHT__
export __MAINNET_TX_FIRST_SEEN_START_HEIGHT__
export __TESTNET_TX_FIRST_SEEN_START_HEIGHT__
export __TESTNET4_TX_FIRST_SEEN_START_HEIGHT__
export __SIGNET_TX_FIRST_SEEN_START_HEIGHT__
export __REGTEST_TX_FIRST_SEEN_START_HEIGHT__
export __ACCELERATOR__
export __ACCELERATOR_BUTTON__
export __SERVICES_API__
export __PUBLIC_ACCELERATIONS__
export __HISTORICAL_PRICE__
export __ADDITIONAL_CURRENCIES__
export __STRATUM_ENABLED__

folder=$(find /var/www/mempool -name "config.js" | xargs dirname)
echo ${folder}
envsubst < ${folder}/config.template.js > ${folder}/config.js

exec "$@"
