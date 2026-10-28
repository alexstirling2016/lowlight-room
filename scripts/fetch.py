#!/usr/bin/env python3
"""Low Light Mixes monitor.

Reads the public Blogger feed of lowlightmixes.blogspot.com (posts and
comments), pulls out each mix's details and tracklist, adds a few facts from
the public Mixcloud API, saves small cover images, and writes:

  data/mixes.json   every mix, keyed by slug
  data/status.json  when the check ran and what it found
  art/<slug>.jpg    cover thumbnails

Standard library only. Safe to run as often as you like: it rebuilds the files
from the blog each time and keeps each mix's firstSeen date.
"""
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

BLOG = "https://lowlightmixes.blogspot.com"
MIXCLOUD_USER = "lowlight"
UA = "LowLightListeningRoom/1.0 (personal archive; +https://github.com)"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
ART = os.path.join(ROOT, "art")
MAX_ART_PER_RUN = int(os.environ.get("MAX_ART_PER_RUN", "800"))


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def get(url, binary=False, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
                return body if binary else body.decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 + i * 3)
    raise last


def get_json(url):
    return json.loads(get(url))


# ---------------------------------------------------------------- HTML → lines
BLOCK = {"br", "p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6",
         "tr", "table", "blockquote", "pre", "hr", "dt", "dd"}


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.links = []      # (href, text)
        self.imgs = []
        self.iframes = []
        self._a = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in BLOCK:
            self.parts.append("\n")
        if tag == "a":
            self._a = [a.get("href") or "", []]
        elif tag == "img" and a.get("src"):
            self.imgs.append(a["src"])
        elif tag == "iframe" and a.get("src"):
            self.iframes.append(a["src"])

    def handle_endtag(self, tag):
        if tag in BLOCK:
            self.parts.append("\n")
        if tag == "a" and self._a is not None:
            self.links.append((self._a[0], clean("".join(self._a[1]))))
            self._a = None

    def handle_data(self, d):
        self.parts.append(d)
        if self._a is not None:
            self._a[1].append(d)

    def lines(self):
        text = "".join(self.parts)
        return [clean(l) for l in text.split("\n") if clean(l)]


def clean(s):
    s = s.replace(" ", " ").replace("​", "").replace("\t", " ")
    return re.sub(r"[ ]{2,}", " ", s).strip()


def parse_html(content):
    p = Page()
    try:
        p.feed(content or "")
        p.close()
    except Exception:  # noqa: BLE001
        pass
    return p


# ---------------------------------------------------------------- tracklists
TS = r"(\d{1,3}:\d{2}(?::\d{2})?)"
TS_LINE = re.compile(r"^" + TS + r"(?:\s*[-–—]\s*" + TS + r")?\s*[-–—:.]?\s+(.+)$")
NUM_LINE = re.compile(r"^(\d{1,2})[.)]\s+(.+\s[-–—]\s.+)$")
HEADER = re.compile(r"t\s*r\s*a\s*c\s*k\s*\s*l\s*i\s*s\s*t", re.I)
SEP = re.compile(r"\s+[-–—]\s+")
YEAR_PAREN = re.compile(r"\(([^()]*?)\s*((?:19|20)\d{2})\s*\)\s*$")


def secs(ts):
    if not ts:
        return None
    n = [int(x) for x in ts.split(":")]
    return n[0] * 3600 + n[1] * 60 + n[2] if len(n) == 3 else n[0] * 60 + n[1]


def split_track(rest):
    rest = rest.strip()
    album = year = None
    m = YEAR_PAREN.search(rest)
    if m:
        album = m.group(1).strip() or None
        year = int(m.group(2))
        rest = rest[: m.start()].strip()
    parts = SEP.split(rest, maxsplit=1)
    if len(parts) == 2:
        artist, title = parts[0].strip(), parts[1].strip()
    else:
        artist, title = None, rest
    return artist, title, album, year


