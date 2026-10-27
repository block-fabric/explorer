/**
 * A mining pool's logo, as /blocks shows it: the eCash pool list's file (/resources/pool-logos/, the backend's `logo`),
 * else upstream's by the pool's slug (/resources/mining-pools/<slug>.svg: the build downloads mempool's logos, Bitcoin's
 * pools on mainnet's and betanet's history), else the default one
 */
export const DEFAULT_POOL_LOGO = '/resources/mining-pools/default.svg';

export function poolLogoUrl(logo: string | null | undefined, name: string | null | undefined): string {
  if (logo) {
    return `/resources/pool-logos/${logo}`;
  }
  // upstream's slug of a pool name (pools-parser.ts)
  const slug = (name ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return slug ? `/resources/mining-pools/${slug}.svg` : DEFAULT_POOL_LOGO;
}

/** An <img>'s error handler: the default logo, once */
export function poolLogoFallback(event: Event): void {
  const img = event.target as HTMLImageElement;
  if (img.src.endsWith(DEFAULT_POOL_LOGO)) {
    img.style.display = 'none';
  } else {
    img.src = DEFAULT_POOL_LOGO;
  }
}
