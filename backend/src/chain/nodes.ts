import * as dns from 'dns';
import * as net from 'net';
import * as path from 'path';
import { spawn } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import axios from 'axios';
import config from '../config';
import DB from '../database';
import logger from '../logger';
import { NETWORK, NetworkId } from './networks';
import { PROFILE } from './profile';

/**
 * The network's reachable nodes (/nodes), as a crawler finds them: from the DNS seeds and the nodes already known, a
 * P2P version handshake with each address (its user agent, protocol version, services, height), then getaddr for the
 * addresses it knows, until no new address turns up. Every CRAWL_EVERY; the nodes and a snapshot per crawl are kept
 * in the database (chain_nodes, chain_nodes_crawls), so a node's uptime and the network's history survive a restart.
 *
 * It speaks to the network itself: the explorer's node is not asked (its RPC user may not read its peers). Only public
 * addresses are dialled (never a private, loopback or reserved one a peer could gossip), over IPv4 and IPv6.
 */

interface P2PNetwork {
  magic: string; port: number; seeds: string[];
  // nodes dialled besides the seeds' (ip:port): where the seeds and getaddr do not lead to them
  peers?: string[];
  // LayerTwo's protocol (QUIC streams of magic || bincode, Backbone's bt/sidechain/p2p.h), not Bitcoin's: a heartbeat
  // gives a node's height and P2P version, and nothing tells of other nodes (no getaddr). The client is the chain's
  // name; a Backbone drop-in names itself in its certificate's CN ("Thunder 1.1.0 (Backbone drop-in)").
  quic?: { client: string; version: [number, number, number] };
}

/** The P2P network of each chain on each eCash network (its node's chainparams); none: no crawler. */
const P2P: Record<string, Partial<Record<NetworkId, P2PNetwork>>> = {
  // Backbone's src/kernel/chainparams.cpp
  ecash: {
    ecash: {
      magic: 'eca5dcb7', port: 8533,
      seeds: ['seed.ecash.ninja', 'seed.bip300.xyz', 'seed.ecash.drivecha.in', 'seed.ecash.zuexeuz.net', 'seed.ecash.eu.com'],
    },
  },
  // backbone-flush src/kernel/chainparams.cpp (CEcashSidechainParams, mainnet: "flx" + 0x21); 149.248.62.245: ours,
  // behind a VPN (a second address of 216's), which its peers had not told of
  flush: { ecash: { magic: '666c7821', port: 8255, seeds: ['seed.mainnet.flush.markets'], peers: ['149.248.62.245:8255'] } },
  // freebank src/chainparams.cpp (CMainParams: its own message start, beta's port and seed). The seed lists one node,
  // which answers no getaddr: the nodes it is known to peer with are dialled too (ours on 216, and ours behind a VPN at
  // 149.248.62.245, once 67.68.165.91)
  freebank: {
    ecash: {
      magic: 'fb4bec58', port: 8455, seeds: ['seed.ecxfreebank.com'],
      peers: ['216.128.183.114:8455', '149.248.62.245:8455'],
    },
  },
  // backbone-thunder chains/thunder (net.cpp magic_bytes "THNDR" | Mainnet 0b101, DEFAULT_PORT 4000 + slot 9, node.cpp
  // MAINNET_SEED_PEER_ADDRS); P2P version 0.19.1. With no peer exchange, the addresses tried are also those of the
  // eCash crawl (its operators run Thunder next to eCash): CHAIN.MAINCHAIN_API's /chain/nodes.
  thunder: {
    ecash: {
      magic: '85189505', port: 4009, seeds: ['seed.ecash.drivecha.in', 'seed.ecash.eu.com', 'seed.ecash.ninja'],
      quic: { client: 'Thunder', version: [0, 19, 1] },
    },
  },
};

