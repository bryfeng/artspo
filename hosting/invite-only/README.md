# Invite-only studio

A place to host Artspo books only the people you invite can open, on your own domain, free on Cloudflare for up
to 50 people. Copy this folder into a **private** repository. Books go in `site/`, one folder each, and
`site/index.html` lists them.

How it stays private:

- **Cloudflare Access** asks every visitor for their email and sends a one-time code. Only emails you add get in.
- **The Worker** (`src/worker.js`) also checks Access's signed token on every request, including images and
  scripts, so if the Access application is ever removed or misconfigured the site closes instead of going public.
- **One address.** `wrangler.jsonc` turns off the `workers.dev` address and preview URLs, which would sit outside
  the sign-in.
- Every page is marked `noindex`, and `robots.txt` disallows everything.

## Set up (once)

1. Change `routes` in `wrangler.jsonc` to your subdomain. The domain must already be on Cloudflare.
2. Push this folder to a private GitHub repository. In Cloudflare, go to **Workers & Pages → Create → Import a
   repository**, pick it, and keep the deploy command `npx wrangler deploy`. Each push now deploys. The site
   answers "This site isn't open yet" until step 4.
3. In **Zero Trust → Access → Applications → Add an application → Self-hosted**, enter the subdomain. Add a policy
   that **Allows** the emails you invite, with **One-time PIN** as the login method.
4. Copy the application's **Application Audience (AUD) Tag** and your team domain (`<team>.cloudflareaccess.com`)
   into `vars` in `wrangler.jsonc`, then push.

## Publish a book

```sh
python3 ~/Projects/artspo/extension/skills/artspo/catalogue.py ~/Downloads/artspo --share invite \
  --collection <collection> --site site/<book> --title "<Title>" --url https://<subdomain>/<book>/
```

Only works whose `work.md` says `share: invite` or `share: public` go in. Add the book to the list in
`site/index.html`, then commit and push.

## Invite or remove someone

Edit the emails in the Access policy (Zero Trust → Access → Applications → your app → Policies). Removing an email
blocks them at their next sign-in; signed-in sessions last as long as the application's session duration (24 hours
by default).

## Test

`npm test` runs the Worker's sign-in checks (Node 20+, no install needed).
