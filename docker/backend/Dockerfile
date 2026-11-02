FROM rust:1.84-bookworm AS builder

ARG commitHash
ENV MEMPOOL_COMMIT_HASH=${commitHash}

WORKDIR /build

RUN apt-get update && \
    apt-get install -y curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs=24.13.0-1nodesource1 build-essential python3 pkg-config && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY . .

ENV PATH="/usr/local/cargo/bin:$PATH"

COPY --from=backend . .
COPY --from=rustgbt . ../rust/
ENV FD=/build/rust-gbt
RUN bash meta/scripts/check-install-scripts.sh && npm ci --omit=dev --omit=optional

WORKDIR /build
RUN npm run package

FROM rust:1.84-bookworm AS runtime

RUN apt-get update && \
    apt-get install -y curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs=24.13.0-1nodesource1 python3-pip && \
    pip install --no-cache-dir --break-system-packages aioquic==1.2.0 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# IP geolocation for the nodes map (backend/src/chain/nodes-geo.ts): DB-IP's IP to City Lite, CC BY 4.0
# (https://db-ip.com), one month's release
ARG DBIP_MONTH=2026-10
RUN curl -fsSL "https://download.db-ip.com/free/dbip-city-lite-${DBIP_MONTH}.mmdb.gz" | gunzip > /usr/local/share/dbip-city-lite.mmdb && \
    test -s /usr/local/share/dbip-city-lite.mmdb

WORKDIR /backend

RUN chown 1000:1000 ./
COPY --from=builder --chown=1000:1000 /build/package ./package/
COPY --from=builder --chown=1000:1000 /build/GeoIP ./GeoIP/
COPY --from=builder --chown=1000:1000 /build/mempool-config.json /build/start.sh /build/wait-for-it.sh /build/quic-probe.py ./

USER 1000

EXPOSE 8999

CMD ["/backend/start.sh"]
