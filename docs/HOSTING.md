# Hosting

Research date: **2026-10-25**. Prices and limits change often; every figure below links to its source. Items marked **(unverified)** came from third-party pages or conflicting results, so check the vendor page before relying on them.

## 1. Recommendation

**Host the static game on Cloudflare (Workers Static Assets), deployed from your laptop with one CLI command.**

Why:

- Free, and static asset requests are "free and unlimited" ([Cloudflare billing docs](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)). No bandwidth cap to worry about.
- No git remote needed. This worktree has none, so Git-based hosts need you to create a GitHub repo first.
- Commercial use is allowed (Vercel Hobby forbids it, see below).
- The multiplayer server can later live in the same Cloudflare project (Durable Objects, section 3). One account, one deploy command, same origin, no CORS.

Fallback if you would rather use GitHub: GitHub Pages (workflow included, section 1.3).

### 1.1 Steps (about 10 minutes the first time, about 30 seconds per redeploy)

You do these. This agent did not run them (no accounts, no deploys).

1. Create a free Cloudflare account at <https://dash.cloudflare.com/sign-up> (about 3 min). No card needed.
2. From the repo root, build:
   ```
   nice -n 19 pnpm build
   ```
   Output goes to `dist/`.
3. Log in (opens a browser tab, about 1 min):
   ```
   npx wrangler login
   ```
4. Deploy (about 30 s). `wrangler.jsonc` in the repo root already points at `dist/` and enables SPA fallback:
   ```
   npx wrangler deploy
   ```
5. Wrangler prints a URL like `https://catan-clone.<your-subdomain>.workers.dev`. Open it and play.

