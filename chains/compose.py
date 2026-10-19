#!/usr/bin/env python3
"""
Write the Docker Compose setup that runs the Chains explorers side by side:
  chains/deploy/docker-compose.yml       one MariaDB, and per chain profile an api (backend) and a web (frontend)
  chains/deploy/config/<profile>.json    each backend's mempool-config.json (CHAIN.PROFILE, its node, its database)
  chains/deploy/initdb/databases.sql     one database per profile

  chains/compose.py [--profiles chains,thunder,...] [--host-url http://localhost] [--node-host host.docker.internal]
  cd chains/deploy && docker compose up -d

Nodes: each profile's RPC is reached at <node-host>:<rpc port> with the cookie file chains/cookies/<profile>.cookie
(chains/tunnel.sh forwards the testnet nodes of a server to 49xxx and keeps the cookies there; LOCAL_BIND=0.0.0.0
lets the containers reach it). Web ports: 8100 + slot (Chains 8100, Thunder 8102, BitNames 8103, ..., Layers 8107), on 127.0.0.1.
"""
import argparse
import json
import os

PROFILES = {
    # id: (slot, rpc port of the testnet node, block weight units, tunnel port)
    'chains':     (None, 19554, 800000),
    'thunder':    (2, 19754, 32000000),
    'bitnames':   (3, 19954, 4000000),
    'bitassets':  (4, 19354, 4000000),
    'fastblocks': (5, 19154, 1500000),
    'zside':      (6, 19454, 4000000),
    'layers':     (7, 19254, 1500000),
    'hivemind':   (9, 19854, 4000000),
}

HERE = os.path.dirname(os.path.abspath(__file__))

# Fixed addresses on the stack's own network. nginx (each web container) resolves its backend's name once, at start:
# with addresses Docker hands out, a backend recreated alone (a new image) can come back with another backend's old
# address and its explorer would show that other chain. Every service has its own address, and the web containers
# are pointed at an address, not a name.
SUBNET = '172.31.77.0/24'
def ip(n):
    return f'172.31.77.{n}'
DB_IP = ip(5)
TUNNEL_IP = ip(6)
def api_ip(i):
    return ip(20 + i)


def tunnel_port(rpc_port):
    # chains/tunnel.sh: 4 + the port without its first digit (19554 -> 49554)
    return int('4' + str(rpc_port)[1:])


def web_port(pid):
    slot = PROFILES[pid][0]
    return 8100 + (slot or 0)


