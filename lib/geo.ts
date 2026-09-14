// Country/city lookups for onboarding (see app/(app)/onboarding-location.tsx)
// and for the leaderboard's City/Country tabs.
//
// Countries still come from countriesnow.space (free, no-key) — that list
// is short and already correct. Cities are bundled locally instead
// (assets/data/cities-by-country.json, built from GeoNames' cities15000
// dump: https://download.geonames.org/export/dump/, CC BY 4.0), keyed by
// ISO 3166-1 alpha-2 country code and pre-filtered to populated places with
// population >= 15,000. countriesnow.space's own city lists come straight
// from a raw admin-division dataset — every village, hamlet and city
// district included — which is exactly what made a search like "a" (Italy)
// return hundreds of thousands of essentially random matches instead of
// real cities. GeoNames' population cutoff fixes that at the source, and
// bundling it means city lookups are instant and work offline, instead of
// a second network round-trip after picking a country.
import citiesByCountry from '@/assets/data/cities-by-country.json';

let countriesCache: string[] | null = null;
const iso2ByCountryName = new Map<string, string>();

export async function fetchCountries(): Promise<string[]> {
  if (countriesCache) return countriesCache;
  const res = await fetch('https://countriesnow.space/api/v0.1/countries/iso');
  if (!res.ok) throw new Error('Could not load the country list.');
  const json = await res.json();
  if (json.error) throw new Error('Could not load the country list.');
  const rows = json.data as { name: string; Iso2: string }[];
  for (const row of rows) iso2ByCountryName.set(row.name, row.Iso2);
  const names = rows.map((c) => c.name).sort((a, b) => a.localeCompare(b));
  countriesCache = names;
  return names;
}

export async function fetchCitiesForCountry(country: string): Promise<string[]> {
  // iso2ByCountryName is populated as a side effect of fetchCountries(),
  // which every caller of this function has already awaited (the country
  // has to come from that list to be passed in here) — this call is just a
  // cheap safety net against a caller that somehow skips that step, since
  // fetchCountries() itself caches after the first real fetch.
  if (iso2ByCountryName.size === 0) await fetchCountries();
  const iso2 = iso2ByCountryName.get(country);
  if (!iso2) return [];
  return (citiesByCountry as Record<string, string[]>)[iso2] ?? [];
}
