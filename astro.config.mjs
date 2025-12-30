// @ts-check

import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

import icon from "astro-icon";

// https://astro.build/config
export default defineConfig({
  site: "https://thabnir.github.io",
  integrations: [mdx(), sitemap(), icon()],
  markdown: {
    // Use Prism so code blocks render with token classes instead of Shiki inline styles.
    // This allows our Swiss-style light/dark theming to apply via CSS.
    syntaxHighlight: "prism",
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
  },
});
