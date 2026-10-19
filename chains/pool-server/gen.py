#!/usr/bin/env python3
"""
Chains explorers on the pool server (46.224.180.56), lean layout. Writes into OUT (default ./stage):
  docker-compose.yml          db (MariaDB, host network, 127.0.0.1:3317), cookies (copies the nodes' RPC cookies
                              for the api containers, no network), api-<chain> (backend, host network, 127.0.0.1-only
                              by ufw; port 18900 + slot), all with memory caps
  config/<chain>.json         backend mempool-config.json
  initdb/databases.sql
  www-config/<chain>.js       the frontend's /resources/config.js for each hostname
  nginx-site.conf             the host nginx site: https://explorer.chains.blockfab.org/<chain>/
The frontends are served by the host nginx from www/<chain>/ (the en-US bundle of chains-explorer/frontend with
<base href="/<chain>/">, see www.sh) and www/resources/ (shared).
  python3 gen.py [--compose ~/skydoge/explorer/chains/compose.py] [--out stage]
"""
import argparse, importlib.util, json, os, types

DOMAIN = 'explorer.blockfab.org'
API_BASE = 18900
DB_PORT = 3317
ROOT = '/opt/chains-explorer'
MEM = {'chains': '256m'}
DEFAULT_MEM = '192m'




