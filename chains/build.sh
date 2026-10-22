#!/bin/bash
# Build the two eCash explorer images (one backend, one frontend; every explorer runs from them):
#   ecash-explorer/backend:local   ecash-explorer/frontend:local
# The build contexts are staged in chains/build/ (the Docker files are copied there, not into backend/ and frontend/),
# and the builds are capped (CPUS, MEMORY): WSL has crashed under unbounded builds.
#   chains/build.sh [backend|frontend]...     (default: both)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
STAGE=$ROOT/chains/build
CPUS=${CPUS:-0-3}
MEMORY=${MEMORY:-6g}
TAG=${TAG:-local}
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
TARGETS=${*:-backend frontend}

for t in $TARGETS; do
  case $t in
  backend)
    rm -rf "$STAGE/backend" && mkdir -p "$STAGE/backend"
    rsync -a --exclude node_modules --exclude dist --exclude package --exclude cache --exclude rust-gbt \
      --exclude 'mempool-config.json' backend/ "$STAGE/backend/"
    rsync -a --exclude target --exclude node_modules rust/ "$STAGE/backend/rust/"
    cp docker/backend/* "$STAGE/backend/"
    mkdir -p "$STAGE/backend/GeoIP"
    # one context: the rust module inside it, for the classic builder (which has no named contexts)
    sed -i -e 's#^COPY --from=backend \. \.$##' -e 's#^COPY --from=rustgbt \. \.\./rust/$#RUN mv rust ../rust#' "$STAGE/backend/Dockerfile"
    DOCKER_BUILDKIT=0 nice docker build --cpuset-cpus "$CPUS" --memory "$MEMORY" --build-arg commitHash="$COMMIT" \
      -t ecash-explorer/backend:$TAG "$STAGE/backend"
    ;;
  frontend)
    rm -rf "$STAGE/frontend" && mkdir -p "$STAGE/frontend"
    rsync -a --exclude node_modules --exclude dist --exclude .angular --exclude 'mempool-frontend-config.json' \
      --exclude 'src/resources/config.js' frontend/ "$STAGE/frontend/"
    cp docker/frontend/* "$STAGE/frontend/"
    cp nginx.conf http-basic.conf nginx-mempool.conf "$STAGE/frontend/"
    f=$STAGE/frontend
    sed -i -e 's/127.0.0.1:80/0.0.0.0:__MEMPOOL_FRONTEND_HTTP_PORT__/g' -e 's/127.0.0.1/0.0.0.0/g' -e 's/user nobody;//g' \
      -e 's!/etc/nginx/nginx-mempool.conf!/etc/nginx/conf.d/nginx-mempool.conf!g' "$f/nginx.conf"
    sed -i -e 's/127.0.0.1:8999/__MEMPOOL_BACKEND_MAINNET_HTTP_HOST__:__MEMPOOL_BACKEND_MAINNET_HTTP_PORT__/g' "$f/nginx-mempool.conf"
    DOCKER_BUILDKIT=0 nice docker build --cpuset-cpus "$CPUS" --memory "$MEMORY" --build-arg commitHash="$COMMIT" \
      -t ecash-explorer/frontend:$TAG "$STAGE/frontend"
    ;;
  *) echo "unknown target $t"; exit 1 ;;
  esac
done
docker images 'ecash-explorer/*'
