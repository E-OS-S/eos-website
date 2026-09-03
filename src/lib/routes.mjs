/**
 * The route table. One list, used by the navigation, the footer, the locale
 * switcher and the sitemap, so a page cannot exist in one of them and not the
 * others.
 *
 * `key` is also the i18n key stem: nav.<key> is the link label and
 * page.<key>.title / page.<key>.description are the document metadata.
 */
export const ROUTES = [
  { key: 'home',             path: '',                   nav: true,  footer: 'project' },
  { key: 'products',         path: 'products',           nav: true,  footer: 'project' },
  { key: 'downloads',        path: 'downloads',          nav: true,  footer: 'project' },
  { key: 'developers',       path: 'developers',         nav: true,  footer: 'project' },
  { key: 'changelog',        path: 'changelog',          nav: true,  footer: 'project' },
  { key: 'support',          path: 'support',            nav: true,  footer: 'help' },
  { key: 'security',         path: 'privacy-and-security', nav: true, footer: 'help' },
  { key: 'about',            path: 'about',              nav: true,  footer: 'project' },
  { key: 'accessibility',    path: 'accessibility',      nav: false, footer: 'help' },
  { key: 'legalPrivacy',     path: 'legal/privacy',      nav: false, footer: 'legal' },
  { key: 'legalTerms',       path: 'legal/terms',        nav: false, footer: 'legal' },
  { key: 'legalTrademarks',  path: 'legal/trademarks',   nav: false, footer: 'legal' },
  { key: 'legalAboutEos',    path: 'legal/about-eos',    nav: false, footer: 'legal' },
];

export const FOOTER_GROUPS = ['project', 'help', 'legal'];

export function routeByPath(path) {
  const clean = String(path ?? '').replace(/^\/+|\/+$/g, '');
  return ROUTES.find((r) => r.path === clean);
}
