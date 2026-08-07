import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface GeoLookup {
  country: string | null;
  city: string | null;
  asn: string | null;
  lat: number | null;
  lon: number | null;
}

const NULL_LOOKUP: GeoLookup = { country: null, city: null, asn: null, lat: null, lon: null };

let readerPromise: Promise<any> | null = null;
let warnedMissing = false;

/**
 * Lazily opens the local MaxMind GeoLite2-City mmdb configured via GEOIP_DB_PATH. Fully
 * optional — an unset path (or a missing/unreadable file) degrades every geo-derived risk
 * signal to "unknown" rather than failing the login path. Never calls out to the network:
 * the risk engine must keep working with no internet egress.
 */
async function getReader(): Promise<any | null> {
  if (!config.GEOIP_DB_PATH) return null;
  if (!readerPromise) {
    readerPromise = (async () => {
      try {
        const { Reader } = await import('@maxmind/geoip2-node');
        return await Reader.open(config.GEOIP_DB_PATH as string);
      } catch (err: any) {
        if (!warnedMissing) {
          logger.warn(`GeoIP database unavailable (${err.message}) — geo risk signals disabled`);
          warnedMissing = true;
        }
        return null;
      }
    })();
  }
  return readerPromise;
}

export async function lookupGeo(ip: string): Promise<GeoLookup> {
  if (!ip || ip === 'unknown' || ip === '127.0.0.1' || ip === '::1') return NULL_LOOKUP;
  const reader = await getReader();
  if (!reader) return NULL_LOOKUP;

  try {
    const result = reader.city(ip);
    return {
      country: result.country?.isoCode ?? null,
      city: result.city?.names?.en ?? null,
      asn: null, // GeoLite2-City has no ASN field; a separate GeoLite2-ASN db would be needed
      lat: result.location?.latitude ?? null,
      lon: result.location?.longitude ?? null,
    };
  } catch {
    // Unroutable/private/reserved ranges throw AddressNotFoundError — not an error condition.
    return NULL_LOOKUP;
  }
}

/** Haversine distance in km, used for the impossible-travel signal. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function resetGeoIpReaderForTests(): void {
  readerPromise = null;
  warnedMissing = false;
}