def find_tracklist(lines):
    """Return (tracks, endSeconds, startIndex) or ([], None, None)."""
    # 1) timestamped lines
    tracks, end, start = [], None, None
    for i, l in enumerate(lines):
        m = TS_LINE.match(l)
        if not m:
            continue
        t, _t2, rest = m.group(1), m.group(2), m.group(3).strip()
        if re.fullmatch(r"end\.?|the end\.?|fin\.?", rest, re.I):
            end = secs(t)
            continue
        artist, title, album, year = split_track(rest)
        if start is None:
            start = i
        tracks.append({"t": t, "sec": secs(t), "artist": artist, "title": title,
                       "album": album, "year": year, "raw": l[:300]})
    if len(tracks) >= 3:
        return tracks, end, start
    # 2) numbered lines "1. Artist - Title"
    tracks, start = [], None
    for i, l in enumerate(lines):
        m = NUM_LINE.match(l)
        if m:
            artist, title, album, year = split_track(m.group(2))
            if start is None:
                start = i
            tracks.append({"t": None, "sec": None, "artist": artist, "title": title,
                           "album": album, "year": year, "raw": l[:300]})
    if len(tracks) >= 3:
        return tracks, None, start
    # 3) after a TRACKLIST header, consecutive "Artist - Title" lines
    for i, l in enumerate(lines):
        if HEADER.search(l) and len(l) < 40:
            tracks = []
            for j in range(i + 1, min(len(lines), i + 80)):
                lj = lines[j]
                if SEP.search(lj) and not lj.lower().startswith(("http", "[")):
                    artist, title, album, year = split_track(lj)
                    tracks.append({"t": None, "sec": None, "artist": artist, "title": title,
                                   "album": album, "year": year, "raw": lj[:300]})
                elif tracks:
                    break
            if len(tracks) >= 3:
                return tracks, None, i
    return [], None, None


# ---------------------------------------------------------------- post fields
SKIP_LINK = re.compile(r"(blogger\.com|blogspot\.com|googleusercontent\.com|mixcloud\.com|podbean\.com|"
                       r"apple\.com|itunes\.|twitter\.com|x\.com/intent|facebook\.com/sharer|pinterest\.com)", re.I)
LINK_LABEL = re.compile(r"^\[.*\]$")


def mixcloud_key(url):
    if not url:
        return None
    u = html.unescape(url)
    if "feed=" in u:
        q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query)
        u = (q.get("feed") or [""])[0]
        u = urllib.parse.unquote(u)
    if "://" in u:
        u = urllib.parse.urlparse(u).path
    m = re.match(r"^(/[^/?#\s]+/[^/?#\s]+)/?", u)
    if not m:
        return None
    key = urllib.parse.unquote(m.group(1)) + "/"
    if key.startswith(("/widget/", "/player/")):
        return None
    return urllib.parse.unquote(key)


def cover_small(src):
    if not src:
        return None
    if src.startswith("//"):
        src = "https:" + src
    parts = src.split("/")
    for i, seg in enumerate(parts):
        if re.fullmatch(r"(s\d{2,4}|w\d+-h\d+)(-[a-z0-9-]+)?", seg):
            parts[i] = "s500"
            return "/".join(parts)
    if re.search(r"=(s|w)\d+[^/]*$", src):
        return re.sub(r"=(s|w)\d+[^/]*$", "=s500", src)
    return src


def slug_from(url, title, published):
    m = re.search(r"/(\d{4})/(\d{2})/([^/?#]+?)(?:\.html)?(?:[?#].*)?$", url or "")
    if m:
        s = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    else:
        s = (published or "")[:7] + "-" + re.sub(r"[^a-z0-9]+", "-", (title or "post").lower())
    s = re.sub(r"[^A-Za-z0-9_-]+", "-", s).strip("-")[:120]
    return s or "post"


def entry_link(e, rel):
    for l in e.get("link", []):
        if l.get("rel") == rel:
            return l.get("href")
    return None