const CRAWL_EVERY = 10 * 60_000;
const CHECK_EVERY = 5 * 60_000; // between crawls, the reachable nodes' heights are checked again (a handshake, no getaddr)
const TIP_QUORUM = 3; // without the explorer's node: the highest height at least this many nodes report (no single node sets it)
const CHECK_DEADLINE = 60_000; // a check takes no new node after this
const CHECK_SESSION = 10_000; // a check's handshake, at most
const FIRST_CRAWL = 60_000;
const CONCURRENCY = 32;
const CONNECT_TIMEOUT = 8_000;
const SESSION_TIMEOUT = 20_000;
const MAX_TRIES = 5000; // addresses dialled per crawl at most
const MAX_QUEUE = 20_000; // addresses waiting to be dialled at most
const MAX_ADDRS = 1000; // addresses taken from one node (a getaddr answer has 1000 at most)
const MAX_MESSAGE = 200_000; // bytes: the largest message read (an addr of 1000 is 30 kB); larger ends the session
const MAX_NODES = 10_000; // nodes kept at most (the most recently reached)
const MAX_VERSIONS = 30; // user agents per crawl snapshot; the rest count as "other"
// one gossiped address per IP, and a few per /24 (IPv4) or /48 (IPv6), so no peer can steer the crawler at one host's
// ports or one network; never a privileged port
const PER_IP = 1;
const PER_SUBNET = 8;
const MIN_PORT = 1024;
const RECENT = 144; // the crawls a node's uptime is over (a day)
const FORGET_UNREACHABLE = 7 * 86400; // a node never reached, or not since, is forgotten after this many seconds
const PROTOCOL_VERSION = 70016;
const USER_AGENT = '/eCash-Explorer-Crawler:1.0/';
const QUIC_PROBE = path.resolve(__dirname, '../../quic-probe.py'); // /backend/quic-probe.py (docker/backend)
const QUIC_SESSION = 10_000; // a QUIC handshake and the node's heartbeat, at most
const QUIC_RUN = 180_000; // a probe run, at most (it is killed then)
const QUIC_OUTPUT = 4_000_000; // bytes of the helper's output read at most

export interface CrawledNode {
  address: string; // ip:port, [ip]:port for IPv6
  ip: string;
  port: number;
  userAgent: string | null;
  protocol: number | null;
  services: string | null; // a 64-bit flag field, as a decimal string
  height: number | null;
  latency: number | null; // ms, the handshake
  firstSeen: number; // unix seconds, first reached
  lastSeen: number; // last reached
  lastTried: number;
  recent: string; // the last RECENT crawls, newest last: 1 reached, 0 not
  checked: number | null; // when its height was read (a crawl or a check)
  tip: number | null; // the tip then: the explorer's node's height at the end of the pass the node was checked in
}

export interface CrawlSnapshot {
  time: number;
  duration: number; // seconds
  tried: number;
  reachable: number;
  known: number; // addresses heard of in this crawl
  atTip: number | null; // reachable nodes within 2 blocks of the tip when reached
  versions: Record<string, number>; // user agent: nodes
}

const nodes = new Map<string, CrawledNode>();
/** reverse DNS of the reachable nodes' addresses (null: none), refreshed every RDNS_TTL; not kept in the database */
const rdns = new Map<string, { name: string | null; at: number }>();
const RDNS_TTL = 86400;
const RDNS_TIMEOUT = 3_000;
const MAX_RDNS = 20_000;
const crawls: CrawlSnapshot[] = [];
let crawling = false;
let checking = false;
let crawlPending = false; // a crawl waits: a check takes no new node
/** the explorer's own node's height (the module's getblockcount): the reference a node's height is compared to */
let ourTip: () => Promise<number | null> = async () => null;
let lastCheck: number | null = null;
let nextCrawlAt: number | null = null; // unix seconds
let nextCheckAt: number | null = null;
let started = false;

export function p2pParams(): P2PNetwork | null {
  return P2P[PROFILE.id]?.[NETWORK.id] ?? null;
}

/** a node address's reverse DNS name, if it has one (resolved after each crawl) */
export function rdnsOf(ip: string): string | null {
  return rdns.get(ip)?.name ?? null;
}

export function getNodes(): CrawledNode[] {
  return [...nodes.values()];
}

export function getCrawls(): CrawlSnapshot[] {
  return crawls;
}

/** the schedule: when the next crawl and the next check are due (unix seconds), and their intervals */
export function schedule(): { nextCrawl: number | null; nextCheck: number | null; crawlEvery: number; checkEvery: number } {
  return { nextCrawl: nextCrawlAt, nextCheck: nextCheckAt, crawlEvery: CRAWL_EVERY / 1000, checkEvery: CHECK_EVERY / 1000 };
}

/** when the reachable nodes' heights were last checked (a crawl or a check between crawls) */
export function lastChecked(): number | null {
  return lastCheck;
}

export function isCrawling(): boolean {
  return crawling;
}

