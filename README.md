# Low Light Listening Room

A small daily check of [Low Light Mixes](https://lowlightmixes.blogspot.com), plus a player page.

- `.github/workflows/check.yml`: runs every day at 04:17 UTC (and on "Run workflow"). It reads the blog's public feed, its comments and the public Mixcloud listing, then commits the results.
- `scripts/fetch.py`: the reader (Python standard library only). It pulls out each mix's title, date, labels, words, Mixcloud and MP3 links, music links and tracklist. When a post has no tracklist, it looks in the comments.
- `data/mixes.json`: every mix, keyed by slug. `data/status.json`: when the check last ran and what it found.
- `art/`: cover thumbnails.
- `index.html`: the player copy of the room, served by GitHub Pages. It plays mixes with the Mixcloud player or the MP3, and every tracklist time jumps to that spot.

A daily Claude task copies new mixes from here into the claude.ai room.

## Setup

1. Create a new **public** repository, for example `lowlight-room`.
2. **Add file → Upload files**: upload `index.html`, `README.md` and the `scripts` folder. Commit.
3. **Add file → Create new file**: name it `.github/workflows/check.yml`, paste the contents of `check.yml`, then commit.
4. **Settings → Pages**: Source "Deploy from a branch", branch `main`, folder `/ (root)`. Save.
5. **Actions** tab → "Check Low Light Mixes" → **Run workflow**. The first run reads all posts and covers and takes a few minutes.
6. In the claude.ai room, open **About** and save `your-name/lowlight-room` as the repository.

If the Actions run fails at "Save changes", go to **Settings → Actions → General → Workflow permissions**, choose "Read and write permissions" and run it again.
