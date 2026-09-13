// Country/city lookups for onboarding (see app/(app)/onboarding-location.tsx)
// and for the leaderboard's City/Country tabs. Backed by countriesnow.space
// — a free, no-key REST API — rather than bundling a multi-megabyte
// countries+cities dataset into the app. Trade-off: onboarding needs a
// network connection and depends on a third-party service's uptime. If that
// becomes a problem, swap this file for a bundled dataset (e.g. the
// `country-state-city` npm package) without touching any callers.

let countriesCache: string[] | null = null;
const citiesCache = new Map<string, string[]>();

export async function fetchCountries(): Promise<string[]> {
  if (countriesCache) return countriesCache;
  const res = await fetch('https://countriesnow.space/api/v0.1/countries/iso');
  if (!res.ok) throw new Error('Could not load the country list.');
  const json = await res.json();
  if (json.error) throw new Error('Could not load the country list.');
  const names = (json.data as { name: string }[]).map((c) => c.name).sort((a, b) => a.localeCompare(b));
  countriesCache = names;
  return names;
}

// countriesnow.space's city lists come straight from a geographic admin-
// division dataset, not a "notable cities" list — some countries' data
// includes sub-municipality administrative units alongside the real city
// (e.g. Slovenia lists "Ljubljana" itself *and* several of its internal
// districts as separate "cities": "Opčina Ljubljana-Bežigrad", "Opčina
// Ljubljana-Šiška", ...). There's no population field to filter by "the
// biggest cities" — that would need a different, much larger dataset — so
// this strips the specific administrative-unit prefixes known to leak into
// results like that, and drops exact-duplicate names. Combined with
// SearchableSelect's prefix-only matching (see components/ui.tsx), typing
// a real city name like "Ljubljana" now surfaces exactly that one city.
const ADMIN_UNIT_PREFIXES = ['Opčina ', 'Občina ', 'Opština '];

export async function fetchCitiesForCountry(country: string): Promise<string[]> {
  const cached = citiesCache.get(country);
  if (cached) return cached;
  const res = await fetch('https://countriesnow.space/api/v0.1/countries/cities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ country }),
  });
  if (!res.ok) throw new Error('Could not load cities for that country.');
  const json = await res.json();
  if (json.error) throw new Error('Could not load cities for that country.');

  const seen = new Set<string>();
  const cities: string[] = [];
  for (const raw of (json.data as string[]).sort((a, b) => a.localeCompare(b))) {
    if (ADMIN_UNIT_PREFIXES.some((prefix) => raw.startsWith(prefix))) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cities.push(raw);
  }

  citiesCache.set(country, cities);
  return cities;
}