def backend_config(pid, args, urls):
    slot, rpc, weight = PROFILES[pid]
    cfg = {
        'MEMPOOL': {
            'NETWORK': 'mainnet', 'BACKEND': 'none', 'HTTP_PORT': 8999, 'CACHE_DIR': '/backend/cache',
            'BLOCK_WEIGHT_UNITS': weight, 'INDEXING_BLOCKS_AMOUNT': -1, 'USER_AGENT': 'chains-explorer',
            'STDOUT_LOG_MIN_PRIORITY': 'info', 'AUTOMATIC_POOLS_UPDATE': False, 'ENABLED': True,
            'POLL_RATE_MS': 2000, 'API_URL_PREFIX': '/api/v1/', 'SPAWN_CLUSTER_PROCS': 0,
        },
        'CORE_RPC': {
            'HOST': args.node_host, 'PORT': tunnel_port(rpc), 'USERNAME': '', 'PASSWORD': '', 'TIMEOUT': 60000,
            'COOKIE': True, 'COOKIE_PATH': f'/cookies/{pid}.cookie',
        },
        'DATABASE': {'ENABLED': True, 'HOST': 'db', 'PORT': 3306, 'DATABASE': f'explorer_{pid}', 'USERNAME': 'mempool', 'PASSWORD': 'mempool'},
        'STATISTICS': {'ENABLED': True, 'TX_PER_SECOND_SAMPLE_PERIOD': 150},
        'FIAT_PRICE': {'ENABLED': False},
        'MAXMIND': {'ENABLED': False},
        'CHAIN': {
            'PROFILE': pid, 'NETWORK': args.network, 'BACKFILL_BLOCKS': args.backfill,
            'MAINCHAIN_RPC': {
                'HOST': args.node_host, 'PORT': tunnel_port(PROFILES['chains'][1]), 'USERNAME': '', 'PASSWORD': '',
                'COOKIE': True, 'COOKIE_PATH': '/cookies/chains.cookie', 'TIMEOUT': 60000,
            },
            'EXPLORER_URLS': urls,
        },
    }
    return cfg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--profiles', default=','.join(PROFILES))
    ap.add_argument('--host-url', default='http://localhost', help='base of the public URLs; the port is added')
    ap.add_argument('--urls', default='', help='explicit public URLs: chains=https://...,thunder=https://... (overrides --host-url)')
    ap.add_argument('--node-host', default=TUNNEL_IP, help='where the nodes\' RPC is reached; default: the tunnel service of the stack')
    ap.add_argument('--server', default='root@144.202.17.53', help='the server the tunnel service connects to')
    ap.add_argument('--network', default='testnet')
    ap.add_argument('--backfill', type=int, default=20000)
    ap.add_argument('--tag', default='local')
    args = ap.parse_args()

    profiles = [p.strip() for p in args.profiles.split(',') if p.strip()]
    for p in profiles:
        if p not in PROFILES:
            raise SystemExit(f'unknown profile {p}; known: {", ".join(PROFILES)}')
    urls = {p: f'{args.host_url}:{web_port(p)}' for p in profiles}
    for part in filter(None, args.urls.split(',')):
        k, v = part.split('=', 1)
        urls[k.strip()] = v.strip()
    urls_env = ','.join(f'{k}={v}' for k, v in urls.items())

    deploy = os.path.join(HERE, 'deploy')
    os.makedirs(os.path.join(deploy, 'config'), exist_ok=True)
    os.makedirs(os.path.join(deploy, 'initdb'), exist_ok=True)
    for p in profiles:
        os.makedirs(os.path.join(deploy, 'data', p), exist_ok=True)
        with open(os.path.join(deploy, 'config', f'{p}.json'), 'w') as f:
            json.dump(backend_config(p, args, urls), f, indent=2)
    with open(os.path.join(deploy, 'initdb', 'databases.sql'), 'w') as f:
        for p in profiles:
            f.write(f'CREATE DATABASE IF NOT EXISTS explorer_{p};\nGRANT ALL ON explorer_{p}.* TO \'mempool\'@\'%\';\n')

    lines = ['# Written by chains/compose.py; edit that and run it again.',
             'networks:', '  explorers:', '    ipam:', '      config:', f'        - subnet: {SUBNET}',
             'services:', '  db:',
             '    image: mariadb:10.5.21', '    restart: unless-stopped',
             '    networks:', '      explorers:', f'        ipv4_address: {DB_IP}',
             '    environment:', '      MYSQL_USER: mempool', '      MYSQL_PASSWORD: mempool', '      MYSQL_ROOT_PASSWORD: admin',
             '    volumes:', '      - ./mysql:/var/lib/mysql', '      - ./initdb:/docker-entrypoint-initdb.d:ro',
             '    healthcheck:', '      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-umempool", "-pmempool"]',
             '      interval: 5s', '      retries: 30']
    # the SSH tunnel to the server's nodes (chains/tunnel.sh), restarted with the stack; it keeps the RPC cookies in ../cookies
    lines += ['  tunnel:', '    image: chains-explorer/tunnel:local', '    restart: unless-stopped',
              '    networks:', '      explorers:', f'        ipv4_address: {TUNNEL_IP}',
              '    environment:', '      LOCAL_BIND: "0.0.0.0"', f'      SERVER: "{args.server}"', '      COOKIES: /cookies',
              '    volumes:', '      - ../tunnel.sh:/tunnel/tunnel.sh:ro', '      - ../cookies:/cookies', '      - ${HOME}/.ssh:/home/tunnel/.ssh:ro']
    # the init script only runs on an empty data folder: this creates the databases of profiles added later
    lines += ['  db-setup:', '    image: mariadb:10.5.21', '    restart: "no"', '    networks:', '      - explorers',
              '    depends_on:', '      db:', '        condition: service_healthy',
              '    volumes:', '      - ./initdb:/initdb:ro',
              '    entrypoint: ["sh", "-c", "mysql -h db -uroot -padmin < /initdb/databases.sql"]']
    for i, p in enumerate(profiles):
        lines += [
            f'  api-{p}:', f'    image: chains-explorer/backend:{args.tag}', '    restart: unless-stopped',
            '    networks:', '      explorers:', f'        ipv4_address: {api_ip(i)}',
            '    user: "1000:1000"',
            '    depends_on:', '      db:', '        condition: service_healthy',
            '      db-setup:', '        condition: service_completed_successfully',
            '    environment:', '      MEMPOOL_CONFIG_FILE: /config/mempool-config.json',
            '    extra_hosts:', '      - "host.docker.internal:host-gateway"',
            '    volumes:', f'      - ./config/{p}.json:/config/mempool-config.json:ro', '      - ../cookies:/cookies:ro',
            f'      - ./data/{p}:/backend/cache',
            f'  web-{p}:', f'    image: chains-explorer/frontend:{args.tag}', '    restart: unless-stopped', '    user: "1000:1000"',
            '    networks:', '      explorers:', f'        ipv4_address: {ip(60 + i)}',
            '    environment:', '      FRONTEND_HTTP_PORT: "8080"', f'      BACKEND_MAINNET_HTTP_HOST: "{api_ip(i)}"',
            f'      CHAIN_PROFILE: "{p}"', f'      CHAIN_NETWORK: "{args.network}"', f'      CHAIN_EXPLORER_URLS: "{urls_env}"',
            f'      BLOCK_WEIGHT_UNITS: "{PROFILES[p][2]}"', '      MINING_DASHBOARD: "false"', '      HISTORICAL_PRICE: "false"',
            '      ACCELERATOR_BUTTON: "false"', '      MEMPOOL_WEBSITE_URL: ""', '      LIQUID_WEBSITE_URL: ""', '      SERVICES_API: ""',
            '    depends_on:', f'      - api-{p}',
            '    ports:', f'      - "127.0.0.1:{web_port(p)}:8080"',
        ]
    with open(os.path.join(deploy, 'docker-compose.yml'), 'w') as f:
        f.write('\n'.join(lines) + '\n')
    for p in profiles:
        print(f'{p:11} {urls[p]}')


if __name__ == '__main__':
    main()