Config already on this branch: `wrangler.jsonc` (assets dir `./dist`, `not_found_handling: single-page-application`, per the [Workers static assets docs](https://developers.cloudflare.com/workers/static-assets/)). Vite `base` stays `/`, so no change is needed for this path.

### 1.2 Optional: custom domain (about 10 minutes plus DNS wait)

1. Buy or own a domain. Cloudflare Registrar sells at wholesale price; any registrar works.
2. Dashboard: Workers & Pages, your Worker, Settings, Domains & Routes, Add, Custom domain. The domain's DNS must be on Cloudflare (free plan). HTTPS is automatic.
3. Optional: auto-deploy on push by connecting a GitHub repo under Settings, Builds. Build command `pnpm build`, deploy command `npx wrangler deploy`.

### 1.3 Fallback: GitHub Pages

`.github/workflows/pages.yml` is on this branch. It is **inert**: trigger is `workflow_dispatch` only.

1. Push the repo to GitHub. Free Pages needs a **public** repo (private repo Pages is a paid-plan feature; **unverified** here, the docs page I fetched did not state it).
2. Repo Settings, Pages, Source: **GitHub Actions**.
3. Actions tab, "Deploy to GitHub Pages", Run workflow (about 2 min).
4. Site appears at `https://<user>.github.io/<repo>/`. The workflow sets `VITE_BASE=/<repo>/`; `vite.config.ts` reads it.
5. To auto-deploy on push, change the workflow trigger to `push: branches: [main]`.

Limits: 1 GB site, 100 GB/month soft bandwidth, 10 builds/hour soft (not applied to custom Actions workflows) ([GitHub docs](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)). Workflow shape follows [GitHub's custom workflow docs](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). Action versions were copied from that page; confirm them when you first run it.

## 2. Comparison

| Host                                               | Free tier limits                                                                                                                                                                                                                                                                                             | Custom domain / HTTPS                                                   | Deploy method                               | Gotchas                                                                                                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Cloudflare Workers Static Assets** (recommended) | Static requests free and unlimited. Free Workers plan: 100k Worker requests/day, which only matter if requests hit Worker code ([billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)) | Yes, free, auto HTTPS                                                   | `wrangler deploy` CLI, or git integration   | Needs `not_found_handling: single-page-application` for SPA routes. Cloudflare now points new projects here rather than Pages ([compat matrix](https://developers.cloudflare.com/workers/static-assets/compatibility-matrix)). |
| **Cloudflare Pages**                               | 500 builds/month, 20,000 files, 25 MiB per file, 100 projects, no bandwidth cap listed ([limits](https://developers.cloudflare.com/pages/platform/limits/))                                                                                                                                                  | Yes, free                                                               | Git, drag-and-drop, `wrangler pages deploy` | Still supported, but the newer Workers route is where features go (third-party read; **unverified** that Cloudflare says so officially).                                                                                       |
| **GitHub Pages**                                   | 1 GB site, 100 GB/month soft bandwidth, 10 builds/hour soft ([docs](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits))                                                                                                                                                 | Yes, free HTTPS                                                         | Git push or Actions                         | Project sites need `base: '/<repo>/'`. No SPA fallback (add a `404.html` copy of `index.html` if you add routes). Public repo for free plan.                                                                                   |
| **Netlify**                                        | Free plan: $0, 300 credits/month; bandwidth costs 20 credits/GB, production deploy 15 credits ([pricing](https://www.netlify.com/pricing/)). Hard cap, no overage per a third-party source (**unverified**)                                                                                                  | Yes, free HTTPS                                                         | Git, CLI, drag-and-drop                     | Credit model replaced old fixed limits (date of change differs by source). Add `_redirects` `/* /index.html 200` for SPA routes.                                                                                               |
| **Vercel**                                         | Hobby: first 100 GB data transfer/month, 1 deploy at a time ([fair use](https://vercel.com/docs/limits/fair-use-guidelines))                                                                                                                                                                                 | Yes, free HTTPS                                                         | Git, CLI                                    | **Hobby is non-commercial only** (ads, payments, paid contributors count; donations do not). Hobby cannot connect to Git org repos ([limits](https://vercel.com/docs/limits)).                                                 |
| **Firebase Hosting**                               | About 10 GB storage and 10 GB/month transfer on Spark; sources conflict (**unverified**). Overage on Blaze $0.15 to $0.20/GiB ([pricing summary](https://firebase.google.com/pricing))                                                                                                                       | Yes, free HTTPS                                                         | `firebase deploy` CLI                       | Needs Google project; Cloud Storage now requires billing account since Feb 2026 (third-party, **unverified**).                                                                                                                 |
| **Render static sites**                            | Static sites not spun down. Bandwidth number not found (**unverified**). Free web services: 750 instance hours/month, spin down after 15 min idle ([Render docs](https://render.com/docs/free))                                                                                                              | Yes, free HTTPS                                                         | Git                                         | Fine for static, but the free _server_ sleeps (section 3).                                                                                                                                                                     |
| **Surge**                                          | Free; custom domains free ([docs](https://surge.sh/docs/platform/custom-domains))                                                                                                                                                                                                                            | Yes. HTTPS on custom domains conflicts between sources (**unverified**) | `npx surge dist`                            | Small project, no git integration; weakest long-term bet.                                                                                                                                                                      |
| **itch.io**                                        | Free to host HTML5 zip with `index.html` ([docs](https://itch.io/docs/creators/html5)). Size cap sources conflict (**unverified**)                                                                                                                                                                           | itch.io URL only, no custom domain                                      | Web upload or butler CLI                    | Runs in an iframe; not a fit for online multiplayer with your own server and WebSockets to another origin without care. Good for sharing a hotseat demo.                                                                       |

Recommendation logic: all of the first three are fine for a static site today. Cloudflare wins because static traffic is unmetered and the multiplayer path stays on the same platform.

## 3. Multiplayer path

Your engine is pure deterministic TypeScript, so an authoritative server is the same `applyAction` running per room. Each game is one stateful object holding one `GameState`. That maps naturally to a Durable Object (one object per game room).

| Option                                              | Free tier                                                                                                                                                                                                                                                                                                                                                                       | WebSockets                                                                                                                                       | Cold starts                                       | Notes                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cloudflare Workers + Durable Objects** (best fit) | Free plan, SQLite-backed only: 100k requests/day, 13,000 GB-s/day duration, 5M rows read/day, 100k rows written/day, 5 GB storage. Beyond a limit, operations fail until 00:00 UTC ([DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)). Paid: $5/month minimum ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)) | Yes. Connect counts as 1 request; incoming messages billed 20:1; outgoing free. With the Hibernation API, idle rooms are not billed for duration | Milliseconds scale; object wakes on first message | A third-party page showed a duration limit of 313,000 GB-s/day, conflicting with the official 13,000 figure I fetched. Treat 13,000 as the safe number. |
| **PartyServer / PartyKit**                          | Runs on your own Cloudflare account, so same limits as above. Cloudflare acquired PartyKit in April 2024 ([Cloudflare blog](https://blog.cloudflare.com/cloudflare-acquires-partykit))                                                                                                                                                                                          | Yes                                                                                                                                              | Same as DO                                        | Convenience layer for rooms and connections. Maintenance status of `partyserver` in 2026 **unverified**; raw DO API is a safe alternative.              |
| **Fly.io**                                          | **No free tier** for new orgs. 2 hours or 7 days trial. Smallest machine `shared-cpu-1x` 256 MB about $2.19/month ([pricing](https://docs.fly.io/about/pricing))                                                                                                                                                                                                                | Yes (plain Node server)                                                                                                                          | None if always on                                 | Cheap and ordinary Node, but you run a process and a card is required.                                                                                  |
| **Render**                                          | Free web service: 750 hours/month; spins down after 15 min idle; wake takes about 1 min. Since Feb 2026, incoming WebSocket messages keep it awake ([changelog](https://render.com/changelog/free-web-services-now-remain-active-while-receiving-websocket-messages), [docs](https://render.com/docs/free))                                                                     | Yes                                                                                                                                              | About 1 min after idle                            | In-memory game state is lost on spin-down; filesystem is ephemeral. Fine for a demo, bad for saved games.                                               |
| **Railway**                                         | Trial: one-time $5 credit; Hobby $5/month including $5 usage ([plans](https://docs.railway.com/pricing/plans)). Docs also list a Free plan with $1/month credit; sources conflict                                                                                                                                                                                               | Yes                                                                                                                                              | None on paid                                      | Card required (post-paid since March 30).                                                                                                               |
| **Deno Deploy**                                     | Free plan exists; request caps conflict across third-party sources (1M/month vs 100k/day) (**unverified**)                                                                                                                                                                                                                                                                      | Not confirmed in my results (**unverified**)                                                                                                     | Unknown                                           | Skipped for the game server until official docs are checked.                                                                                            |
| **Supabase Realtime**                               | Free: 200 concurrent connections, 100 messages/s ([limits](https://supabase.com/docs/guides/realtime/limits)). Free projects pause after 7 days idle (third-party, **unverified**)                                                                                                                                                                                              | Yes (channels, not custom server)                                                                                                                | Resume needed after pause                         | Pub/sub only. It cannot run your TypeScript engine as the authority without adding Edge Functions or a separate server.                                 |
| **Colyseus Cloud**                                  | No free tier; starts at $15/month ([pricing](https://www.colyseus.io/pricing), FAQ says "Not at this moment")                                                                                                                                                                                                                                                                   | Yes                                                                                                                                              | None                                              | Colyseus framework itself is free to self-host. Overkill for a turn-based game.                                                                         |

**Best pairing: Cloudflare static assets + Durable Objects in one Worker.**

- One `wrangler.jsonc`, add `main: "src/server/index.ts"`, a `durable_objects` binding, and `run_worker_first: ["/ws/*"]` so only WebSocket paths invoke Worker code. Everything else stays free static.
- Caveat from Cloudflare: when free request limits are exceeded, requests matching `run_worker_first` get HTTP 429 ([billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)). Keep the pattern narrow.
- Capacity sanity check (my estimate, not a vendor figure): a 4-player game sending a few hundred messages is a handful of billed requests (20:1 ratio). 100k requests/day should cover hundreds of games per day.
- Turn-based Catan tolerates a Render-style cold start badly (players stare at a spinner), which is another reason to prefer Durable Objects.
- Engine constraints already fit: no `Math.random`, no `Date`, JSON-safe state, so the engine can be imported unchanged into the Worker and state saved to DO storage.

## 4. Trademark and naming

I could not read Catan's own IP policy: `catan.com/ip-policy` returned 404 and `catan.com/trademark-and-copyright` returned 404. Z-Man Games' policy says it excludes Catan titles and points to an "IP Policy" link at the foot of catan.com ([Z-Man IP policy](https://www.zmangames.com/en/more/ip-policy/)). **Read that page yourself before going public.**

What to consider (not legal advice):

- "CATAN" is a trademark. Catan GmbH owns the IP and Catan Studio (Asmodee) publishes in the US (per search summaries; I could not confirm registration details, check a trademark database). The site `<title>` and `index.html` currently say "Catan".
- Rename before public launch (title, domain, repo name, UI strings). Do not put "Catan" or "Settlers of Catan" in the domain.
- Do not use official art, logos, card or tile artwork, or the box/rulebook text. Your own hex rendering with Pixi is fine.
- Game mechanics are generally not protected by copyright, but naming and artwork are the usual targets.
- History: Catan's lawyers pursued a fan-made Android app in 2011 ([Techdirt](https://www.techdirt.com/2011/02/22/how-lawyers-settlers-catan-abuse-ip-law-to-take-down-perfectly-legal-competitors/), commentary, not a court ruling). The developer reportedly gave up for cost reasons. Expect takedown risk if you use the name.
- Do not monetize (ads, payments). It raises risk, and it also breaks Vercel Hobby terms.
- A private link shared with friends is lower exposure than an indexed public site. Consider `noindex` until renamed.

## 5. Repo changes on this branch

All inert until you act:

| File                          | Effect                                                                      |
| ----------------------------- | --------------------------------------------------------------------------- |
| `wrangler.jsonc`              | Used only by `npx wrangler deploy`.                                         |
| `.github/workflows/pages.yml` | `workflow_dispatch` only; needs Pages enabled with source "GitHub Actions". |
| `vite.config.ts`              | `base: process.env.VITE_BASE ?? '/'`. Unset means `/`, same as before.      |

No dependency was added (`wrangler` is run via `npx`). When the server work starts, add it as a devDependency.
