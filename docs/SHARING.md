# Sharing a book

A book is your catalogue made public: a page anyone can browse, where every pattern and work has a **Copy prompt**
that works in any AI, plus `artbook.md`, the whole book as one file an agent can read from a link. Other Artspo users
can import your book into their own library and build with your patterns.

Your agent can do all of this for you ("Publish my library as a book on GitHub Pages"). These are the steps it follows.

## What goes in, what stays home

The book is built from the public edition, which leaves out:

- clips marked `private: true`, and clips that look like logged-in pages (app., dashboard and workspace URLs)
- your notes (unless you add `--with-notes`), page text, full-page shots, filmstrips, raw `clip.md` and file paths
- screenshots of the sites you clipped. Clips appear as their rebuilt palette and type instead. Add `--thumbnails`
  if you want each site's screenshot shown; those images belong to the sites, so it's your call.

The script prints everything it left out. Read it before you publish.

## Publish on GitHub Pages

1. On GitHub, create an empty public repository, say `artbook`.
2. Build the book into a folder, giving it the address it will have:

   ```sh
   python3 ~/Projects/artspo/extension/skills/artspo/catalogue.py ~/Downloads/artspo \
     --public --site ~/code/artbook --title "Bryan's artbook" --url https://bryfeng.github.io/artbook/
   ```

   Add `--collection launch-moodboard` to publish one collection instead of the whole library.

3. Push it:

   ```sh
   cd ~/code/artbook
   git init -b main && git add -A && git commit -m "Artbook"
   git remote add origin https://github.com/bryfeng/artbook.git && git push -u origin main
   ```

4. On GitHub, open the repository's **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a
   branch**, pick `main` and `/ (root)`, and save. A minute later the book is at `https://bryfeng.github.io/artbook/`.

To update it, run the same build command, then `git add -A && git commit -m "Update" && git push`.

The folder holds `index.html` (the page), `artbook.md` (for agents), `cover.png` (the preview image when the link is
posted), `img/` and `works/`, and an empty `.nojekyll` so GitHub serves the files as they are.

## Your own domain, later

Rebuild with the new address, for example `--url https://book.bryanfeng.com/`. The build writes a `CNAME` file for
it. Push, then:

1. At your DNS provider, add a `CNAME` record from `book` to `bryfeng.github.io`.
2. In **Settings → Pages**, enter `book.bryanfeng.com` under **Custom domain**, and turn on **Enforce HTTPS** once
   it's offered.

For a root domain (no `book.`), GitHub's guide covers the
records: [Managing a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

## The preview card

When the link is posted on X, LinkedIn, Slack or iMessage, it shows the book's title, a description and
`cover.png`. The default cover is paint chips from your design languages. For your own, pass `--cover image.png`
(1200 × 630) and `--description "One line about the book"`. Preview images need the full address, so build with
`--url`.

## Using someone else's book

- **Take one thing:** open a pattern or work and press **Copy prompt**. Paste it into any AI.
- **Use the whole book:** tell your agent `Use https://sam.github.io/artbook/artbook.md as your design reference.`
- **Import it into your library:**

  ```sh
  python3 ~/Projects/artspo/extension/skills/artspo/import_book.py https://sam.github.io/artbook/
  ```

  Its patterns land in `patterns/imported/sams-artbook/`, show in your catalogue marked with the book they came from,
  and your agent can build with them as `soft-rise-reveal@sams-artbook`. Run it again to update. If you publish a
  book that includes them, they keep crediting Sam's book.
