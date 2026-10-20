// Minerr on or off for one site. A page shows Minerr only when Minerr is on and its site is not in disabledSites.
import { isStringList } from './parse.ts';
import { minerrEnabled, setting } from './settings.ts';

// The hostnames where Minerr is off.
export const disabledSites = setting('disabledSites', isStringList, []);

export const toggleSite = (sites: string[], host: string): string[] =>
  (sites.includes(host) ? sites.filter(site => site !== host) : [...sites, host]);

// Turns Minerr off for host, or on again. Returns true if Minerr is now on for host.
export async function toggleSiteOf(host: string): Promise<boolean> {
  const sites = toggleSite(await disabledSites.get(), host);
  await disabledSites.set(sites);
  return !sites.includes(host);
}

// Calls listener with true when Minerr shows on this page, and again on each change.
export async function watchActive(listener: (active: boolean) => void): Promise<void> {
  let [enabled, sites] = await Promise.all([minerrEnabled.get(), disabledSites.get()]);
  const update = () => listener(enabled && !sites.includes(location.hostname));
  update();
  minerrEnabled.onChange(value => { enabled = value; update(); });
  disabledSites.onChange(value => { sites = value; update(); });
}