def parse_post(e):
    title = clean(html.unescape(e.get("title", {}).get("$t", ""))) or "(untitled)"
    content = e.get("content", {}).get("$t") or e.get("summary", {}).get("$t") or ""
    url = entry_link(e, "alternate")
    published = e.get("published", {}).get("$t")
    post_id = (e.get("id", {}).get("$t") or "").split("post-")[-1]
    page = parse_html(content)
    lines = page.lines()
    tracks, end, start = find_tracklist(lines)

    mix_url = None
    key = None
    keys = []  # candidate Mixcloud keys: embedded players first, then links, in page order
    mp3 = None
    music = []
    seen = set()
    for href, text in page.links:
        h = html.unescape(href or "").strip()
        if not h.startswith("http"):
            continue
        if "mixcloud.com" in h:
            k = mixcloud_key(h)
            if k:
                keys.append((k, False))
        if re.search(r"\.mp3(\?|$)", h, re.I) and not mp3:
            mp3 = h
        if SKIP_LINK.search(h):
            continue
        norm = h.split("?")[0].rstrip("/").lower()
        if norm in seen:
            continue
        seen.add(norm)
        music.append({"url": h[:400], "text": (text or "")[:160]})
    frames = [(mixcloud_key(src), True) for src in page.iframes if "mixcloud" in src]
    keys = [kk for kk in frames if kk[0]] + keys

    # intro: text before the tracklist / header, minus link labels and bare urls
    stop = start if start is not None else len(lines)
    for i, l in enumerate(lines[:stop]):
        if HEADER.search(l) and len(l) < 40:
            stop = i
            break
    intro_lines = [l for l in lines[:stop]
                   if not LINK_LABEL.match(l) and not l.lower().startswith("http")
                   and not re.fullmatch(r"links to all the music:?", l, re.I)]
    intro = "\n".join(intro_lines).strip()[:12000]

    imgs = [i for i in page.imgs if "googleusercontent" in i or "blogspot" in i or "bp.blogspot" in i]
    thumb = (e.get("media$thumbnail") or {}).get("url")
    cover = cover_small(imgs[0] if imgs else thumb)

    labels = [c.get("term") for c in e.get("category", []) if c.get("term")]
    comments = int((e.get("thr$total") or {}).get("$t") or 0)
    return {
        "slug": slug_from(url, title, published),
        "postId": post_id,
        "url": url,
        "title": title,
        "published": published,
        "updated": e.get("updated", {}).get("$t"),
        "labels": labels,
        "intro": intro,
        "coverUrl": cover,
        "mixcloudUrl": mix_url,
        "mixcloudKey": key,
        "_mcKeys": keys,
        "mp3Url": mp3,
        "links": music[:80],
        "tracks": tracks,
        "endSec": end,
        "tracklistSource": "post" if tracks else None,
        "commentCount": comments,
    }


# ---------------------------------------------------------------- feeds
def all_posts():
    out, start = [], 1
    while True:
        d = get_json(f"{BLOG}/feeds/posts/default?alt=json&max-results=150&start-index={start}")
        es = d.get("feed", {}).get("entry", []) or []
        out.extend(es)
        total = int(d["feed"].get("openSearch$totalResults", {}).get("$t", 0))
        start += len(es)
        if not es or start > total:
            return out, total
        time.sleep(1)


def all_comments():
    """{postId: [ {author, published, lines} ]}"""
    by_post, start = {}, 1
    while True:
        d = get_json(f"{BLOG}/feeds/comments/default?alt=json&max-results=500&start-index={start}")
        es = d.get("feed", {}).get("entry", []) or []
        for e in es:
            href = (e.get("thr$in-reply-to") or {}).get("href") or ""
            ref = (e.get("thr$in-reply-to") or {}).get("ref") or ""
            pid = ref.split("post-")[-1] if "post-" in ref else None
            if not pid:
                continue
            content = (e.get("content") or e.get("summary") or {}).get("$t", "")
            author = ((e.get("author") or [{}])[0].get("name") or {}).get("$t")
            by_post.setdefault(pid, []).append({
                "author": author, "published": (e.get("published") or {}).get("$t"),
                "lines": parse_html(content).lines(), "href": href})
        total = int(d["feed"].get("openSearch$totalResults", {}).get("$t", 0))
        start += len(es)
        if not es or start > total:
            return by_post
        time.sleep(1)


