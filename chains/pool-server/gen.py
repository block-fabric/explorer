#!/usr/bin/env python3
"""
The eCash explorers on the pool server (46.224.180.56), next to its eCash node and bip300301_enforcer. Run on the
server, in ROOT; writes into OUT (default ./stage):
  docker-compose.yml          db (MariaDB, host network, 127.0.0.1:3318), db-setup (creates the databases, also on an
                              existing db) and api-<explorer> (backend, host network, 127.0.0.1:<api port>); a
                              sidechain explorer adds api-<explorer>-full; all with memory and CPU caps
  config/<explorer>.json      the backend's mempool-config.json
  initdb/databases.sql
  nginx-site.conf             the host nginx site: https://explorer.blockfab.org/<explorer>/
  urls.env                    the explorers' public URLs, for www.sh
The frontends are served by the host nginx from www/<explorer>/ (the en-US bundle of ecash-explorer/frontend with
<base href="/<explorer>/">, see www.sh) and www/resources/ (shared).

Node RPC credentials are not in this repository: secrets/<network>.rpc holds "user:password" of a read-only RPC
user (rpcauth + rpcwhitelist on the node).
A sidechain explorer is two backends of the same image: api-<explorer> (CHAIN.L2_ROLE index) indexes the sidechain
node and serves /api/v1/l2/* and /api/v1/chain, plus a Bitcoin Core JSON-RPC view of its index on 127.0.0.1:<l2 rpc
port>; api-<explorer>-full (CHAIN.L2_ROLE full) is upstream mempool's backend (MariaDB explorer_<id>, mempool,
websocket, statistics, block indexing, address index) with that view as its node. nginx sends /api/v1/chain and
/api/v1/l2/ to the first, the websocket and the rest of /api to the second.
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
        'api_port': 18951 + i, 'l2_rpc_port': 19951 + i, 'full_port': 18961 + i,
        'sidechain_rpc': f'http://{SIDECHAIN_HOST}:{rpc}', 'enforcer': 'http://127.0.0.1:8123',
        'weight': 4000000, 'mem': '384m', 'heap_mb': 256, 'full_mem': '512m', 'full_heap_mb': 384,
    }
    for i, (profile, rpc) in enumerate([('thunder', 16009), ('bitnames', 16002), ('bitassets', 16004),
                                        ('truthcoin', 16013), ('zside', 16098), ('coinshift', 16255)])
]
# The front page goes to this explorer
HOME = 'betanet'
# Explorers renamed since they went public: the old URL path redirects to the new one (301, the rest of the path and
# the query kept). Slot 13 was 'hivemind' (the name of its node software) until it took its chain's name, Truthcoin.
RENAMED = {'betanet/hivemind': 'betanet/truthcoin'}

# The POST routes (a tx to broadcast): per client IP at most TX_RATE, TX_BURST more queued at once; a body of at most
# TX_BODY (a sidechain tx: chain/l2/submit.ts takes 64 KB; an eCash tx up to 100 kB, 200 kB as hex)
TX_RATE, TX_BURST = '6r/m', 6
TX_BODY = {'l1': '256k', 'l2': '64k'}

# The server has no swap: if memory runs out, the kernel must kill an explorer container before the pool's node or its
# enforcer (which would stop mining). Positive scores make the explorer the OOM killer's first choice, the full sidechain
# backends before the rest.
OOM_SCORE = 500
OOM_SCORE_FULL = 800

# How many of the newest blocks the backend indexes into MariaDB (block stats, mining pages). Each one is read in
# full from the node, which also serves the pool's block templates: two weeks of blocks, not the whole chain.
INDEXING_BLOCKS = 2016


def db_name(e):
    return 'explorer_' + e['id'].replace('-', '_')


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
            'ENABLED': True, 'HOST': '127.0.0.1', 'PORT': DB_PORT, 'DATABASE': db_name(e),
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
    """A sidechain explorer's index backend: its own indexer and routes, and the Core JSON-RPC view of the index for
    its full backend (no eCash node, database or mempool)"""
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
            # the BMM views: the eCash explorer backend of the same network, next to this one (network_mode host)
            'MAINCHAIN_API': f"http://127.0.0.1:{l1_of(e['network'])['api_port']}",
            'EXPLORER_URLS': urls,
            'ADDRESS_INDEX': False,
            'L2_ROLE': 'index',
            'L2_RPC_PORT': e['l2_rpc_port'],
        },
    }


def l2_full_config(e, urls):
    """A sidechain explorer's full backend: upstream mempool's (database, mempool, websocket, statistics, block and
    address indexing) on the Core JSON-RPC view its index backend serves (no credentials: loopback only)"""
    return {
        'MEMPOOL': {
            'NETWORK': 'mainnet', 'BACKEND': 'none', 'HTTP_PORT': e['full_port'], 'CACHE_DIR': '/backend/cache',
            # the sidechains are small (a block per eCash block at most): every block is indexed
            'BLOCK_WEIGHT_UNITS': e['weight'], 'INDEXING_BLOCKS_AMOUNT': -1, 'USER_AGENT': 'ecash-explorer',
            'STDOUT_LOG_MIN_PRIORITY': 'info', 'AUTOMATIC_POOLS_UPDATE': False, 'ENABLED': True,
            'POLL_RATE_MS': 2000, 'API_URL_PREFIX': '/api/v1/', 'SPAWN_CLUSTER_PROCS': 0,
        },
        'CORE_RPC': {
            'HOST': '127.0.0.1', 'PORT': e['l2_rpc_port'], 'USERNAME': 'explorer', 'PASSWORD': 'explorer', 'TIMEOUT': 60000,
            'COOKIE': False,
        },
        'DATABASE': {
            'ENABLED': True, 'HOST': '127.0.0.1', 'PORT': DB_PORT, 'DATABASE': db_name(e),
            'USERNAME': 'mempool', 'PASSWORD': 'mempool',
        },
        'STATISTICS': {'ENABLED': True, 'TX_PER_SECOND_SAMPLE_PERIOD': 150},
        'FIAT_PRICE': {'ENABLED': False},
        'MAXMIND': {'ENABLED': False},
        'CHAIN': {
            'PROFILE': e['profile'], 'NETWORK': e['network'],
            'EXPLORER_URLS': urls,
            'ADDRESS_INDEX': True,
            'L2_ROLE': 'full',
        },
    }


def l1_of(network):
    """The eCash explorer (kind l1) of a network"""
    return next(x for x in EXPLORERS if x['kind'] == 'l1' and x['network'] == network)


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

    configs = [(e['id'], backend_config(e, urls)) for e in EXPLORERS]
    configs += [(f"{e['id']}-full", l2_full_config(e, urls)) for e in EXPLORERS if e['kind'] == 'l2']
    for name, c in configs:
        path = os.path.join(out, 'config', f"{name}.json")
        with open(path, 'w') as f:
            json.dump(c, f, indent=2)
        # it holds the node's RPC password: readable by the api container's user (1000) only
        os.chmod(path, 0o600)
        if os.geteuid() == 0:
            os.chown(path, 1000, 1000)
    # every backend with a database: the eCash explorers and the sidechains' full backends
    with open(os.path.join(out, 'initdb', 'databases.sql'), 'w') as f:
        for e in EXPLORERS:
            f.write(f"CREATE DATABASE IF NOT EXISTS {db_name(e)};\nGRANT ALL ON {db_name(e)}.* TO 'mempool'@'%';\n")

    L = ['# Written by gen.py (eCash explorers on the pool server); edit that and run it again.',
         'name: ecash-explorer', 'services:',
         '  db:', '    image: mariadb:10.5.21', '    container_name: ecash-explorer-db', '    restart: unless-stopped',
         '    network_mode: host', '    mem_limit: 512m', '    cpus: 1.0', f'    oom_score_adj: {OOM_SCORE}',
         '    environment:', '      MYSQL_USER: mempool', '      MYSQL_PASSWORD: mempool', '      MYSQL_ROOT_PASSWORD: admin',
         f'    command: ["--bind-address=127.0.0.1", "--port={DB_PORT}", "--innodb-buffer-pool-size=256M", "--performance-schema=OFF",'
         ' "--max-connections=120", "--skip-name-resolve", "--innodb-log-buffer-size=8M", "--key-buffer-size=8M"]',
         '    volumes:', '      - ./mysql:/var/lib/mysql', '      - ./initdb:/docker-entrypoint-initdb.d:ro',
         '    healthcheck:', f'      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-P", "{DB_PORT}", "-umempool", "-pmempool"]',
         '      interval: 10s', '      retries: 30',
         # initdb/ runs only when the db's volume is new: this creates the databases added since (IF NOT EXISTS)
         '  db-setup:', '    image: mariadb:10.5.21', '    container_name: ecash-explorer-db-setup', '    restart: "no"',
         '    network_mode: host', '    depends_on:', '      db:', '        condition: service_healthy',
         '    volumes:', '      - ./initdb:/initdb:ro',
         f'    entrypoint: ["sh", "-c", "mysql -h 127.0.0.1 -P {DB_PORT} -uroot -padmin < /initdb/databases.sql"]']

    def api(name, e, mem, cpus, heap, config, data, depends):
        oom = OOM_SCORE_FULL if name.endswith('-full') else OOM_SCORE
        r = [f'  api-{name}:', f'    image: ecash-explorer/backend:{a.tag}', f'    container_name: ecash-explorer-api-{name}',
             '    restart: unless-stopped', '    network_mode: host', '    user: "1000:1000"', f"    mem_limit: {mem}", f"    cpus: {cpus}",
             f'    oom_score_adj: {oom}']
        if depends:
            r += ['    depends_on:'] + [f'      {d}:\n        condition: {c}' for d, c in depends]
        return r + ['    environment:', '      MEMPOOL_CONFIG_FILE: /config/mempool-config.json',
                    f'      NODE_OPTIONS: "--max-old-space-size={heap}"',
                    '    volumes:', f'      - ./config/{config}.json:/config/mempool-config.json:ro', f'      - ./data/{data}:/backend/cache']

    for e in EXPLORERS:
        p = e['id']
        if e['kind'] == 'l1':
            L += api(p, e, e['mem'], 1.0, e['heap_mb'], p, p, [('db-setup', 'service_completed_successfully')])
        else:
            L += api(p, e, e['mem'], 0.5, e['heap_mb'], p, p, [])
            L += api(f'{p}-full', e, e['full_mem'], 0.5, e['full_heap_mb'], f'{p}-full', f'{p}-full',
                     [('db-setup', 'service_completed_successfully'), (f'api-{p}', 'service_started')])
    with open(os.path.join(out, 'docker-compose.yml'), 'w') as f:
        f.write('\n'.join(L) + '\n')

    # nginx: one server block, one sub-path per explorer (/betanet/, ...); the front page goes to HOME
    loc = []
    for e in EXPLORERS:
        # a sidechain: the index backend answers /api/v1/chain and /api/v1/l2/, the full backend the rest
        p, prt = e['path'], e.get('full_port', e['api_port'])
        # the POST routes, rate limited: upstream's (tx, txs/test, txs/package, also as esplora's /api/...) on the
        # (full) backend, and a sidechain's POST /api/v1/l2/tx on its index backend (exact matches: ahead of the rest)
        post = f"limit_req zone=explorer_tx burst={TX_BURST} nodelay; client_max_body_size {TX_BODY[e['kind']]};"
        posts = ''.join(f"    location = /{p}/api/{v}{r} {{ {post} proxy_pass http://127.0.0.1:{prt}/api/v1/{r}; }}\n"
                        for r in ('tx', 'txs/test', 'txs/package') for v in ('', 'v1/'))
        if e['kind'] == 'l2':
            posts += f"    location = /{p}/api/v1/l2/tx {{ {post} proxy_pass http://127.0.0.1:{e['api_port']}/api/v1/l2/tx; }}\n"
        idx = '' if e['kind'] == 'l1' else f'''    location = /{p}/api/v1/chain {{ proxy_pass http://127.0.0.1:{e['api_port']}/api/v1/chain; }}
    location ^~ /{p}/api/v1/l2/ {{ proxy_pass http://127.0.0.1:{e['api_port']}/api/v1/l2/; }}
'''
        loc.append(f'''    # {p}: {e['profile']} on {e['network']}
    location = /{p} {{ return 301 /{p}/; }}
    location = /{p}/resources/config.js {{ alias {ROOT}/www-config/{e['id']}.js; expires 5m; }}
    location ^~ /{p}/resources/ {{ alias {ROOT}/www/resources/; expires 1h; }}
    location ^~ /{p}/api/v1/ws {{ proxy_pass http://127.0.0.1:{prt}/; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "Upgrade"; proxy_read_timeout 1h; }}
    location ^~ /{p}/api/v1/services {{ return 404; }}
{posts}{idx}    location ^~ /{p}/api/v1 {{ proxy_pass http://127.0.0.1:{prt}/api/v1; }}
    location ^~ /{p}/api/ {{ proxy_pass http://127.0.0.1:{prt}/api/v1/; }}
    location = /{p}/api {{ try_files /{p}/index.html =404; }}
    location ^~ /{p}/ {{ try_files $uri $uri/ /{p}/index.html; expires 10m; }}
''')
    for old, new in RENAMED.items():
        loc.append(f'''    # {old}: renamed {new}
    location = /{old} {{ return 301 /{new}/; }}
    location ^~ /{old}/ {{ rewrite ^/{old}/(.*)$ /{new}/$1 permanent; }}
''')
    site = f'''# eCash block explorers ({ROOT}): https://{DOMAIN}/<explorer>/ for each explorer.
# Written by {ROOT}/gen.py. The api containers listen on 127.0.0.1 (host network), one port each.
# The certificate is its own (certbot certonly --webroot -w /var/www/html -d {DOMAIN}), apart from the other sites'.

# the POST routes (a tx to broadcast), per client IP (this file is included in nginx's http block)
limit_req_zone $binary_remote_addr zone=explorer_tx:10m rate={TX_RATE};

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
    limit_req_status 429;

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
        src = f"rpc 127.0.0.1:{e['rpc_port']}" if e['kind'] == 'l1' else \
            f"sidechain {e['sidechain_rpc']}  core view 127.0.0.1:{e['l2_rpc_port']}  full api 127.0.0.1:{e['full_port']} ({db_name(e)})"
        print(f"{e['id']:18} https://{DOMAIN}/{e['path']}/  {e['profile']} on {e['network']}  api 127.0.0.1:{e['api_port']}"
              f"  {src}  enforcer {e['enforcer']}")


if __name__ == '__main__':
    main()
