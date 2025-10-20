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
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
  },
});