// --- addresses ------------------------------------------------------------------------------------------------------

function addressOf(ip: string, port: number): string {
  return ip.includes(':') ? `[${ip}]:${port}` : `${ip}:${port}`;
}

/** a public unicast address: not private, loopback, link-local, CGNAT, multicast, documentation or reserved */
export function isPublic(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2))
      || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      return isPublic(mapped[1]);
    }
    // global unicast only (2000::/3), less the documentation prefix and 6to4/Teredo's tunnels
    return /^[23]/.test(v) && !v.startsWith('2001:db8') && !v.startsWith('2001:0db8') && !/^2001:0?:/.test(v) && !v.startsWith('2002:');
  }
  return false;
}

/** the /24 of an IPv4 address, the /48 of an IPv6 one */
function subnetOf(ip: string): string {
  if (net.isIPv4(ip)) {
    return ip.split('.').slice(0, 3).join('.');
  }
  const full = new URL(`http://[${ip}]/`).hostname; // (validates; the expansion below needs no :: shortcut for /48)
  const [head] = full.slice(1, -1).split('::');
  return head.split(':').slice(0, 3).join(':');
}

// --- the P2P protocol -----------------------------------------------------------------------------------------------

function dsha(b: Buffer): Buffer {
  return createHash('sha256').update(createHash('sha256').update(b).digest()).digest();
}

function message(magic: Buffer, cmd: string, payload: Buffer = Buffer.alloc(0)): Buffer {
  const h = Buffer.alloc(24);
  magic.copy(h, 0);
  h.write(cmd, 4, 'ascii');
  h.writeUInt32LE(payload.length, 16);
  dsha(payload).copy(h, 20, 0, 4);
  return Buffer.concat([h, payload]);
}

function versionPayload(): Buffer {
  const ua = Buffer.from(USER_AGENT, 'ascii');
  const b = Buffer.alloc(4 + 8 + 8 + 26 + 26 + 8 + 1 + ua.length + 4 + 1);
  let i = 0;
  b.writeInt32LE(PROTOCOL_VERSION, i); i += 4;
  b.writeBigUInt64LE(0n, i); i += 8; // services: none
  b.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), i); i += 8;
  i += 26 + 26; // addr_recv, addr_from: zeros
  randomBytes(8).copy(b, i); i += 8;
  b.writeUInt8(ua.length, i); i += 1;
  ua.copy(b, i); i += ua.length;
  b.writeInt32LE(0, i); i += 4; // start height
  b.writeUInt8(0, i); // relay: no transactions
  return b;
}

function varint(b: Buffer, i: number): [number, number] {
  const n = b[i];
  if (n < 0xfd) { return [n, i + 1]; }
  if (n === 0xfd) { return [b.readUInt16LE(i + 1), i + 3]; }
  if (n === 0xfe) { return [b.readUInt32LE(i + 1), i + 5]; }
  return [Number(b.readBigUInt64LE(i + 1)), i + 9];
}

function ipOf(b: Buffer): string {
  if (b.subarray(0, 12).equals(Buffer.from('00000000000000000000ffff', 'hex'))) {
    return [...b.subarray(12)].join('.');
  }
  const parts: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    parts.push(b.readUInt16BE(i).toString(16));
  }
  return new URL(`http://[${parts.join(':')}]/`).hostname.slice(1, -1); // (its canonical, compressed form)
}

interface Probe {
  version: { protocol: number; services: string; userAgent: string; height: number; latency: number } | null;
  addrs: { ip: string; port: number }[];
}

