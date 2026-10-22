// What Minerr shows on a page. The subtitles over a video show on every site; the page text only on a site that the user
// turned on, and on the pages of Minerr.
import { isStringList } from '../shared/guards.ts';
import { minerrEnabled, setting } from '../shared/settings.ts';

// 'off': Minerr is off. 'video': only the subtitles over a video and their line list. 'on': the page text too.
export type Active = 'off' | 'video' | 'on';

// The subtitle overlay (src/video/overlay.ts) and the subtitle sidebar (src/video/sidebar/sidebar.ts, in the side panel page). Their words show while Minerr is on.
export const VIDEO = '.minerr-subs, .minerr-lines';

// The sites where Minerr reads the page text. The old disabledSites key (off on a list of sites) is not read.
export const enabledSites = setting('enabledSites', isStringList, []);

export const isMinerrPage = (url: Pick<Location, 'protocol'>) => url.protocol === 'chrome-extension:';

// A site is a hostname without www.; it covers its subdomains, so youtube.com covers www.youtube.com and m.youtube.com.
export const siteOf = (host: string): string => host.replace(/^www\./, '');
const covers = (site: string, host: string) => host === site || host.endsWith(`.${site}`);
export const siteIsOn = (sites: string[], host: string): boolean => sites.some(site => covers(site, host));

export const activeOf = (enabled: boolean, sites: string[], url: Pick<Location, 'protocol' | 'hostname'>): Active =>
  (!enabled ? 'off' : isMinerrPage(url) || siteIsOn(sites, url.hostname) ? 'on' : 'video');

export const toggleSite = (sites: string[], host: string): string[] =>
  (siteIsOn(sites, host) ? sites.filter(site => !covers(site, host)) : [...sites, siteOf(host)]);

// Turns the page text on for the site of host, or off again. Returns true if the page text is now on for host.
export async function toggleSiteOf(host: string): Promise<boolean> {
  const sites = toggleSite(await enabledSites.get(), host);
  await enabledSites.set(sites);
  return siteIsOn(sites, host);
}

const listeners = new Set<(active: Active) => void>();
let active: Active | null = null;

// One read and one pair of storage listeners for all the modules of a page.
async function start(): Promise<void> {
  let [enabled, sites] = await Promise.all([minerrEnabled.get(), enabledSites.get()]);
  const update = () => {
    const next = activeOf(enabled, sites, location);
    if (next === active) return;
    active = next;
    for (const listener of listeners) listener(active);
  };
  update();
  minerrEnabled.onChange(value => { enabled = value; update(); });
  enabledSites.onChange(value => { sites = value; update(); });
}

// Calls listener with what Minerr shows on this page, and again on each change.
export function watchActive(listener: (active: Active) => void): void {
  if (!listeners.size) start();
  listeners.add(listener);
  if (active !== null) listener(active);
}