# Mixcloud paths that are profile pages, not uploads.
MC_RESERVED = {"posts", "select", "uploads", "favorites", "favourites", "listens", "playlists", "followers",
               "following", "stream", "activity", "shows", "reposts", "history", "upload", "live"}
OLDER_SHOW_DAYS = 21


def _when(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        return None


def _words(s):
    return set(w for w in re.findall(r"[a-z0-9]+", (s or "").lower()) if w not in ("by", "the", "a", "of", "and", "vol"))


def _sim(a, b):
    wa, wb = _words(a), _words(b)
    return len(wa & wb) / max(1, len(wa | wb))


def choose_mixcloud(keys, title, published, shows):
    """Pick the Mixcloud upload that belongs to this post.

    Posts often link to earlier mixes ("Vol. 1", the original of a sequel), and those links used to win.
    A candidate is refused when it is a profile page, or when it is one of the account's uploads that went
    up well before the post (it is an older mix being referred to). Unknown keys (another account's upload)
    are kept only when embedded as the post's player. Without a usable candidate, an upload whose name
    matches the title and that went up around the post's date is used."""
    pub = _when(published)
    for k, embedded in keys:
        seg = k.strip("/").split("/")
        if len(seg) != 2 or seg[1].lower() in MC_RESERVED:
            continue
        sh = shows.get(k.lower())
        if sh:
            made = _when(sh.get("created"))
            if pub and made and made < pub - timedelta(days=OLDER_SHOW_DAYS):
                continue
            return k
        if embedded or not shows:
            return k
    if pub and shows:
        best, score = None, 0.0
        for k, sh in shows.items():
            made = _when(sh.get("created"))
            if not made or abs((made - pub).days) > 30:
                continue
            sc = _sim(sh.get("name"), title)
            if sc > score:
                best, score = k, sc
        if best and score >= 0.6:
            return mixcloud_key(shows[best].get("url")) or best
    return None


def mixcloud_shows():
    shows = {}
    url = f"https://api.mixcloud.com/{MIXCLOUD_USER}/cloudcasts/?limit=100"
    pages = 0
    while url and pages < 40:
        d = get_json(url)
        for c in d.get("data", []):
            shows[urllib.parse.unquote(c.get("key") or "").lower()] = {
                "url": c.get("url"),
                "name": c.get("name"),
                "audioLength": c.get("audio_length"),
                "plays": c.get("play_count"),
                "favorites": c.get("favorite_count"),
                "created": c.get("created_time"),
                "tags": [t.get("name") for t in c.get("tags", []) if t.get("name")],
                "picture": (c.get("pictures") or {}).get("large"),
            }
        url = (d.get("paging") or {}).get("next")
        pages += 1
        time.sleep(1)
    return shows


# ---------------------------------------------------------------- main
def main():
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(ART, exist_ok=True)
    started = now_iso()
    status_path = os.path.join(DATA, "status.json")
    mixes_path = os.path.join(DATA, "mixes.json")
    old = {}
    if os.path.exists(mixes_path):
        try:
            old = json.load(open(mixes_path, encoding="utf-8")).get("mixes", {})
        except Exception:  # noqa: BLE001
            old = {}
    prev_status = {}
    if os.path.exists(status_path):
        try:
            prev_status = json.load(open(status_path, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass

    notes = []
    try:
        entries, total = all_posts()
    except Exception as e:  # noqa: BLE001
        st = dict(prev_status)
        st.update({"lastCheck": started, "lastResult": f"Could not read the blog feed ({e})", "ok": False})
        json.dump(st, open(status_path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        print(st["lastResult"], file=sys.stderr)
        return 1

    try:
        comments = all_comments()
    except Exception as e:  # noqa: BLE001
        comments = {}
        notes.append(f"comments not read ({e})")

    try:
        shows = mixcloud_shows()
    except Exception as e:  # noqa: BLE001
        shows = {}
        notes.append(f"Mixcloud details not read ({e})")

    mixes, new = {}, []
    for e in entries:
        m = parse_post(e)
        s = m["slug"]
        n = 2
        while s in mixes:
            s = f"{m['slug']}-{n}"
            n += 1
        m["slug"] = s
        # tracklist from comments when the post has none (or no timestamps)
        has_ts = any(t.get("sec") is not None for t in m["tracks"])
        if not has_ts:
            best = None
            for c in sorted(comments.get(m["postId"], []), key=lambda c: c.get("published") or ""):
                tr, end, _ = find_tracklist(c["lines"])
                if not tr:
                    continue
                c_ts = any(t.get("sec") is not None for t in tr)
                if best is None or (c_ts and not best[2]) or len(tr) > len(best[0]) + 3:
                    best = (tr, end, c_ts, c)
            if best and (not m["tracks"] or best[2]):
                m["tracks"], m["endSec"] = best[0], best[1] or m["endSec"]
                m["tracklistSource"] = "comment"
                m["tracklistComment"] = {"author": best[3]["author"], "published": best[3]["published"]}
        m["mixcloudKey"] = choose_mixcloud(m.pop("_mcKeys", []), m["title"], m["published"], shows)
        m["mixcloudUrl"] = ("https://www.mixcloud.com" + urllib.parse.quote(m["mixcloudKey"])) if m["mixcloudKey"] else None
        sh = shows.get(m["mixcloudKey"].lower()) if m["mixcloudKey"] else None
        m["mixcloud"] = sh  # null when there's no matching upload, so stale details are cleared downstream
        if sh:
            if not m["endSec"] and sh.get("audioLength"):
                m["endSec"] = sh["audioLength"]
        prev = old.get(s) or {}
        m["firstSeen"] = prev.get("firstSeen") or started
        if not prev:
            new.append(s)
        art = os.path.join(ART, s + ".jpg")
        if os.path.exists(art):
            m["artFile"] = f"art/{s}.jpg"
        body = {k: v for k, v in m.items() if k not in ("firstSeen", "fetchedAt", "changedAt", "hash")}
        m["hash"] = hashlib.sha1(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]
        m["changedAt"] = prev.get("changedAt") if prev.get("hash") == m["hash"] else started
        mixes[s] = m

    # covers
    got = 0
    for s, m in sorted(mixes.items(), key=lambda kv: kv[1].get("published") or "", reverse=True):
        if m.get("artFile") or not m.get("coverUrl") or got >= MAX_ART_PER_RUN:
            continue
        try:
            b = get(m["coverUrl"], binary=True, tries=2)
            if len(b) > 800 and b[:3] == b"\xff\xd8\xff":
                open(os.path.join(ART, s + ".jpg"), "wb").write(b)
                m["artFile"] = f"art/{s}.jpg"
                got += 1
            elif len(b) > 800:
                m["coverNote"] = "cover is not a JPEG; shown from the blog"
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.3)

    for s, m in mixes.items():
        body = {k: v for k, v in m.items() if k not in ("firstSeen", "fetchedAt", "changedAt", "hash")}
        h = hashlib.sha1(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]
        if h != m["hash"]:
            m["hash"], m["changedAt"] = h, started

    with_tl = sum(1 for m in mixes.values() if m["tracks"])
    from_comments = sum(1 for m in mixes.values() if m.get("tracklistSource") == "comment")
    out = {"blog": BLOG, "count": len(mixes), "mixes": mixes}
    tmp = mixes_path + ".tmp"
    json.dump(out, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, mixes_path)

    result = f"{len(mixes)} mixes on the blog, {len(new)} new" + (f" ({', '.join(mixes[s]['title'] for s in new[:5])})" if 0 < len(new) <= 5 else "")
    st = {
        "lastCheck": started, "lastOk": started, "ok": True, "lastResult": result,
        "postsTotal": total, "mixes": len(mixes), "withTracklist": with_tl,
        "tracklistsFromComments": from_comments, "newThisRun": new[:200],
        "mixcloudMatched": sum(1 for m in mixes.values() if m.get("mixcloud")),
        "coversSaved": got, "notes": notes,
    }
    json.dump(st, open(status_path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(result)
    for n in notes:
        print("note:", n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