def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--compose', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'compose.py'))
    ap.add_argument('--out', default='stage')
    ap.add_argument('--tag', default='local')
    a = ap.parse_args()
    spec = importlib.util.spec_from_file_location('compose', a.compose)
    cp = importlib.util.module_from_spec(spec); spec.loader.exec_module(cp)
    profiles = list(cp.PROFILES)
    urls = {p: f'https://{DOMAIN}/{p}' for p in profiles}
    out = a.out
    for d in ('config', 'initdb', 'www-config'):
        os.makedirs(os.path.join(out, d), exist_ok=True)

    def port(p):
        return API_BASE + (cp.PROFILES[p][0] or 0)

    for p in profiles:
        args = types.SimpleNamespace(node_host='127.0.0.1', network='testnet', backfill=20000)
        cfg = cp.backend_config(p, args, urls)
        rpc = cp.PROFILES[p][1]
        cfg['MEMPOOL']['HTTP_PORT'] = port(p)
        cfg['CORE_RPC'].update({'HOST': '127.0.0.1', 'PORT': rpc})
        cfg['DATABASE'].update({'HOST': '127.0.0.1', 'PORT': DB_PORT})
        cfg['CHAIN']['MAINCHAIN_RPC'].update({'HOST': '127.0.0.1', 'PORT': cp.PROFILES['chains'][1]})
        with open(os.path.join(out, 'config', f'{p}.json'), 'w') as f:
            json.dump(cfg, f, indent=2)
    with open(os.path.join(out, 'initdb', 'databases.sql'), 'w') as f:
        for p in profiles:
            f.write(f"CREATE DATABASE IF NOT EXISTS explorer_{p};\nGRANT ALL ON explorer_{p}.* TO 'mempool'@'%';\n")

    L = ['# Written by gen.py (Chains explorers on the pool server); edit that and run it again.',
         'name: chains-explorer', 'services:',
         '  db:', '    image: mariadb:10.5.21', '    container_name: chains-explorer-db', '    restart: unless-stopped',
         '    network_mode: host', '    mem_limit: 256m', '    cpus: 1.0',
         '    environment:', '      MYSQL_USER: mempool', '      MYSQL_PASSWORD: mempool', '      MYSQL_ROOT_PASSWORD: admin',
         f'    command: ["--bind-address=127.0.0.1", "--port={DB_PORT}", "--innodb-buffer-pool-size=64M", "--performance-schema=OFF",'
         ' "--max-connections=120", "--skip-name-resolve", "--innodb-log-buffer-size=8M", "--key-buffer-size=8M"]',
         '    volumes:', '      - ./mysql:/var/lib/mysql', '      - ./initdb:/docker-entrypoint-initdb.d:ro',
         '    healthcheck:', f'      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-P", "{DB_PORT}", "-umempool", "-pmempool"]',
         '      interval: 10s', '      retries: 30',
         # copies each node's RPC cookie (root 0600, replaced when a node restarts) where the api containers (uid 1000) read it
         '  cookies:', '    image: mariadb:10.5.21', '    container_name: chains-explorer-cookies', '    restart: unless-stopped',
         '    network_mode: none', '    mem_limit: 16m', '    cpus: 0.1',
         '    entrypoint: ["sh", "-c", "while true; do for c in ' + ' '.join(profiles) + '; do'
         ' f=/nodes/$$c/testnet/.cookie; [ -s $$f ] && ! cmp -s $$f /cookies/$$c.cookie && cp $$f /cookies/.$$c.tmp'
         ' && chown 1000:1000 /cookies/.$$c.tmp && chmod 600 /cookies/.$$c.tmp && mv /cookies/.$$c.tmp /cookies/$$c.cookie; done; sleep 15; done"]',
         '    volumes:', '      - ./cookies:/cookies']
    L += [f'      - /opt/chains/data/{p}/testnet:/nodes/{p}/testnet:ro' for p in profiles]
    for p in profiles:
        L += [f'  api-{p}:', f'    image: chains-explorer/backend:{a.tag}', f'    container_name: chains-explorer-api-{p}',
              '    restart: unless-stopped', '    network_mode: host', '    user: "1000:1000"',
              f'    mem_limit: {MEM.get(p, DEFAULT_MEM)}', '    cpus: 0.5',
              '    depends_on:', '      db:', '        condition: service_healthy',
              '    environment:', '      MEMPOOL_CONFIG_FILE: /config/mempool-config.json',
              f'      NODE_OPTIONS: "--max-old-space-size={160 if p == "chains" else 128}"',
              '    volumes:', f'      - ./config/{p}.json:/config/mempool-config.json:ro', '      - ./cookies:/cookies:ro',
              f'      - ./data/{p}:/backend/cache']
    with open(os.path.join(out, 'docker-compose.yml'), 'w') as f:
        f.write('\n'.join(L) + '\n')

    # nginx: one server block, one sub-path per chain (/chains/, /thunder/, ...); the front page goes to /chains/
    loc = []
    for p in profiles:
        prt = port(p)
        loc.append(f'''    # {p}
    location = /{p} {{ return 301 /{p}/; }}
    location = /{p}/resources/config.js {{ alias {ROOT}/www-config/{p}.js; expires 5m; }}
    location ^~ /{p}/resources/ {{ alias {ROOT}/www/resources/; expires 1h; }}
    location ^~ /{p}/api/v1/ws {{ proxy_pass http://127.0.0.1:{prt}/; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "Upgrade"; proxy_read_timeout 1h; }}
    location ^~ /{p}/api/v1/services {{ return 404; }}
    location ^~ /{p}/api/v1 {{ proxy_pass http://127.0.0.1:{prt}/api/v1; }}
    location ^~ /{p}/api/ {{ proxy_pass http://127.0.0.1:{prt}/api/v1/; }}
    location = /{p}/api {{ try_files /{p}/index.html =404; }}
    location ^~ /{p}/ {{ try_files $uri $uri/ /{p}/index.html; expires 10m; }}
''')
    site = f'''# Chains block explorers (/opt/chains-explorer): https://{DOMAIN}/<chain>/ for each chain.
# Written by /opt/chains-explorer/gen.py. The api containers listen on 127.0.0.1:{API_BASE}+slot (host network).
server {{
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name {DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/{DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    access_log /var/log/nginx/chains-explorer.access.log;
    error_log  /var/log/nginx/chains-explorer.error.log;

    root {ROOT}/www;
    index index.html;
    add_header Cache-Control "public, no-transform";
    location /.well-known/acme-challenge/ {{ root /var/www/html; }}
    location = / {{ return 302 /chains/; }}
    location ^~ /resources/ {{ expires 1h; }}

''' + '\n'.join(loc) + '''
    location / {{ return 404; }}
}}
'''.replace('{{', '{').replace('}}', '}')
    with open(os.path.join(out, 'nginx-site.conf'), 'w') as f:
        f.write(site)
    for p in profiles:
        print(f'{p:11} https://{DOMAIN}/{p}/  api 127.0.0.1:{port(p)}  rpc 127.0.0.1:{cp.PROFILES[p][1]}')
    with open(os.path.join(out, 'urls.env'), 'w') as f:
        f.write(','.join(f'{k}={v}' for k, v in urls.items()) + '\n')


if __name__ == '__main__':
    main()
