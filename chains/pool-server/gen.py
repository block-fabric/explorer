#!/usr/bin/env python3
"""
The eCash explorers on the pool server (46.224.180.56), next to its eCash node and bip300301_enforcer. Run on the
server, in ROOT; writes into OUT (default ./stage):
  docker-compose.yml          db (MariaDB, host network, 127.0.0.1:3318) and api-<explorer> (backend, host network,
                              127.0.0.1:<api port>), all with memory and CPU caps
  config/<explorer>.json      the backend's mempool-config.json
  initdb/databases.sql
  nginx-site.conf             the host nginx site: https://explorer.blockfab.org/<explorer>/
  urls.env                    the explorers' public URLs, for www.sh
The frontends are served by the host nginx from www/<explorer>/ (the en-US bundle of ecash-explorer/frontend with
<base href="/<explorer>/">, see www.sh) and www/resources/ (shared).

Node RPC credentials are not in this repository: secrets/<network>.rpc holds "user:password" of a read-only RPC
user (rpcauth + rpcwhitelist on the node).
  python3 gen.py [--out stage] [--tag local]
"""
import argparse, json, os

DOMAIN = 'explorer.blockfab.org'
ROOT = '/opt/ecash-explorer'
DB_PORT = 3318

# Every explorer this server runs: its id (container, config and database names), URL path, chain profile and
# network, the port of its backend, and where it reads the chain. The eCash explorer (kind l1) reads the node and
# enforcer next to it; a sidechain explorer (kind l2) reads its sidechain node's public RPC on the sidechain server
# (216.128.183.114, whose firewall admits this server only) and the enforcer here. Mainnet and testnet are added here
# when their nodes run.
SIDECHAIN_HOST = '216.128.183.114'
EXPLORERS = [
    {
        'id': 'betanet', 'path': 'betanet', 'kind': 'l1', 'profile': 'ecash', 'network': 'ecashbeta', 'api_port': 18950,
        'rpc_port': 8542, 'enforcer': 'http://127.0.0.1:8123', 'weight': 4000000,
        'mem': '1g', 'heap_mb': 768,
    },
] + [
    {
        'id': f'betanet-{profile}', 'path': f'betanet/{profile}', 'kind': 'l2', 'profile': profile, 'network': 'ecashbeta',
        'api_port': port, 'sidechain_rpc': f'http://{SIDECHAIN_HOST}:{rpc}', 'enforcer': 'http://127.0.0.1:8123',
        'weight': 4000000, 'mem': '384m', 'heap_mb': 256,
    }
    for profile, port, rpc in [('thunder', 18951, 16009), ('bitnames', 18952, 16002), ('bitassets', 18953, 16004),
                               ('hivemind', 18954, 16013), ('zside', 18955, 16098), ('coinshift', 18956, 16255)]
]
# The front page goes to this explorer
HOME = 'betanet'

# How many of the newest blocks the backend indexes into MariaDB (block stats, mining pages). Each one is read in
# full from the node, which also serves the pool's block templates: two weeks of blocks, not the whole chain.
INDEXING_BLOCKS = 2016


def rpc_auth(network):
    path = os.path.join(ROOT, 'secrets', f'{network}.rpc')
    try:
        user, password = open(path).read().strip().split(':', 1)
    except (OSError, ValueError):
        raise SystemExit(f'{path}: missing or not "user:password" (the read-only RPC user of the {network} node)')
    return user, password


def backend_config(e, urls):
    if e['kind'] == 'l2':
        return l2_config(e, urls)
    user, password = rpc_auth(e['network'])
    return {
        'MEMPOOL': {
            'NETWORK': 'mainnet', 'BACKEND': 'none', 'HTTP_PORT': e['api_port'], 'CACHE_DIR': '/backend/cache',
            'BLOCK_WEIGHT_UNITS': e['weight'], 'INDEXING_BLOCKS_AMOUNT': INDEXING_BLOCKS, 'USER_AGENT': 'ecash-explorer',
            'STDOUT_LOG_MIN_PRIORITY': 'info', 'AUTOMATIC_POOLS_UPDATE': False, 'ENABLED': True,
            'POLL_RATE_MS': 2000, 'API_URL_PREFIX': '/api/v1/', 'SPAWN_CLUSTER_PROCS': 0,
        },
        'CORE_RPC': {
            'HOST': '127.0.0.1', 'PORT': e['rpc_port'], 'USERNAME': user, 'PASSWORD': password, 'TIMEOUT': 60000,
            'COOKIE': False,
        },
        'DATABASE': {
            'ENABLED': True, 'HOST': '127.0.0.1', 'PORT': DB_PORT, 'DATABASE': f"explorer_{e['id']}",
            'USERNAME': 'mempool', 'PASSWORD': 'mempool',
        },
        'STATISTICS': {'ENABLED': True, 'TX_PER_SECOND_SAMPLE_PERIOD': 150},
        'FIAT_PRICE': {'ENABLED': False},
        'MAXMIND': {'ENABLED': False},
        'CHAIN': {
            'PROFILE': e['profile'], 'NETWORK': e['network'],
            'ENFORCER': {'URL': e['enforcer'], 'TIMEOUT': 60000, 'MAX_CONCURRENT': 2},
            'EXPLORER_URLS': urls,
            'ADDRESS_INDEX': False,
        },
    }


