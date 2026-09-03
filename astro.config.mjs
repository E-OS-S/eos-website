// @ts-check
import { defineConfig } from 'astro/config';
import { locales, defaultLocale, site, base } from './site.config.mjs';

// Static output only: GitLab Pages serves files, it runs nothing.
export default defineConfig({
  site,
  base,
  output: 'static',
  // GitLab Pages publishes `public/`, so Astro writes there directly and the
  // pipeline needs no move step that could silently produce an empty
  // directory. Hand-written static assets live in `static/` instead, because
  // Astro's default publicDir would otherwise collide with the output.
  outDir: './public',
  publicDir: './static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  i18n: {
    locales,
    defaultLocale,
    routing: {
      // The default locale is prefixed too, so that /pl/ and /en/ are
      // symmetrical and no locale is "the special one" in the URL space.
      prefixDefaultLocale: true,
    },
  },
  devToolbar: { enabled: false },
});
