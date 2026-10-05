import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";
import { REPO_URL } from "./theme/site";

/** Where Pages serves this site; `base` below is its path. */
const DOCS_URL = "https://mrkuros.github.io/isitme";

const DESCRIPTION =
  "Ask whether a site is down, and get told whether it's the site, one region, its provider, the wider internet — or your own connection.";

export default withMermaid(
  defineConfig({
    title: "IsItMe",
    description: DESCRIPTION,
    // GitHub Pages serves the site from /isitme/.
    base: "/isitme/",
    lang: "en-US",
    cleanUrls: false,
    // `true` means the toggle starts on whatever the OS prefers.
    appearance: true,
    head: [
      ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
      [
        "link",
        {
          rel: "preconnect",
          href: "https://fonts.gstatic.com",
          crossorigin: ""
        }
      ],
      [
        "link",
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap"
        }
      ],
      ["link", { rel: "icon", href: "/isitme/favicon.ico" }],
      ["meta", { name: "theme-color", content: "#f6821f" }],
      [
        "meta",
        { property: "og:title", content: "IsItMe — is it down, or is it me?" }
      ],
      ["meta", { property: "og:description", content: DESCRIPTION }],
      ["meta", { property: "og:url", content: `${DOCS_URL}/` }],
      ["meta", { property: "og:image", content: `${DOCS_URL}/og.png` }],
      ["meta", { name: "twitter:card", content: "summary_large_image" }]
    ],
    themeConfig: {
      siteTitle: "IsItMe",
      search: { provider: "local" },
      nav: [
        { text: "Quick start", link: "/quick-start" },
        { text: "Verdicts", link: "/results" },
        { text: "HTTP API", link: "/api" },
        { text: "How it works", link: "/how-it-works" }
      ],
      sidebar: [
        {
          text: "Using IsItMe",
          items: [
            { text: "Quick start", link: "/quick-start" },
            { text: "Using the chat", link: "/chat" },
            { text: "Understanding results", link: "/results" },
            { text: "Watching and alerts", link: "/watching" },
            { text: "Sharing", link: "/sharing" }
          ]
        },
        {
          text: "For developers",
          items: [
            { text: "CLI", link: "/cli" },
            { text: "HTTP API", link: "/api" },
            { text: "MCP", link: "/mcp" }
          ]
        },
        {
          text: "Running your own",
          items: [
            { text: "Self-hosting", link: "/self-hosting" },
            { text: "Contributing", link: "/contributing" }
          ]
        },
        {
          text: "Reference",
          items: [
            { text: "How it works", link: "/how-it-works" },
            { text: "Limits and troubleshooting", link: "/limits" }
          ]
        }
      ],
      socialLinks: [{ icon: "github", link: REPO_URL }],
      editLink: {
        pattern: `${REPO_URL}/edit/main/docs-site/:path`,
        text: "Edit this page on GitHub"
      },
      outline: [2, 3],
      footer: {
        message:
          "MIT licensed. Rules decide the verdict; the LLM only explains.",
        copyright: `<a href="${REPO_URL}">Source on GitHub</a>`
      }
    }
  })
);
