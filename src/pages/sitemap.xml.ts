/**
 * Sitemap, generated from the same route table the navigation uses.
 *
 * Written by hand rather than pulled in as an integration: the list of pages
 * has exactly one home (src/lib/routes.mjs), and a second list that could drift
 * from it is the failure this project keeps writing gates against.
 */
import type { APIRoute } from 'astro';
import { ROUTES } from '../lib/routes.mjs';
import { LOCALES, LOCALE_TAGS, localePath, type Locale } from '../i18n';

export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const urls: string[] = [];

  for (const route of ROUTES) {
    for (const lang of LOCALES as Locale[]) {
      const loc = new URL(`${base}${localePath(lang, route.path)}`, site).href;
      const alternates = (LOCALES as Locale[])
        .map((other) => {
          const href = new URL(`${base}${localePath(other, route.path)}`, site).href;
          return `    <xhtml:link rel="alternate" hreflang="${LOCALE_TAGS[other]}" href="${href}"/>`;
        })
        .join('\n');
      urls.push(`  <url>\n    <loc>${loc}</loc>\n${alternates}\n  </url>`);
    }
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
