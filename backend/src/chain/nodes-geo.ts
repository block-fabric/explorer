import maxmind, { AsnResponse, CityResponse, Reader } from 'maxmind';
import logger from '../logger';

/**
 * Where a node's address is (/nodes, its map), and whose network it is in (its AS: who hosts it): DB-IP's IP to City
 * Lite and IP to ASN Lite (CC BY 4.0, https://db-ip.com), put in the backend image (docker/backend/Dockerfile). A city's precision at best, and an address's, not the machine's (a VPN's
 * exit shows where the VPN is).
 */

export interface NodeGeo { lat: number; lon: number; city: string | null; country: string | null; cc: string | null }
export interface NodeAsn { number: number; org: string }

const DB = process.env.NODES_GEO_DB ?? '/usr/local/share/dbip-city-lite.mmdb';
const ASN_DB = process.env.NODES_ASN_DB ?? '/usr/local/share/dbip-asn-lite.mmdb';
let reader: Reader<CityResponse> | null = null;
let asnReader: Reader<AsnResponse> | null = null;
let opening: Promise<void> | null = null;
let missing = false;

/** open the database once (none: no locations) @asyncSafe */
export async function $openGeo(): Promise<void> {
  if (reader || missing) {
    return;
  }
  opening ??= Promise.all([
    maxmind.open<CityResponse>(DB).then((r) => { reader = r; }),
    maxmind.open<AsnResponse>(ASN_DB).then((r) => { asnReader = r; }).catch(() => undefined), // (no ASNs: still the places)
  ]).then(() => undefined);
  try {
    await opening;
  } catch (e) {
    missing = true;
    logger.warn(`Nodes map: no IP location database (${DB}): ${e instanceof Error ? e.message : e}`, 'Nodes');
  }
}

/** an address's location, if the database has one */
export function geoOf(ip: string): NodeGeo | null {
  if (!reader) {
    return null;
  }
  try {
    const r = reader.get(ip);
    const lat = r?.location?.latitude;
    const lon = r?.location?.longitude;
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return null;
    }
    return {
      lat, lon, city: r?.city?.names?.en ?? null, country: r?.country?.names?.en ?? null, cc: r?.country?.iso_code ?? null,
    };
  } catch {
    return null;
  }
}

/** the AS an address is in: its number and its holder's name (who hosts the node), if the database has it */
export function asnOf(ip: string): NodeAsn | null {
  try {
    const r = asnReader?.get(ip);
    const n = r?.autonomous_system_number;
    return typeof n === 'number' ? { number: n, org: String(r?.autonomous_system_organization ?? '').slice(0, 80) } : null;
  } catch {
    return null;
  }
}