/** a handshake with one node, and the addresses it answers getaddr with */
function probe(ip: string, port: number, magic: Buffer, addrs = true, session = SESSION_TIMEOUT): Promise<Probe> {
  return new Promise((resolve) => {
    const res: Probe = { version: null, addrs: [] };
    const t0 = Date.now();
    let buf = Buffer.alloc(0);
    let done = false;
    const sock = net.connect({ host: ip, port, family: net.isIPv6(ip) ? 6 : 4 });
    const finish = () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        sock.destroy();
        resolve(res);
      }
    };
    const timer = setTimeout(finish, session);
    sock.setTimeout(CONNECT_TIMEOUT, finish);
    sock.on('error', finish);
    sock.on('close', finish);
    sock.on('connect', () => sock.write(message(magic, 'version', versionPayload())));
    sock.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 24 + MAX_MESSAGE) {
        return finish();
      }
      while (buf.length >= 24) {
        if (!buf.subarray(0, 4).equals(magic)) {
          return finish(); // another network
        }
        const len = buf.readUInt32LE(16);
        if (len > MAX_MESSAGE) {
          return finish();
        }
        if (buf.length < 24 + len) {
          break;
        }
        const cmd = buf.subarray(4, 16).toString('ascii').replace(/\0+$/, '');
        const p = buf.subarray(24, 24 + len);
        buf = buf.subarray(24 + len);
        try {
          if (cmd === 'version' && p.length >= 85) {
            const [uaLen, i] = varint(p, 80);
            res.version = {
              protocol: p.readInt32LE(0), services: p.readBigUInt64LE(4).toString(),
              userAgent: p.subarray(i, i + Math.min(uaLen, 256)).toString('utf8').replace(/[^\x20-\x7e]/g, ''),
              height: p.length >= i + uaLen + 4 ? p.readInt32LE(i + uaLen) : 0, latency: Date.now() - t0,
            };
            if (!addrs) {
              return finish(); // a check: the version is all it wants
            }
            sock.write(message(magic, 'verack'));
            sock.write(message(magic, 'getaddr'));
          } else if (cmd === 'ping') {
            sock.write(message(magic, 'pong', p));
          } else if (cmd === 'addr' && res.version) {
            const [n, start] = varint(p, 0);
            for (let k = 0, i = start; k < n && i + 30 <= p.length && res.addrs.length < MAX_ADDRS; k++, i += 30) {
              res.addrs.push({ ip: ipOf(p.subarray(i + 12, i + 28)), port: p.readUInt16BE(i + 28) });
            }
            if (n > 1 || res.addrs.length >= MAX_ADDRS) {
              return finish(); // the answer to getaddr (a single address is a node announcing itself)
            }
          }
        } catch {
          return finish();
        }
      }
    });
  });
}

/** a LayerTwo node's heartbeat answer as a version handshake's: its user agent made from its certificate's CN */
function quicVersion(q: NonNullable<P2PNetwork['quic']>, r: any): NonNullable<Probe['version']> {
  const v = Array.isArray(r.version) ? r.version.slice(0, 3).map((x: unknown) => Number(x) || 0).join('.') : '?';
  const cn = typeof r.cn === 'string' ? r.cn.replace(/[^\x20-\x7e]/g, '').slice(0, 128) : '';
  const dropIn = /^(.+?) ([0-9][0-9.]*) \(Backbone drop-in\)$/.exec(cn);
  return {
    protocol: 0, services: '0', latency: Number(r.latency) || 0,
    userAgent: dropIn ? `/${dropIn[1]} Backbone:${dropIn[2]}(P2P ${v})/` : `/${q.client}:${v}/`,
    height: Number.isInteger(r.height) && r.height >= 0 ? r.height : 0,
  };
}

/** a heartbeat with each of a LayerTwo network's nodes, by the QUIC helper (docker/backend/quic-probe.py) */
function quicProbe(p2p: P2PNetwork, targets: { ip: string; port: number }[], timeout = QUIC_SESSION): Promise<Map<string, NonNullable<Probe['version']>>> {
  return new Promise((resolve) => {
    const out = new Map<string, NonNullable<Probe['version']>>();
    if (!targets.length || !p2p.quic) {
      return resolve(out);
    }
    const q = p2p.quic;
    const wanted = new Set(targets.map(t => addressOf(t.ip, t.port)));
    let buf = '';
    let read = 0;
    const child = spawn('python3', ['-I', QUIC_PROBE], { stdio: ['pipe', 'pipe', 'ignore'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), QUIC_RUN);
    const line = (l: string) => {
      try {
        const r = JSON.parse(l);
        const key = addressOf(String(r.ip), Number(r.port));
        if (wanted.has(key)) {
          out.set(key, quicVersion(q, r));
        }
      } catch { /* a partial line */ }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      read += chunk.length;
      if (read > QUIC_OUTPUT) {
        return child.kill('SIGKILL');
      }
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      lines.forEach(line);
    });
    const done = () => {
      clearTimeout(timer);
      resolve(out);
    };
    child.on('error', (e) => {
      logger.warn(`Nodes crawler: the QUIC helper did not start: ${e.message}`, 'Nodes');
      done();
    });
    child.on('close', done);
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify({
      magic: p2p.magic, version: q.version, targets: targets.map(t => [t.ip, t.port]),
      concurrency: CONCURRENCY, timeout: timeout / 1000,
    }));
  });
}

