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
  urls.env                    each explorer's cross links (its CHAIN_EXPLORER_URLS), one line each: <id> <k=url,...>
The frontends are served by the host nginx from www/<explorer>/ (the en-US bundle of ecash-explorer/frontend with
<base href="/<explorer>/">, see www.sh) and www/resources/ (shared).

Node RPC credentials are not in this repository: secrets/<network>.rpc holds "user:password" of a read-only RPC
user (rpcauth + rpcwhitelist on the node).
A sidechain explorer is two backends of the same image: api-<explorer> (CHAIN.L2_ROLE index) indexes the sidechain
node and serves /api/v1/l2/* and /api/v1/chain, plus a Bitcoin Core JSON-RPC view of its index on 127.0.0.1:<l2 rpc
port>; api-<explorer>-full (CHAIN.L2_ROLE full) is upstream mempool's backend (MariaDB explorer_<id>, mempool,
websocket, statistics, block indexing, address index) with that view as its node. nginx sends /api/v1/chain and
/api/v1/l2/ to the first, the websocket and the rest of /api to the second.
The Flush explorer (kind flush, chains/FLUSH-API.md) is one backend, api-betanet-flush: upstream mempool's (MariaDB
explorer_betanet_flush, mempool, websocket, statistics, block indexing, address index) on the Flush node's own Core
RPC (secrets/betanet-flush.rpc), plus /api/v1/flush/*: the node's read RPCs on an allowlist and the reads of the
node's public DEX API (markets, launches). nginx rate-limits /api/v1/flush/ per IP. The FreeBank explorer (kind
freebank, chains/FREEBANK-API.md) is the same on FreeBank's node (secrets/betanet-freebank.rpc), with
/api/v1/freebank/* (the node's read RPCs on an allowlist) and no address index. An explorer whose 'enabled' is
False is left out (no container, config, database, nginx location or link): for a network whose node is not reachable.
  python3 gen.py [--out stage] [--tag local] [--enable betanet-flush]
"""
import argparse, json, os
from urllib.parse import quote

DOMAIN = 'explorer.blockfab.org'
# Other hostnames sent to one explorer here, path and query kept (explorer.flush.markets/tx/<id> lands on the Flush
# explorer's tx page). Behind Cloudflare, whose origin check is not strict: they answer with DOMAIN's certificate.
ALIASES = {'explorer.flush.markets': 'betanet/flush'}
ROOT = '/opt/ecash-explorer'
DB_PORT = 3318

# Every explorer this server runs: its id (container, config and database names), URL path, chain profile and
# network, the port of its backend, and where it reads the chain. The eCash explorer (kind l1) reads the node and
# enforcer next to it; a sidechain explorer (kind l2) reads its sidechain node's public RPC on the sidechain server
# (216.128.183.114, whose firewall admits this server only) and the enforcer here. Testnet is added here when its node
# runs. The mainnet explorer has the empty path: it is the site's front page (https://explorer.blockfab.org/).
SIDECHAIN_HOST = '216.128.183.114'
EXPLORERS = [
    # mainnet: ecash-mainnet-node (RPC 127.0.0.1:8532, -txindex; its read-only RPC user in secrets/ecash.rpc) and
    # ecash-mainnet-enforcer (Connect 127.0.0.1:8133), the node and enforcer ePool mines on
    {
        'id': 'mainnet', 'path': '', 'kind': 'l1', 'profile': 'ecash', 'network': 'ecash', 'api_port': 18959,
        'rpc_port': 8532, 'enforcer': 'http://127.0.0.1:8133', 'weight': 4000000,
        'mem': '1g', 'heap_mb': 768,
        # the drivechain index (mining pages) also reads the 4032 blocks before the fork, Bitcoin's (read once)
        'history_blocks': 4032,
        # address lookups: romanz electrs next to the node (see ELECTRS); 'serve' points the backend at it (MEMPOOL.BACKEND
        # electrum) once its first sync is done
        'electrs': {'port': 50001, 'monitoring_port': 4224, 'serve': True},
    },
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
] + [
    # Thunder on mainnet (slot 9): backbone-thunder-mainnet on the sidechain server, through its read-only RPC front
    # (17009, firewalled to this server), which takes HTTP Basic auth: "user:password" in secrets/mainnet-thunder.rpc
    # (the front's public-rpc.auth there)
    {
        'id': 'mainnet-thunder', 'path': 'thunder', 'kind': 'l2', 'profile': 'thunder', 'network': 'ecash',
        'enabled': False, 'api_port': 18967, 'l2_rpc_port': 19967, 'full_port': 18968,
        'sidechain_rpc': f'http://{SIDECHAIN_HOST}:17009', 'sidechain_secret': 'mainnet-thunder',
        'enforcer': 'http://127.0.0.1:8133',
        'weight': 4000000, 'mem': '384m', 'heap_mb': 256, 'full_mem': '512m', 'full_heap_mb': 384,
    },
] + [
    # Flush (kind flush): upstream mempool on the Flush node's Core RPC (-txindex; a read-only rpcauth user with an
    # rpcwhitelist, its "user:password" in secrets/betanet-flush.rpc) and the node's public DEX API (flushd -publicapi,
    # firewalled to this server; it accepts the Host name flush.markets only). Betanet runs Flush on slot 99 for now
    # (its own slot is 46). The lab node's slot-99 flushd: RPC 38994 (rpcauth user "explorer" with an rpcwhitelist of
    # the reads chains/FLUSH-API.md lists, -txindex) and public API 38996, both firewalled to this server.
    {
        'id': 'betanet-flush', 'path': 'betanet/flush', 'kind': 'flush', 'profile': 'flush', 'network': 'ecashbeta',
        'enabled': True, 'api_port': 18957, 'rpc_host': SIDECHAIN_HOST, 'rpc_port': 38994, 'secret': 'betanet-flush',
        'public_api': f'http://{SIDECHAIN_HOST}:38996', 'public_api_host': 'flush.markets',
        # 15-second blocks: a week of them indexed into MariaDB
        'indexing_blocks': 140000, 'weight': 4000000, 'mem': '512m', 'heap_mb': 384,
    },
    # Flush on mainnet (slot 46): the pool server's own flushd (flush-mainnet-validator, RPC 127.0.0.1:8254, -txindex;
    # rpcauth user "explorer" with betanet's rpcwhitelist, "user:password" in secrets/mainnet-flush.rpc). No public DEX
    # API yet (the market pages stay off).
    {
        'id': 'mainnet-flush', 'path': 'flush', 'kind': 'flush', 'profile': 'flush', 'network': 'ecash',
        'enabled': True, 'api_port': 18960, 'rpc_host': '127.0.0.1', 'rpc_port': 8254, 'secret': 'mainnet-flush',
        'indexing_blocks': 140000, 'weight': 4000000, 'mem': '512m', 'heap_mb': 384,
    },
    # FreeBank (kind freebank, slot 130): upstream mempool on the FreeBank node's Core RPC (freebankd, a Core 0.16 base,
    # -txindex). freebankd has no rpcwhitelist: on the lab node a method filter in front of it (port 38130, firewalled to
    # this server) passes the reads chains/FREEBANK-API.md lists and what upstream calls, for the rpcauth user
    # "explorer" ("user:password" in secrets/betanet-freebank.rpc). Its blocks are big (thousands of txs): a week of
    # them indexed into MariaDB; no address index.
    {
        'id': 'betanet-freebank', 'path': 'betanet/freebank', 'kind': 'freebank', 'profile': 'freebank', 'network': 'ecashbeta',
        'enabled': True, 'api_port': 18958, 'rpc_host': SIDECHAIN_HOST, 'rpc_port': 38130, 'secret': 'betanet-freebank',
        'indexing_blocks': 1008, 'weight': 4000000, 'mem': '768m', 'heap_mb': 512,
    },
    # FreeBank on mainnet (slot 130, freebankd v1.0.0, dormant): the lab node's method filter (port 38131, the same
    # allowlist as betanet's, firewalled to this server and admitting it alone) for the rpcauth user "explorer"
    # ("user:password" in secrets/mainnet-freebank.rpc)
    {
        'id': 'mainnet-freebank', 'path': 'freebank', 'kind': 'freebank', 'profile': 'freebank', 'network': 'ecash',
        'enabled': False, 'api_port': 18969, 'rpc_host': SIDECHAIN_HOST, 'rpc_port': 38131, 'secret': 'mainnet-freebank',
        'indexing_blocks': 1008, 'weight': 4000000, 'mem': '768m', 'heap_mb': 512,
    },
]
# An explorer with 'enabled': False (e.g. a Flush explorer of a network whose node's RPC is not reachable from here) is
# left out of everything gen.py writes, unless named with --enable <id>
# Flush's slot on each network (CHAIN.FLUSH.SLOT of every explorer there: the eCash explorer names the slot after it)
FLUSH_SLOT = {'ecashbeta': 99}
# The front page goes to this explorer when none has the empty path
HOME = 'betanet'
# Explorers renamed since they went public: the old URL path redirects to the new one (301, the rest of the path and
# the query kept). Slot 13 was 'hivemind' (the name of its node software) until it took its chain's name, Truthcoin.
RENAMED = {'betanet/hivemind': 'betanet/truthcoin'}

# The POST routes (a tx to broadcast): per client IP at most TX_RATE, TX_BURST more queued at once; a body of at most
# TX_BODY (a sidechain tx: chain/l2/submit.ts takes 64 KB; an eCash tx up to 100 kB, 200 kB as hex)
TX_RATE, TX_BURST = '6r/m', 6
TX_BODY = {'l1': '256k', 'l2': '64k'}
TX_BODY['flush'] = TX_BODY['freebank'] = TX_BODY['l1']
# The Flush and FreeBank explorers' reads of their node (/api/v1/flush/, /api/v1/freebank/: allowlisted RPCs, quotes,
# Flush's public DEX API) per client IP;
# the public API counts this whole server as one client (-publicapirate, -publicapiburst): the backend's cache and
# this keep us under its budget
FLUSH_RATE, FLUSH_BURST = '5r/s', 20

# An explorer's electrs (romanz/electrs v0.12.0, its image built from the release's Dockerfile with
# electrs-lookup-limit.patch applied, as ecash-explorer/electrs:0.12.0-limit): the address index of upstream's electrum backend. It reads the node's blocks over its
# REST interface (rest=1; /rest/spenttxouts and /rest/blockpart, core 31) and its JSON-RPC as the explorer's read-only
# user (secrets/<network>.rpc: no submitpackage, which only package broadcasts need). Its index sits on / in
# electrs/<explorer>/ (~7% of the chain's blocks, twice that before the first compaction). Its first sync reads every
# block through the node ePool mines on: 4 CPUs, 4 threads, normal I/O (2026-10-27: CPU-bound at 2 with the node's disk 17% busy and
# GBT at 2-10 ms; the node's slow block connects were its empty mempool, not electrs).
# The image carries electrs-lookup-limit.patch: 0.12.0 reads index_lookup_limit and never applies it, so one address
# with tens of thousands of transactions (31,087: 99 s) held the server, which answers one request at a time, and every
# other lookup timed out behind it; patched, it is refused from its index entries alone, before any is fetched
ELECTRS_IMAGE = 'ecash-explorer/electrs:0.12.0-limit'
ELECTRS_MEM, ELECTRS_CPUS, ELECTRS_THREADS = '3g', 4.0, 4

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


def rpc_auth(name):
    path = os.path.join(ROOT, 'secrets', f'{name}.rpc')
    try:
        user, password = open(path).read().strip().split(':', 1)
    except (OSError, ValueError):
        raise SystemExit(f'{path}: missing or not "user:password" (the read-only RPC user of the {name} node)')
    return user, password


def sidechain_rpc_url(e):
    """A sidechain node's read RPC, with its Basic auth pair in the URL when it takes one (the backend's HTTP client
    sends it; the URL is not logged)"""
    if not e.get('sidechain_secret'):
        return e['sidechain_rpc']
    user, password = rpc_auth(e['sidechain_secret'])
    scheme, rest = e['sidechain_rpc'].split('://', 1)
    return f"{scheme}://{quote(user, safe='')}:{quote(password, safe='')}@{rest}"


def flush_chain(network, extra=None):
    """CHAIN.FLUSH of an explorer on a network: Flush's slot there (and the public API for the Flush explorer)"""
    return {**({'SLOT': FLUSH_SLOT[network]} if network in FLUSH_SLOT else {}), **(extra or {})}


def backend_config(e, urls):
    if e['kind'] == 'l2':
        return l2_config(e, urls)
    if e['kind'] in ('flush', 'freebank'):
        return flush_config(e, urls)
    user, password = rpc_auth(e['network'])
    return {
        'MEMPOOL': {
            'NETWORK': 'mainnet', 'BACKEND': 'electrum' if electrum_config(e) else 'none', 'HTTP_PORT': e['api_port'], 'CACHE_DIR': '/backend/cache',
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
            'HISTORY_BLOCKS': e.get('history_blocks', 0),
            'EXPLORER_URLS': urls,
            'ADDRESS_INDEX': False,
            'FLUSH': flush_chain(e['network']),
        },
        **electrum_config(e),
    }


def electrum_config(e):
    """An eCash explorer whose electrs serves: upstream's electrum backend on it (address and scripthash lookups)"""
    x = e.get('electrs')
    if not x or not x['serve']:
        return {}
    return {'ELECTRUM': {'HOST': '127.0.0.1', 'PORT': x['port'], 'TLS_ENABLED': False}}


def electrs_toml(e):
    """electrs's configuration (it holds the node's RPC password)"""
    user, password = rpc_auth(e['network'])
    x = e['electrs']
    return '\n'.join([
        '# Written by gen.py', 'network = "bitcoin"', 'db_dir = "/db"', f'daemon_rpc_addr = "127.0.0.1:{e["rpc_port"]}"',
        f'auth = "{user}:{password}"', f'electrum_rpc_addr = "127.0.0.1:{x["port"]}"',
        f'monitoring_addr = "127.0.0.1:{x["monitoring_port"]}"', f'db_parallelism = {ELECTRS_THREADS}',
        # an address with more transactions than this answers an error rather than tie electrs up (Bitcoin's history
        # has addresses with millions; about 3 ms a transaction: 10000 is ~30 s, during which other lookups wait)
        'index_lookup_limit = 10000', 'log_filters = "INFO"', ''])


def flush_config(e, urls):
    """The Flush explorer: upstream mempool on the Flush node's RPC (no enforcer, no drivechain index), its address
    index, and /api/v1/flush/* (the node's read RPCs, its public DEX API). The FreeBank explorer the same on FreeBank's
    node, without an address index or a public API (/api/v1/freebank/*: the node's read RPCs)"""
    user, password = rpc_auth(e['secret'])
    flush = e['kind'] == 'flush'
    return {
        'MEMPOOL': {
            'NETWORK': 'mainnet', 'BACKEND': 'none', 'HTTP_PORT': e['api_port'], 'CACHE_DIR': '/backend/cache',
            'BLOCK_WEIGHT_UNITS': e['weight'], 'INDEXING_BLOCKS_AMOUNT': e['indexing_blocks'], 'USER_AGENT': 'ecash-explorer',
            'STDOUT_LOG_MIN_PRIORITY': 'info', 'AUTOMATIC_POOLS_UPDATE': False, 'ENABLED': True,
            'POLL_RATE_MS': 2000, 'API_URL_PREFIX': '/api/v1/', 'SPAWN_CLUSTER_PROCS': 0,
        },
        'CORE_RPC': {
            'HOST': e['rpc_host'], 'PORT': e['rpc_port'], 'USERNAME': user, 'PASSWORD': password, 'TIMEOUT': 60000,
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
            'MAINCHAIN_EXPLORER': urls.get(e['network'], ''),
            'EXPLORER_URLS': urls,
            'ADDRESS_INDEX': flush,
            # without a public API (none yet on the network): no market pages
            'FLUSH': flush_chain(e['network'], {
                'PUBLIC_API': e['public_api'], 'PUBLIC_API_HOST': e['public_api_host'], 'PUBLIC_API_TIMEOUT': 10000,
            } if flush and e.get('public_api') else None),
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
            'SIDECHAIN_RPC': {'URL': sidechain_rpc_url(e), 'TIMEOUT': 60000, 'MAX_CONCURRENT': 2},
            'MAINCHAIN_EXPLORER': urls.get(e['network'], ''),
            # the BMM views: the eCash explorer backend of the same network, next to this one (network_mode host)
            'MAINCHAIN_API': f"http://127.0.0.1:{l1_of(e['network'])['api_port']}",
            'EXPLORER_URLS': urls,
            'ADDRESS_INDEX': False,
            'L2_ROLE': 'index',
            'L2_RPC_PORT': e['l2_rpc_port'],
            'FLUSH': flush_chain(e['network']),
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
            'FLUSH': flush_chain(e['network']),
        },
    }


def l1_of(network):
    """The eCash explorer (kind l1) of a network"""
    return next(x for x in EXPLORERS if x['kind'] == 'l1' and x['network'] == network)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='stage')
    ap.add_argument('--tag', default='local')
    ap.add_argument('--enable', action='append', default=[], help="an explorer whose 'enabled' is False, to deploy anyway")
    a = ap.parse_args()
    EXPLORERS[:] = [e for e in EXPLORERS if e.get('enabled', True) or e['id'] in a.enable]
    out = a.out
    # cross links: the eCash explorer of each network by network id (the network switcher), the sidechain explorers by
    # profile id (the chain switcher). A profile runs on more than one network (Flush on betanet and mainnet): each
    # explorer's links name its own network's.
    key = lambda e: e['network'] if e['kind'] == 'l1' else e['profile']
    url = lambda e: f"https://{DOMAIN}/{e['path']}".rstrip('/')
    for d in ('config', 'initdb'):
        os.makedirs(os.path.join(out, d), exist_ok=True)

    def urls_of(e):
        """an explorer's cross links: every network's eCash explorer, and the sidechain explorers of its own network"""
        return {key(x): url(x) for x in EXPLORERS if x['kind'] == 'l1' or x['network'] == e['network']}

    configs = [(e['id'], backend_config(e, urls_of(e))) for e in EXPLORERS]
    for e in EXPLORERS:
        if e.get('electrs'):
            path = os.path.join(out, 'config', f"electrs-{e['id']}.toml")
            with open(path, 'w') as f:
                f.write(electrs_toml(e))
            os.chmod(path, 0o600)
            if os.geteuid() == 0:
                os.chown(path, 1000, 1000)
    configs += [(f"{e['id']}-full", l2_full_config(e, urls_of(e))) for e in EXPLORERS if e['kind'] == 'l2']
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
        oom = OOM_SCORE_FULL if name.endswith('-full') or e['kind'] in ('flush', 'freebank') else OOM_SCORE
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
        elif e['kind'] in ('flush', 'freebank'):
            L += api(p, e, e['mem'], 0.5, e['heap_mb'], p, p, [('db-setup', 'service_completed_successfully')])
        else:
            L += api(p, e, e['mem'], 0.5, e['heap_mb'], p, p, [])
            L += api(f'{p}-full', e, e['full_mem'], 0.5, e['full_heap_mb'], f'{p}-full', f'{p}-full',
                     [('db-setup', 'service_completed_successfully'), (f'api-{p}', 'service_started')])
        if e.get('electrs'):
            p = e['id']
            L += [f'  electrs-{p}:', f'    image: {ELECTRS_IMAGE}', f'    container_name: ecash-explorer-electrs-{p}',
                  '    restart: unless-stopped', '    network_mode: host', '    user: "1000:1000"', f'    mem_limit: {ELECTRS_MEM}',
                  f'    cpus: {ELECTRS_CPUS}', f'    oom_score_adj: {OOM_SCORE_FULL}',
                  # RocksDB keeps its .sst files open (4,000+ for mainnet's index): Docker's 1024 refuses lookups
                  '    ulimits:', '      nofile:', '        soft: 65536', '        hard: 65536',
                  '    environment:', f'      RAYON_NUM_THREADS: "{ELECTRS_THREADS}"',
                  '    entrypoint: ["electrs", "--conf", "/config/electrs.toml"]',
                  '    volumes:', f'      - ./config/electrs-{p}.toml:/config/electrs.toml:ro', f'      - ./electrs/{p}:/db']
    with open(os.path.join(out, 'docker-compose.yml'), 'w') as f:
        f.write('\n'.join(L) + '\n')

    # nginx: one server block, one sub-path per explorer (/betanet/, ...); the front page goes to HOME
    loc = []
    for e in EXPLORERS:
        # a sidechain: the index backend answers /api/v1/chain and /api/v1/l2/, the full backend the rest
        p, prt = e['path'], e.get('full_port', e['api_port'])
        # the URL path's base: '' for the explorer at the site's root (its pages are the server's catch-all, its
        # resources/ the shared one)
        b = f'/{p}' if p else ''
        # the POST routes, rate limited: upstream's (tx, txs/test, txs/package, also as esplora's /api/...) on the
        # (full) backend, and a sidechain's POST /api/v1/l2/tx on its index backend (exact matches: ahead of the rest)
        post = f"limit_req zone=explorer_tx burst={TX_BURST} nodelay; client_max_body_size {TX_BODY[e['kind']]};"
        posts = ''.join(f"    location = {b}/api/{v}{r} {{ {post} proxy_pass http://127.0.0.1:{prt}/api/v1/{r}; }}\n"
                        for r in ('tx', 'txs/test', 'txs/package') for v in ('', 'v1/'))
        if e['kind'] in ('flush', 'freebank'):
            # Flush's and FreeBank's own reads (node RPCs, quotes, Flush's public DEX API): rate limited per IP
            k = e['kind']
            posts += (f"    location ^~ {b}/api/v1/{k}/ {{ limit_except GET {{ deny all; }} limit_req zone=explorer_tx burst={TX_BURST} nodelay; "
                      f"limit_req zone=explorer_flush burst={FLUSH_BURST} nodelay; proxy_pass http://127.0.0.1:{prt}/api/v1/{k}/; }}\n")
        if e['kind'] == 'l2':
            posts += f"    location = {b}/api/v1/l2/tx {{ {post} proxy_pass http://127.0.0.1:{e['api_port']}/api/v1/l2/tx; }}\n"
        idx = '' if e['kind'] != 'l2' else f'''    location = {b}/api/v1/chain {{ proxy_pass http://127.0.0.1:{e['api_port']}/api/v1/chain; }}
    location ^~ {b}/api/v1/l2/ {{ proxy_pass http://127.0.0.1:{e['api_port']}/api/v1/l2/; }}
'''
        sub = f'''    location = {b} {{ return 301 {b}/; }}
    location ^~ {b}/resources/ {{ alias {ROOT}/www/resources/; expires 1h; }}
''' if p else ''
        pages = f'location ^~ {b}/' if p else 'location /'
        loc.append(f'''    # {p or '/'}: {e['profile']} on {e['network']}
{sub}    location = {b}/resources/config.js {{ alias {ROOT}/www-config/{e['id']}.js; expires 5m; }}
    location ^~ {b}/api/v1/ws {{ proxy_pass http://127.0.0.1:{prt}/; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "Upgrade"; proxy_read_timeout 1h; }}
    location ^~ {b}/api/v1/services {{ return 404; }}
    location ^~ {b}/api/v1/internal {{ return 404; }}
{posts}{idx}    location ^~ {b}/api/v1 {{ proxy_pass http://127.0.0.1:{prt}/api/v1; }}
    location ^~ {b}/api/ {{ proxy_pass http://127.0.0.1:{prt}/api/v1/; }}
    location = {b}/api {{ try_files {b}/index.html =404; }}
    {pages} {{ try_files $uri $uri/ {b}/index.html; expires 10m; }}
''')
    for old, new in RENAMED.items():
        loc.append(f'''    # {old}: renamed {new}
    location = /{old} {{ return 301 /{new}/; }}
    location ^~ /{old}/ {{ rewrite ^/{old}/(.*)$ /{new}/$1 permanent; }}
''')
    root_explorer = any(not e['path'] for e in EXPLORERS)
    home = '' if root_explorer else f'    location = / {{ return 302 /{HOME}/; }}\n'
    notfound = '' if root_explorer else '    location / {{ return 404; }}\n'
    site = f'''# eCash block explorers ({ROOT}): https://{DOMAIN}/<explorer>/ for each explorer.
# Written by {ROOT}/gen.py. The api containers listen on 127.0.0.1 (host network), one port each.
# The certificate is its own (certbot certonly --webroot -w /var/www/html -d {DOMAIN}), apart from the other sites'.

# Every POST to an explorer's API, per client IP (this file is included in nginx's http block): the routes that
# broadcast a tx (tx, tx/push, txs/test, txs/package, l2/tx, …) and those that make the node work (decode, psbt). Keyed
# on the method and the normalized path, whatever location serves it, so a trailing slash or another location cannot
# get around it. Only the read-only POSTs the pages use (prevouts, cpfp) are exempt; GETs have an empty key.
map "$request_method:$uri" $explorer_tx_key {{
    "~^POST:(/.+)?/api/(v1/)?(prevouts|cpfp)/?$"          "";
    "~^POST:(/.+)?/api/"                                  $binary_remote_addr;
    default                                               "";
}}
limit_req_zone $explorer_tx_key zone=explorer_tx:10m rate={TX_RATE};
# The Flush and FreeBank explorers' reads of their node and of Flush's public DEX API, per client IP
limit_req_zone $binary_remote_addr zone=explorer_flush:10m rate={FLUSH_RATE};

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
    limit_req zone=explorer_tx burst={TX_BURST} nodelay;

    root {ROOT}/www;
    index index.html;
    add_header Cache-Control "public, no-transform";
    location /.well-known/acme-challenge/ {{ root /var/www/html; }}
{home}    location ^~ /resources/ {{ expires 1h; }}

''' + '\n'.join(loc) + notfound + '''}}
'''.replace('{{', '{').replace('}}', '}')
    for host, path in ALIASES.items():
        site += f'''
# {host}: the {path} explorer
server {{
    listen 80;
    listen [::]:80;
    server_name {host};
    location /.well-known/acme-challenge/ {{ root /var/www/html; }}
    location / {{ return 301 https://{DOMAIN}/{path}$request_uri; }}
}}
server {{
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name {host};
    ssl_certificate     /etc/letsencrypt/live/{DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    access_log /var/log/nginx/ecash-explorer.access.log;
    location / {{ return 301 https://{DOMAIN}/{path}$request_uri; }}
}}
'''
    with open(os.path.join(out, 'nginx-site.conf'), 'w') as f:
        f.write(site)
    with open(os.path.join(out, 'urls.env'), 'w') as f:
        f.writelines(f"{e['id']} " + ','.join(f'{k}={v}' for k, v in urls_of(e).items()) + '\n' for e in EXPLORERS)
    with open(os.path.join(out, 'explorers.json'), 'w') as f:
        json.dump(EXPLORERS, f, indent=2)
    for e in EXPLORERS:
        if e['kind'] in ('flush', 'freebank'):
            pub = f"  public api {e['public_api']} (Host {e['public_api_host']})" if e.get('public_api') else ''
            print(f"{e['id']:18} https://{DOMAIN}/{e['path'] + '/' if e['path'] else ''}  {e['profile']} on {e['network']}  api 127.0.0.1:{e['api_port']}"
                  f"  rpc {e['rpc_host']}:{e['rpc_port']} ({db_name(e)}){pub}")
            continue
        src = f"rpc 127.0.0.1:{e['rpc_port']}" if e['kind'] == 'l1' else \
            f"sidechain {e['sidechain_rpc']}  core view 127.0.0.1:{e['l2_rpc_port']}  full api 127.0.0.1:{e['full_port']} ({db_name(e)})"
        print(f"{e['id']:18} https://{DOMAIN}/{e['path'] + '/' if e['path'] else ''}  {e['profile']} on {e['network']}  api 127.0.0.1:{e['api_port']}"
              f"  {src}  enforcer {e['enforcer']}")


if __name__ == '__main__':
    main()
