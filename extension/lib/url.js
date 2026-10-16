// One clip per page: URLs that differ only by www., trailing slash, #hash or tracking params are the same page.
const TRACKING = /^(utm_\w+|ref|ref_src|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|_hsenc|_hsmi|mkt_tok|yclid|s_cid)$/i;

export function normUrl(u) {
  try {
    const x = new URL(u);
    const host = x.hostname.toLowerCase().replace(/^www\./, '');
    const params = [...x.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const q = params.length ? '?' + new URLSearchParams(params).toString() : '';
    let path = x.pathname.replace(/\/+$/, '') || '/';
    if (/\/index\.html?$/i.test(path)) path = path.replace(/\/index\.html?$/i, '') || '/';
    return `${host}${x.port ? ':' + x.port : ''}${path}${q}`;
  } catch {
    return String(u || '');
  }
}

export const findClip = (queue, url) => {
  const key = normUrl(url);
  return queue.find((j) => normUrl(j.url) === key);
};

// what gets stored: the page's own URL without #hash or tracking params
export function cleanUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) if (TRACKING.test(k)) x.searchParams.delete(k);
    return x.toString();
  } catch {
    return u;
  }
}