/** the addresses of the eCash crawl (the eCash explorer's /chain/nodes), at this network's port: a LayerTwo network's
 * nodes tell of no others @asyncSafe */
async function $mainchainAddresses(port: number): Promise<{ ip: string; port: number }[]> {
  if (!config.CHAIN.MAINCHAIN_API) {
    return [];
  }
  try {
    const res = await axios.get(config.CHAIN.MAINCHAIN_API.replace(/\/+$/, '') + '/api/v1/chain/nodes',
      { timeout: 15_000, maxContentLength: 20_000_000, validateStatus: () => true });
    const list: any[] = res.status === 200 && Array.isArray(res.data?.nodes) ? res.data.nodes : [];
    return list.filter(n => typeof n?.ip === 'string' && net.isIP(n.ip)).slice(0, MAX_TRIES).map(n => ({ ip: n.ip as string, port }));
  } catch {
    return [];
  }
}

/** @asyncSafe */
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// --- the crawl ------------------------------------------------------------------------------------------------------

/** "ip:port" or "[ip]:port" */
function peerAddresses(peers: string[]): { ip: string; port: number }[] {
  return peers.map(p => /^\[?([^\]]+?)\]?:(\d+)$/.exec(p)).filter((m): m is RegExpExecArray => !!m && net.isIP(m[1]) !== 0)
    .map(m => ({ ip: m[1], port: Number(m[2]) }));
}

/** the reverse DNS of these addresses, where not looked up in the last RDNS_TTL (a PTR record's first name) @asyncSafe */
async function $resolveNames(ips: string[], now: number): Promise<void> {
  const resolver = new dns.promises.Resolver({ timeout: RDNS_TIMEOUT, tries: 1 });
  const todo = [...new Set(ips)].filter(ip => now - (rdns.get(ip)?.at ?? 0) > RDNS_TTL);
  const worker = async (): Promise<void> => {
    for (let ip = todo.shift(); ip; ip = todo.shift()) {
      let name: string | null = null;
      try {
        const n = (await resolver.reverse(ip))[0];
        // a hostname's characters only (a PTR record is anyone's to write), 253 at most
        name = typeof n === 'string' && /^[a-z0-9._-]{1,253}$/i.test(n) ? n.replace(/\.$/, '').toLowerCase() : null;
      } catch { /* no PTR record, or no answer in time */ }
      rdns.delete(ip);
      rdns.set(ip, { name, at: now });
    }
  };
  await Promise.allSettled(Array.from({ length: 16 }, worker));
  while (rdns.size > MAX_RDNS) {
    rdns.delete(rdns.keys().next().value as string);
  }
}

/** @asyncSafe */
async function seedAddresses(seeds: string[], port: number): Promise<{ ip: string; port: number }[]> {
  const out: { ip: string; port: number }[] = [];
  await Promise.allSettled(seeds.map(/** @asyncSafe */ async (s) => {
    for (const lookup of [dns.promises.resolve4, dns.promises.resolve6]) {
      try {
        for (const ip of await lookup(s)) {
          out.push({ ip, port });
        }
      } catch { /* a seed without records of that family */ }
    }
  }));
  return out;
}

