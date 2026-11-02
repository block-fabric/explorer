import maxmind, { CityResponse, Reader } from 'maxmind';
import logger from '../logger';

/**
 * Where a node's address is (/nodes, its map): DB-IP's IP to City Lite (CC BY 4.0, https://db-ip.com), put in the
 * backend image (docker/backend/Dockerfile). A city's precision at best, and an address's, not the machine's (a VPN's
 * exit shows where the VPN is).
 */

export interface NodeGeo { lat: number; lon: number; city: string | null; country: string | null; cc: string | null }

const DB = process.env.NODES_GEO_DB ?? '/usr/local/share/dbip-city-lite.mmdb';
let reader: Reader<CityResponse> | null = null;
let opening: Promise<void> | null = null;
let missing = false;

/** open the database once (none: no locations) @asyncSafe */
export async function $openGeo(): Promise<void> {
  if (reader || missing) {
    return;
  }
  opening ??= maxmind.open<CityResponse>(DB).then((r) => { reader = r; });
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
