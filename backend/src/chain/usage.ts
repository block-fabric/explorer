import { Application, NextFunction, Request, Response } from 'express';
import config from '../config';

/**
 * Who uses this explorer's API: every request counted per client, hour by hour, for the last HOURS hours, in memory.
 * The client is the address nginx passes in X-Real-IP (the visitor's own, behind Cloudflare: gen.py's realip), else
 * the connection's. Per client: requests, errors (4xx/5xx, 429s apart: refused by nginx's limits never get here),
 * time spent answering, its user agent and its busiest routes (ids and heights folded: /api/v1/block/:hash).
 *
 *   GET /api/v1/internal/usage?hours=24&top=30   the top clients, user agents and routes over the last hours
 *
 * nginx answers 404 for /api/v1/internal from outside (gen.py): read it on the server, e.g.
 * curl -s http://127.0.0.1:18959/api/v1/internal/usage | jq
 */

const HOURS = 48;
const MAX_CLIENTS = 5000;   // clients kept a hour; the rest counted together as "other"
const MAX_ROUTES = 40;      // routes kept per client

interface Client { requests: number; errors: number; ms: number; ua: string; routes: Map<string, number> }
interface Hour { hour: number; clients: Map<string, Client> }

const hours: Hour[] = [];

/** a path with its ids and numbers folded, so that a client's routes add up */
export function route(path: string): string {
  return path.split('?')[0]
    .replace(/\/[0-9a-fA-F]{64}(?=\/|$)/g, '/:hash')
    .replace(/\/[0-9]+(?=\/|$)/g, '/:n')
    .replace(/\/(bc1|tb1|bcrt1)[0-9a-z]{6,}(?=\/|$)/gi, '/:address')
    .replace(/\/[13mn2][1-9A-HJ-NP-Za-km-z]{25,40}(?=\/|$)/g, '/:address')
    .slice(0, 120);
}

function bucket(): Hour {
  const hour = Math.floor(Date.now() / 3_600_000);
  let h = hours[hours.length - 1];
  if (!h || h.hour !== hour) {
    h = { hour, clients: new Map() };
    hours.push(h);
    while (hours.length > HOURS) {
      hours.shift();
    }
  }
  return h;
}

export function usageMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const h = bucket();
    const real = req.headers['x-real-ip'];
    let ip = (typeof real === 'string' && real) || req.socket.remoteAddress || '?';
    if (!h.clients.has(ip) && h.clients.size >= MAX_CLIENTS) {
      ip = 'other';
    }
    let c = h.clients.get(ip);
    if (!c) {
      c = { requests: 0, errors: 0, ms: 0, ua: '', routes: new Map() };
      h.clients.set(ip, c);
    }
    c.requests++;
    c.ms += Date.now() - start;
    if (res.statusCode >= 400) {
      c.errors++;
    }
    c.ua = String(req.headers['user-agent'] ?? '').slice(0, 160);
    const r = route(req.originalUrl || req.url);
    if (c.routes.has(r) || c.routes.size < MAX_ROUTES) {
      c.routes.set(r, (c.routes.get(r) ?? 0) + 1);
    }
  });
  next();
}

/** The last `span` hours: totals, the top clients, user agents and routes */
export function usageReport(span: number, top: number): any {
  const since = Math.floor(Date.now() / 3_600_000) - span + 1;
  const clients = new Map<string, Client>();
  for (const h of hours.filter(x => x.hour >= since)) {
    for (const [ip, c] of h.clients) {
      const t = clients.get(ip) ?? { requests: 0, errors: 0, ms: 0, ua: '', routes: new Map() };
      t.requests += c.requests;
      t.errors += c.errors;
      t.ms += c.ms;
      t.ua = c.ua || t.ua;
      for (const [r, n] of c.routes) {
        t.routes.set(r, (t.routes.get(r) ?? 0) + n);
      }
      clients.set(ip, t);
    }
  }
  const all = [...clients.entries()];
  const total = all.reduce((s, [, c]) => s + c.requests, 0);
  const ranked = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)
    .map(([key, n]) => ({ key, requests: n, share: total ? n / total : 0 }));
  const agents = new Map<string, number>();
  const routes = new Map<string, number>();
  for (const [, c] of all) {
    agents.set(c.ua || '(none)', (agents.get(c.ua || '(none)') ?? 0) + c.requests);
    for (const [r, n] of c.routes) {
      routes.set(r, (routes.get(r) ?? 0) + n);
    }
  }
  return {
    hours: span, since: since * 3600, total, clients: all.length,
    top: all.sort((a, b) => b[1].requests - a[1].requests).slice(0, top).map(([ip, c]) => ({
      ip, requests: c.requests, share: total ? c.requests / total : 0, errors: c.errors, avgMs: c.requests ? Math.round(c.ms / c.requests) : 0,
      ua: c.ua, routes: [...c.routes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    })),
    agents: ranked(agents),
    routes: ranked(routes),
  };
}

export function usageRoutes(app: Application): void {
  app.get(config.MEMPOOL.API_URL_PREFIX + 'internal/usage', (req: Request, res: Response) => {
    const span = Math.max(1, Math.min(HOURS, Number(req.query.hours) || 24));
    const top = Math.max(1, Math.min(200, Number(req.query.top) || 30));
    res.json(usageReport(span, top));
  });
}