/** @asyncSafe */
async function $crawl(): Promise<void> {
  const p2p = p2pParams();
  crawlPending = true;
  for (let i = 0; checking && i < 180; i++) {
    await sleep(500); // a check winds down first (its handshakes in flight: CHECK_SESSION)
  }
  crawlPending = false;
  if (checking) {
    logger.warn('Nodes crawler: a check is still running, this crawl is skipped', 'Nodes');
  }
  if (!p2p || crawling || checking) {
    return;
  }
  crawling = true;
  const t0 = Date.now();
  const now = Math.floor(t0 / 1000);
  const magic = Buffer.from(p2p.magic, 'hex');
  try {
    const startTip = await $startTip();
    const queue: { ip: string; port: number }[] = [
      ...await seedAddresses(p2p.seeds, p2p.port), ...peerAddresses(p2p.peers ?? []),
      ...[...nodes.values()].map(n => ({ ip: n.ip, port: n.port })),
      ...(p2p.quic ? await $mainchainAddresses(p2p.port) : []),
    ];
    const heard = new Set<string>();
    const perIp = new Map<string, number>();
    const perSubnet = new Map<string, number>();
    const reached = new Map<string, Probe['version']>();
    let tried = 0;
    const next = (): { ip: string; port: number } | null => {
      while (queue.length) {
        const a = queue.shift()!;
        const key = addressOf(a.ip, a.port);
        if (heard.has(key) || a.port < MIN_PORT || !isPublic(a.ip)) {
          continue;
        }
        const net_ = subnetOf(a.ip);
        if ((perIp.get(a.ip) ?? 0) >= PER_IP || (perSubnet.get(net_) ?? 0) >= PER_SUBNET) {
          continue;
        }
        heard.add(key);
        perIp.set(a.ip, (perIp.get(a.ip) ?? 0) + 1);
        perSubnet.set(net_, (perSubnet.get(net_) ?? 0) + 1);
        return a;
      }
      return null;
    };
    const record = (a: { ip: string; port: number }, version: Probe['version']): void => {
      const key = addressOf(a.ip, a.port);
      const n = nodes.get(key);
      if (version) {
        reached.set(key, version);
        nodes.set(key, {
          address: key, ip: a.ip, port: a.port, userAgent: version.userAgent, protocol: version.protocol,
          services: version.services, height: version.height, latency: version.latency,
          firstSeen: n?.firstSeen ?? now, lastSeen: now, lastTried: now, recent: ((n?.recent ?? '') + '1').slice(-RECENT),
          checked: now, tip: null,
        });
      } else if (n) {
        n.lastTried = now;
        n.recent = (n.recent + '0').slice(-RECENT);
      }
    };
    const worker = async () => {
      // (a worker waits while others may still add addresses: up to 30 s, longer than a session)
      for (let idle = 0; idle < 60 && tried < MAX_TRIES;) {
        const a = next();
        if (!a) {
          idle++;
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        idle = 0;
        tried++;
        const r = await probe(a.ip, a.port, magic);
        record(a, r.version);
        if (r.version) {
          queue.push(...r.addrs.slice(0, Math.max(0, MAX_QUEUE - queue.length)));
        }
      }
    };
    if (p2p.quic) {
      // every address at once (none turns up during the pass)
      const targets: { ip: string; port: number }[] = [];
      for (let a = next(); a && targets.length < MAX_TRIES; a = next()) {
        targets.push(a);
      }
      tried = targets.length;
      const got = await quicProbe(p2p, targets);
      targets.forEach(a => record(a, got.get(addressOf(a.ip, a.port)) ?? null));
    } else {
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    }
    const passTip = passTipOf(startTip, [...reached.values()].map(v => v?.height ?? 0));
    for (const k of reached.keys()) {
      nodes.get(k)!.tip = passTip;
    }
    lastCheck = now;
    for (const [k, n] of nodes) {
      if (now - n.lastSeen > FORGET_UNREACHABLE) {
        nodes.delete(k);
      }
    }
    if (nodes.size > MAX_NODES) {
      for (const n of [...nodes.values()].sort((a, b) => a.lastSeen - b.lastSeen).slice(0, nodes.size - MAX_NODES)) {
        nodes.delete(n.address);
      }
    }
    const counts = new Map<string, number>();
    for (const v of reached.values()) {
      counts.set(v?.userAgent ?? '', (counts.get(v?.userAgent ?? '') ?? 0) + 1);
    }
    const versions: Record<string, number> = Object.create(null);
    [...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([ua, c], i) => {
      const k = i < MAX_VERSIONS ? ua : 'other';
      versions[k] = (versions[k] ?? 0) + c;
    });
    const atTip = passTip === null ? null : [...reached.values()].filter(v => (v?.height ?? 0) >= passTip - 2).length;
    const snap: CrawlSnapshot = { time: now, duration: Math.round((Date.now() - t0) / 1000), tried, reachable: reached.size, known: heard.size, atTip, versions };
    crawls.push(snap);
    while (crawls.length && crawls[0].time < now - 90 * 86400) {
      crawls.shift();
    }
    logger.info(`Nodes crawler: ${reached.size} reachable of ${tried} addresses tried in ${snap.duration}s`, 'Nodes');
    await $save(snap);
    await $resolveNames([...reached.keys()].map(k => nodes.get(k)?.ip).filter((ip): ip is string => !!ip), now);
  } catch (e) {
    logger.err(`Nodes crawler failed: ${e instanceof Error ? e.message : e}`, 'Nodes');
  } finally {
    crawling = false;
  }
}

/**
 * The explorer's node's height, read as a pass starts (a node reached later in the pass, on a chain of 15 s blocks
 * such as Flush's, is at least there: one read after the pass would count it behind); null if it does not answer
 * @asyncSafe
 */
async function $startTip(): Promise<number | null> {
  try {
    const t = await ourTip();
    return t !== null && t >= 0 ? t : null; // (0: a chain with no block past its genesis yet, FreeBank's)
  } catch {
    return null;
  }
}

/** the tip of a pass: its start's (the node's), else the highest height at least TIP_QUORUM of its nodes report */
function passTipOf(start: number | null, heights: number[]): number | null {
  if (start !== null) {
    return start;
  }
  const h = heights.filter(x => x > 0).sort((a, b) => b - a);
  return h.length >= TIP_QUORUM ? h[TIP_QUORUM - 1] : null;
}

/** between crawls: the heights of the nodes reachable in the last crawl, again (a handshake each) @asyncSafe */
async function $check(): Promise<void> {
  const p2p = p2pParams();
  const last = crawls[crawls.length - 1];
  if (!p2p || crawling || checking || !last) {
    return;
  }
  checking = true;
  const now = Math.floor(Date.now() / 1000);
  const magic = Buffer.from(p2p.magic, 'hex');
  try {
    const startTip = await $startTip();
    const todo = [...nodes.values()].filter(n => n.lastSeen >= last.time);
    let got = new Map<string, NonNullable<Probe['version']>>();
    const deadline = Date.now() + CHECK_DEADLINE;
    const worker = async (): Promise<void> => {
      for (let n = todo.shift(); n && !crawlPending && Date.now() < deadline; n = todo.shift()) {
        const r = await probe(n.ip, n.port, magic, false, CHECK_SESSION);
        if (r.version) {
          got.set(n.address, r.version);
        }
      }
    };
    if (p2p.quic) {
      got = await quicProbe(p2p, todo.splice(0), CHECK_SESSION);
    } else {
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    }
    const passTip = passTipOf(startTip, [...got.values()].map(v => v.height));
    for (const [k, v] of got) {
      const n = nodes.get(k);
      if (n) {
        Object.assign(n, { userAgent: v.userAgent, protocol: v.protocol, services: v.services, height: v.height, latency: v.latency, checked: now, tip: passTip });
      }
    }
    lastCheck = now;
    await $saveNodes();
  } catch (e) {
    logger.err(`Nodes check failed: ${e instanceof Error ? e.message : e}`, 'Nodes');
  } finally {
    checking = false;
  }
}

// --- persistence ----------------------------------------------------------------------------------------------------

const db = () => config.DATABASE.ENABLED;

/** @asyncUnsafe */
async function $ensureTables(): Promise<void> {
  await DB.query(`CREATE TABLE IF NOT EXISTS chain_nodes (
    address varchar(64) NOT NULL PRIMARY KEY, ip varchar(45) NOT NULL, port int unsigned NOT NULL, user_agent varchar(256) NULL,
    protocol int NULL, services varchar(24) NULL, height int NULL, latency int NULL, first_seen int unsigned NOT NULL,
    last_seen int unsigned NOT NULL, last_tried int unsigned NOT NULL, recent varchar(${RECENT}) NOT NULL DEFAULT ''
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await DB.query(`ALTER TABLE chain_nodes ADD COLUMN IF NOT EXISTS checked int unsigned NULL, ADD COLUMN IF NOT EXISTS tip int NULL,
    MODIFY recent varchar(${RECENT}) NOT NULL DEFAULT ''`);
  await DB.query(`CREATE TABLE IF NOT EXISTS chain_nodes_crawls (
    time int unsigned NOT NULL PRIMARY KEY, duration int unsigned NOT NULL, tried int unsigned NOT NULL,
    reachable int unsigned NOT NULL, known int unsigned NOT NULL, versions json NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await DB.query('ALTER TABLE chain_nodes_crawls ADD COLUMN IF NOT EXISTS at_tip int unsigned NULL');
}

/** @asyncUnsafe */
async function $load(): Promise<void> {
  if (!db()) {
    return;
  }
  await $ensureTables();
  const [rows]: any = await DB.query('SELECT * FROM chain_nodes');
  for (const r of rows) {
    nodes.set(r.address, {
      address: r.address, ip: r.ip, port: r.port, userAgent: r.user_agent, protocol: r.protocol, services: r.services,
      height: r.height, latency: r.latency, firstSeen: r.first_seen, lastSeen: r.last_seen, lastTried: r.last_tried, recent: r.recent,
      checked: r.checked ?? null, tip: r.tip ?? null,
    });
  }
  const [snaps]: any = await DB.query('SELECT * FROM chain_nodes_crawls WHERE time >= UNIX_TIMESTAMP() - 90 * 86400 ORDER BY time');
  for (const s of snaps) {
    crawls.push({ time: s.time, duration: s.duration, tried: s.tried, reachable: s.reachable, known: s.known, atTip: s.at_tip ?? null,
      versions: typeof s.versions === 'string' ? JSON.parse(s.versions) : s.versions });
  }
  lastCheck = Math.max(0, ...[...nodes.values()].map(n => n.checked ?? 0)) || null;
  logger.info(`Nodes crawler: ${nodes.size} known nodes, ${crawls.length} crawls loaded`, 'Nodes');
}

/** @asyncUnsafe */
async function $save(snap: CrawlSnapshot): Promise<void> {
  if (!db()) {
    return;
  }
  await DB.query('DELETE FROM chain_nodes WHERE last_seen < ?', [snap.time - FORGET_UNREACHABLE]);
  await $saveNodes();
  await DB.query('INSERT INTO chain_nodes_crawls (time, duration, tried, reachable, known, at_tip, versions) VALUES (?,?,?,?,?,?,?)',
    [snap.time, snap.duration, snap.tried, snap.reachable, snap.known, snap.atTip, JSON.stringify(snap.versions)]);
  await DB.query('DELETE FROM chain_nodes_crawls WHERE time < ?', [snap.time - 90 * 86400]);
}

/** @asyncUnsafe */
async function $saveNodes(): Promise<void> {
  if (!db()) {
    return;
  }
  const all = [...nodes.values()];
  for (let i = 0; i < all.length; i += 200) {
    const part = all.slice(i, i + 200);
    await DB.query(
      `INSERT INTO chain_nodes (address, ip, port, user_agent, protocol, services, height, latency, first_seen, last_seen, last_tried, recent, checked, tip)
       VALUES ${part.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}
       ON DUPLICATE KEY UPDATE user_agent = VALUES(user_agent), protocol = VALUES(protocol), services = VALUES(services),
         height = VALUES(height), latency = VALUES(latency), last_seen = VALUES(last_seen), last_tried = VALUES(last_tried), recent = VALUES(recent),
         checked = VALUES(checked), tip = VALUES(tip)`,
      part.flatMap(n => [n.address, n.ip, n.port, n.userAgent, n.protocol, n.services, n.height, n.latency, n.firstSeen, n.lastSeen, n.lastTried, n.recent, n.checked, n.tip]));
  }
}

// --- the schedule ---------------------------------------------------------------------------------------------------

/** start crawling this network, if it has a P2P network to crawl; `tip`: the explorer's node's height */
export function startCrawler(tip: () => Promise<number | null>): void {
  if (started || !p2pParams()) {
    return;
  }
  started = true;
  ourTip = tip;
  void (/** @asyncSafe */ async () => {
    try {
      await $load();
    } catch (e) {
      logger.warn(`Nodes crawler: could not load the known nodes: ${e instanceof Error ? e.message : e}`, 'Nodes');
    }
    /** @asyncSafe */
    const at = (ms: number): number => Math.round((Date.now() + ms) / 1000);
    const run = async (): Promise<void> => {
      nextCrawlAt = null; // (crawling)
      await $crawl();
      setTimeout(run, CRAWL_EVERY);
      nextCrawlAt = at(CRAWL_EVERY);
    };
    setTimeout(run, FIRST_CRAWL);
    nextCrawlAt = at(FIRST_CRAWL);
    setInterval(() => {
      nextCheckAt = at(CHECK_EVERY);
      void $check(); // (skipped while a crawl runs)
    }, CHECK_EVERY);
    nextCheckAt = at(CHECK_EVERY);
  })();
}
