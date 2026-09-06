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
  const cities = (json.data as string[]).sort((a, b) => a.localeCompare(b));
  citiesCache.set(country, cities);
  return cities;
}