def l2_config(e, urls):
    """A sidechain explorer: only its own indexer and routes run (no eCash node, database or mempool)"""
    return {
        'MEMPOOL': {
            'NETWORK': 'mainnet', 'BACKEND': 'none', 'HTTP_PORT': e['api_port'], 'CACHE_DIR': '/backend/cache',
            'BLOCK_WEIGHT_UNITS': e['weight'], 'USER_AGENT': 'ecash-explorer', 'STDOUT_LOG_MIN_PRIORITY': 'info',
            'AUTOMATIC_POOLS_UPDATE': False, 'API_URL_PREFIX': '/api/v1/', 'SPAWN_CLUSTER_PROCS': 0,
        },
        'DATABASE': {'ENABLED': False},
        'STATISTICS': {'ENABLED': False},
        'FIAT_PRICE': {'ENABLED': False},
        'MAXMIND': {'ENABLED': False},
        'CHAIN': {
            'PROFILE': e['profile'], 'NETWORK': e['network'],
            'ENFORCER': {'URL': e['enforcer'], 'TIMEOUT': 60000, 'MAX_CONCURRENT': 2},
            'SIDECHAIN_RPC': {'URL': e['sidechain_rpc'], 'TIMEOUT': 60000, 'MAX_CONCURRENT': 2},
            'MAINCHAIN_EXPLORER': urls.get(e['network'], ''),
            'EXPLORER_URLS': urls,
            'ADDRESS_INDEX': False,
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='stage')
    ap.add_argument('--tag', default='local')
    a = ap.parse_args()
    out = a.out
    # cross links: the eCash explorer of each network by network id (the network switcher), the sidechain explorers by
    # profile id (the chain switcher)
    urls = {(e['network'] if e['kind'] == 'l1' else e['profile']): f"https://{DOMAIN}/{e['path']}" for e in EXPLORERS}
    for d in ('config', 'initdb'):
        os.makedirs(os.path.join(out, d), exist_ok=True)

    for e in EXPLORERS:
        path = os.path.join(out, 'config', f"{e['id']}.json")
        with open(path, 'w') as f:
            json.dump(backend_config(e, urls), f, indent=2)
        # it holds the node's RPC password: readable by the api container's user (1000) only
        os.chmod(path, 0o600)
        if os.geteuid() == 0:
            os.chown(path, 1000, 1000)
    with open(os.path.join(out, 'initdb', 'databases.sql'), 'w') as f:
        for e in EXPLORERS:
            if e['kind'] == 'l1':
                f.write(f"CREATE DATABASE IF NOT EXISTS explorer_{e['id']};\nGRANT ALL ON explorer_{e['id']}.* TO 'mempool'@'%';\n")

    L = ['# Written by gen.py (eCash explorers on the pool server); edit that and run it again.',
         'name: ecash-explorer', 'services:',
         '  db:', '    image: mariadb:10.5.21', '    container_name: ecash-explorer-db', '    restart: unless-stopped',
         '    network_mode: host', '    mem_limit: 512m', '    cpus: 1.0',
         '    environment:', '      MYSQL_USER: mempool', '      MYSQL_PASSWORD: mempool', '      MYSQL_ROOT_PASSWORD: admin',
         f'    command: ["--bind-address=127.0.0.1", "--port={DB_PORT}", "--innodb-buffer-pool-size=256M", "--performance-schema=OFF",'
         ' "--max-connections=120", "--skip-name-resolve", "--innodb-log-buffer-size=8M", "--key-buffer-size=8M"]',
         '    volumes:', '      - ./mysql:/var/lib/mysql', '      - ./initdb:/docker-entrypoint-initdb.d:ro',
         '    healthcheck:', f'      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-P", "{DB_PORT}", "-umempool", "-pmempool"]',
         '      interval: 10s', '      retries: 30']
    for e in EXPLORERS:
        p = e['id']
        L += [f'  api-{p}:', f'    image: ecash-explorer/backend:{a.tag}', f'    container_name: ecash-explorer-api-{p}',
              '    restart: unless-stopped', '    network_mode: host', '    user: "1000:1000"',
              f"    mem_limit: {e['mem']}", f"    cpus: {1.0 if e['kind'] == 'l1' else 0.5}"]
        if e['kind'] == 'l1':
            L += ['    depends_on:', '      db:', '        condition: service_healthy']
        L += ['    environment:', '      MEMPOOL_CONFIG_FILE: /config/mempool-config.json',
              f"      NODE_OPTIONS: \"--max-old-space-size={e['heap_mb']}\"",
              '    volumes:', f'      - ./config/{p}.json:/config/mempool-config.json:ro', f'      - ./data/{p}:/backend/cache']
    with open(os.path.join(out, 'docker-compose.yml'), 'w') as f:
        f.write('\n'.join(L) + '\n')

    # nginx: one server block, one sub-path per explorer (/betanet/, ...); the front page goes to HOME
    loc = []
    for e in EXPLORERS:
        p, prt = e['path'], e['api_port']
        loc.append(f'''    # {p}: {e['profile']} on {e['network']}
    location = /{p} {{ return 301 /{p}/; }}
    location = /{p}/resources/config.js {{ alias {ROOT}/www-config/{e['id']}.js; expires 5m; }}
    location ^~ /{p}/resources/ {{ alias {ROOT}/www/resources/; expires 1h; }}
    location ^~ /{p}/api/v1/ws {{ proxy_pass http://127.0.0.1:{prt}/; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "Upgrade"; proxy_read_timeout 1h; }}
    location ^~ /{p}/api/v1/services {{ return 404; }}
    location ^~ /{p}/api/v1 {{ proxy_pass http://127.0.0.1:{prt}/api/v1; }}
    location ^~ /{p}/api/ {{ proxy_pass http://127.0.0.1:{prt}/api/v1/; }}
    location = /{p}/api {{ try_files /{p}/index.html =404; }}
    location ^~ /{p}/ {{ try_files $uri $uri/ /{p}/index.html; expires 10m; }}
''')
    site = f'''# eCash block explorers ({ROOT}): https://{DOMAIN}/<explorer>/ for each explorer.
# Written by {ROOT}/gen.py. The api containers listen on 127.0.0.1 (host network), one port each.
# The certificate is its own (certbot certonly --webroot -w /var/www/html -d {DOMAIN}), apart from the other sites'.
server {{
    listen 80;
    listen [::]:80;
    server_name {DOMAIN};
    location /.well-known/acme-challenge/ {{ root /var/www/html; }}
    location / {{ return 301 https://$host$request_uri; }}
}}

server {{
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name {DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/{DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    access_log /var/log/nginx/ecash-explorer.access.log;
    error_log  /var/log/nginx/ecash-explorer.error.log;

    root {ROOT}/www;
    index index.html;
    add_header Cache-Control "public, no-transform";
    location /.well-known/acme-challenge/ {{ root /var/www/html; }}
    location = / {{ return 302 /{HOME}/; }}
    location ^~ /resources/ {{ expires 1h; }}

''' + '\n'.join(loc) + '''
    location / {{ return 404; }}
}}
'''.replace('{{', '{').replace('}}', '}')
    with open(os.path.join(out, 'nginx-site.conf'), 'w') as f:
        f.write(site)
    with open(os.path.join(out, 'urls.env'), 'w') as f:
        f.write(','.join(f'{k}={v}' for k, v in urls.items()) + '\n')
    with open(os.path.join(out, 'explorers.json'), 'w') as f:
        json.dump(EXPLORERS, f, indent=2)
    for e in EXPLORERS:
        src = f"rpc 127.0.0.1:{e['rpc_port']}" if e['kind'] == 'l1' else f"sidechain {e['sidechain_rpc']}"
        print(f"{e['id']:18} https://{DOMAIN}/{e['path']}/  {e['profile']} on {e['network']}  api 127.0.0.1:{e['api_port']}"
              f"  {src}  enforcer {e['enforcer']}")


if __name__ == '__main__':
    main()
