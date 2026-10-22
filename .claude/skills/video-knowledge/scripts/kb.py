#!/usr/bin/env python3
"""Persistent knowledge base for video-derived knowledge (SQLite + FTS5, stdlib only).

KB location: --kb DIR, else $VK_HOME, else ./video-knowledge-data
  DIR/kb.sqlite         everything searchable (videos, transcript, frames, entries, sources, conflicts)
  DIR/videos/<id>/      frames (+ optional copy of the video)

Commands: init add-video set-status ingest search show tree videos conflicts resolve export
"""
import argparse, glob, hashlib, json, os, re, shutil, sqlite3, sys, time

TYPES = {"concept", "procedure", "troubleshooting", "warning", "component", "error_condition", "example", "tip"}
RESERVED = {"type", "title", "line", "station", "equipment", "component", "sources", "data"}
ORDERED = {"steps"}                     # order matters -> differing lists are a conflict, not a union
STOP = set("the a an of to is it in on at and or for with this that be are was if you your then when from by as not do does did why how what which can i my we will would should".split())

SCHEMA = """
CREATE TABLE IF NOT EXISTS videos(id INTEGER PRIMARY KEY, title TEXT, file_name TEXT, file_path TEXT, sha256 TEXT,
  uploaded_at TEXT, duration REAL, source TEXT, description TEXT, status TEXT DEFAULT 'uploaded', stt_engine TEXT);
CREATE TABLE IF NOT EXISTS segments(id INTEGER PRIMARY KEY, video_id INT, start REAL, end REAL, text TEXT);
CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(text, content='segments', content_rowid='id');
CREATE TABLE IF NOT EXISTS frames(id INTEGER PRIMARY KEY, video_id INT, seconds REAL, path TEXT, reason TEXT, description TEXT);
CREATE TABLE IF NOT EXISTS entries(id INTEGER PRIMARY KEY, type TEXT, title TEXT, line TEXT, station TEXT, component TEXT,
  data TEXT, created_at TEXT, updated_at TEXT, has_conflict INT DEFAULT 0);
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(title, scope, body);
CREATE TABLE IF NOT EXISTS entry_sources(id INTEGER PRIMARY KEY, entry_id INT, video_id INT, seconds REAL, quote TEXT, visual TEXT,
  added_at TEXT, UNIQUE(entry_id, video_id, seconds));
CREATE TABLE IF NOT EXISTS conflicts(id INTEGER PRIMARY KEY, entry_id INT, field TEXT, existing_value TEXT, new_value TEXT,
  new_video_id INT, new_seconds REAL, status TEXT DEFAULT 'open', resolution TEXT, created_at TEXT, UNIQUE(entry_id, field, new_value));
CREATE TABLE IF NOT EXISTS links(a INT, b INT, kind TEXT, score REAL, UNIQUE(a, b, kind));
"""


# ---------- helpers ----------
def now(): return time.strftime("%Y-%m-%dT%H:%M:%S")
def fmt(sec):
    sec = int(round(sec or 0)); return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def parse_ts(v):
    if isinstance(v, (int, float)): return float(v)
    parts = [float(p) for p in str(v).strip().split(":")]
    out = 0.0
    for p in parts: out = out * 60 + p
    return out


def toks(s):
    out = set()
    for w in re.findall(r"[a-z0-9]+", str(s).lower()):
        if w in STOP: continue
        for suf in ("ing", "es", "ed", "s"):
            if len(w) > 4 and w.endswith(suf): w = w[: -len(suf)]; break
        if len(w) > 4 and w[-1] == w[-2] and w[-1] not in "ls": w = w[:-1]
        if len(w) > 3 and w.endswith("e"): w = w[:-1]
        out.add(w)
    return out


def jac(a, b):
    a, b = toks(a), toks(b)
    return len(a & b) / len(a | b) if a and b else 0.0


def equivalent(a, b):
    na, nb = " ".join(sorted(toks(a))), " ".join(sorted(toks(b)))
    return na == nb or (na and nb and (na in nb or nb in na)) or jac(a, b) >= 0.8


def db(kb):
    os.makedirs(kb, exist_ok=True)
    c = sqlite3.connect(os.path.join(kb, "kb.sqlite")); c.row_factory = sqlite3.Row
    c.executescript(SCHEMA); return c


def flatten(d):
    out = []
    for k, v in d.items():
        if k.startswith("_"): continue
        out.append(f"{k}: " + ("; ".join(map(str, v)) if isinstance(v, list) else str(v)))
    return "\n".join(out)


def reindex(c, eid):
    e = c.execute("SELECT * FROM entries WHERE id=?", (eid,)).fetchone()
    c.execute("DELETE FROM entries_fts WHERE rowid=?", (eid,))
    scope = " ".join(x for x in (e["line"], e["station"], e["component"], e["type"]) if x)
    c.execute("INSERT INTO entries_fts(rowid,title,scope,body) VALUES(?,?,?,?)", (eid, e["title"], scope, flatten(json.loads(e["data"]))))


def src_label(c, vid, sec):
    v = c.execute("SELECT title FROM videos WHERE id=?", (vid,)).fetchone()
    return f"{v['title'] if v else vid} @ {fmt(sec)}"


# ---------- video intake ----------
def parse_plain_transcript(text):
    segs = []
    for line in text.splitlines():
        m = re.match(r"\s*\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–:]?\s*(.+)", line)
        if m: segs.append({"start": parse_ts(m[1]), "end": parse_ts(m[1]), "text": m[2].strip()})
    return segs


def cmd_add_video(a, c):
    path = a.file
    if path and os.path.exists(path):
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
        sha = h.hexdigest()
        dup = c.execute("SELECT id FROM videos WHERE sha256=?", (sha,)).fetchone()
        if dup and not a.force: sys.exit(f"Video already registered as id {dup['id']} (use --force to add again)")
    else:
        sha = None
    dur = a.duration
    if dur is None and path and os.path.exists(path):
        sys.path.insert(0, os.path.dirname(__file__))
        from extract_media import probe
        dur = probe(path)["duration"]
    cur = c.execute("INSERT INTO videos(title,file_name,file_path,sha256,uploaded_at,duration,source,description,status) VALUES(?,?,?,?,?,?,?,?,?)",
                    (a.title, os.path.basename(path) if path else None, os.path.abspath(path) if path else None, sha, now(), dur, a.source, a.description, "uploaded"))
    vid = cur.lastrowid
    vdir = os.path.join(a.kb, "videos", str(vid)); os.makedirs(vdir, exist_ok=True)
    if a.copy_video and path: shutil.copy2(path, vdir)
    segs, engine = [], None
    if a.transcript_file:
        segs = parse_plain_transcript(open(a.transcript_file, encoding="utf-8", errors="ignore").read()); engine = "provided"
    elif a.work and os.path.exists(f"{a.work}/transcript.json"):
        t = json.load(open(f"{a.work}/transcript.json")); segs, engine = t["segments"], t["engine"]
    for s in segs:
        r = c.execute("INSERT INTO segments(video_id,start,end,text) VALUES(?,?,?,?)", (vid, s["start"], s["end"], s["text"]))
        c.execute("INSERT INTO segments_fts(rowid,text) VALUES(?,?)", (r.lastrowid, s["text"]))
    nfr = 0
    if a.work and os.path.exists(f"{a.work}/frames.json"):
        for f in json.load(open(f"{a.work}/frames.json")):
            dst = os.path.join(vdir, "frames", os.path.basename(f["path"])); os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(f["path"], dst)
            c.execute("INSERT INTO frames(video_id,seconds,path,reason) VALUES(?,?,?,?)", (vid, f["seconds"], os.path.relpath(dst, a.kb), f["reason"])); nfr += 1
    c.execute("UPDATE videos SET stt_engine=?, status=? WHERE id=?", (engine, "transcribed" if segs else "uploaded", vid))
    c.commit()
    print(json.dumps({"video_id": vid, "segments": len(segs), "frames": nfr, "status": "transcribed" if segs else "uploaded"}))


# ---------- ingest + merge ----------
def scope_ok(e, n):
    for k in ("station", "line"):
        if e[k] and n.get(k) and not (toks(e[k]) & toks(n[k])): return False
    return True


def find_match(c, n):
    best, score = None, 0.0
    for e in c.execute("SELECT * FROM entries WHERE type=?", (n["type"],)):
        if not scope_ok(e, n): continue
        s = jac(e["title"], n["title"])
        if n["type"] == "error_condition" and n["data"].get("code") and str(n["data"]["code"]).lower() == str(json.loads(e["data"]).get("code", "")).lower():
            s = max(s, 0.9)
        if s > score: best, score = e, s
    return best, score


def add_source(c, eid, vid, s):
    sec = parse_ts(s["timestamp"])
    c.execute("INSERT OR IGNORE INTO entry_sources(entry_id,video_id,seconds,quote,visual,added_at) VALUES(?,?,?,?,?,?)",
              (eid, vid, sec, s.get("quote"), s.get("visual"), now()))
    return sec


def norm_entry(raw):
    t = raw.get("type")
    if t not in TYPES: raise ValueError(f"unknown type {t!r}; use one of {sorted(TYPES)}")
    if not raw.get("title"): raise ValueError("entry needs a title")
    if not raw.get("sources"): raise ValueError(f"entry {raw['title']!r} needs at least one source with a timestamp")
    data = dict(raw.get("data") or {})
    for k, v in raw.items():
        if k not in RESERVED: data[k] = v
    return {"type": t, "title": raw["title"].strip(), "line": raw.get("line"), "station": raw.get("station") or raw.get("equipment"),
            "component": raw.get("component"), "data": data, "sources": raw["sources"]}


def cmd_ingest(a, c):
    vid = a.video_id
    if not c.execute("SELECT 1 FROM videos WHERE id=?", (vid,)).fetchone(): sys.exit("unknown video id")
    report = {"created": [], "merged": [], "related": [], "conflicts": [], "errors": []}
    raw_entries = json.load(open(a.entries))
    for raw in raw_entries if isinstance(raw_entries, list) else raw_entries["entries"]:
        try: n = norm_entry(raw)
        except ValueError as ex: report["errors"].append(str(ex)); continue
        first = n["sources"][0]; label = src_label(c, vid, parse_ts(first["timestamp"]))
        e, score = find_match(c, n)
        if e is not None and score >= a.merge_threshold:
            data = json.loads(e["data"]); prov = data.setdefault("_prov", {}); changed = False
            for k, v in n["data"].items():
                cur = data.get(k)
                if isinstance(v, list):
                    cur_list = cur if isinstance(cur, list) else []
                    if k in ORDERED and cur_list and not (len(cur_list) == len(v) and all(equivalent(x, y) for x, y in zip(cur_list, v))):
                        if add_conflict(c, e["id"], k, cur_list, v, vid, parse_ts(first["timestamp"])): report["conflicts"].append({"entry": e["id"], "field": k})
                    elif k in ORDERED and not cur_list:
                        data[k] = v; changed = True
                    elif k not in ORDERED:
                        for item in v:
                            if not any(equivalent(item, x) for x in cur_list):
                                cur_list.append(item); prov.setdefault(k, {})[item] = [label]; changed = True
                            else:
                                match = next(x for x in cur_list if equivalent(item, x))
                                lst = prov.setdefault(k, {}).setdefault(match, [])
                                if label not in lst: lst.append(label); changed = True
                        data[k] = cur_list
                else:
                    if cur in (None, ""): data[k] = v; changed = True
                    elif not equivalent(cur, v):
                        if add_conflict(c, e["id"], k, cur, v, vid, parse_ts(first["timestamp"])): report["conflicts"].append({"entry": e["id"], "field": k})
            for k in ("line", "station", "component"):
                if not e[k] and n[k]: c.execute(f"UPDATE entries SET {k}=? WHERE id=?", (n[k], e["id"]))
            c.execute("UPDATE entries SET data=?, updated_at=? WHERE id=?", (json.dumps(data), now(), e["id"]))
            for s in n["sources"]: add_source(c, e["id"], vid, s)
            reindex(c, e["id"]); report["merged"].append({"entry": e["id"], "into": e["title"], "score": round(score, 2), "new_info": changed})
        else:
            data = n["data"]; prov = {}
            for k, v in data.items():
                if isinstance(v, list) and k not in ORDERED: prov[k] = {i: [label] for i in v}
            data["_prov"] = prov
            r = c.execute("INSERT INTO entries(type,title,line,station,component,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                          (n["type"], n["title"], n["line"], n["station"], n["component"], json.dumps(data), now(), now()))
            eid = r.lastrowid
            for s in n["sources"]: add_source(c, eid, vid, s)
            reindex(c, eid); report["created"].append({"entry": eid, "title": n["title"]})
            if e is not None and score >= a.related_threshold:
                c.execute("INSERT OR IGNORE INTO links VALUES(?,?,?,?)", (eid, e["id"], "related", score))
                report["related"].append({"entry": eid, "related_to": e["id"], "score": round(score, 2)})
    c.execute("UPDATE videos SET status='knowledge_extracted' WHERE id=?", (vid,))
    c.commit()
    print(json.dumps(report, indent=1))


def add_conflict(c, eid, field, old, new, vid, sec):
    r = c.execute("INSERT OR IGNORE INTO conflicts(entry_id,field,existing_value,new_value,new_video_id,new_seconds,created_at) VALUES(?,?,?,?,?,?,?)",
                  (eid, field, json.dumps(old), json.dumps(new), vid, sec, now()))
    c.execute("UPDATE entries SET has_conflict=1 WHERE id=?", (eid,))
    return r.rowcount > 0


# ---------- retrieval ----------
def render(c, e, full=True):
    d = json.loads(e["data"]); prov = d.get("_prov", {})
    scope = " > ".join(x for x in (e["line"], e["station"], e["component"]) if x)
    out = [f"### [{e['type']}] {e['title']}  (entry #{e['id']})" + ("  ⚠ CONFLICTING SOURCES" if e["has_conflict"] else "")]
    if scope: out.append(f"Scope: {scope}")
    for k, v in d.items():
        if k.startswith("_"): continue
        if isinstance(v, list):
            out.append(f"{k}:")
            for i, item in enumerate(v, 1):
                tag = f"  [{'; '.join(prov.get(k, {}).get(item, []))}]" if prov.get(k, {}).get(item) else ""
                out.append(f"  {i}. {item}{tag}" if k in ORDERED else f"  - {item}{tag}")
        else: out.append(f"{k}: {v}")
    for cf in c.execute("SELECT * FROM conflicts WHERE entry_id=? AND status='open'", (e["id"],)):
        out.append(f"CONFLICT #{cf['id']} on '{cf['field']}': existing={cf['existing_value']}  vs  {src_label(c, cf['new_video_id'], cf['new_seconds'])} says {cf['new_value']}")
    srcs = c.execute("SELECT * FROM entry_sources WHERE entry_id=? ORDER BY video_id, seconds", (e["id"],)).fetchall()
    out.append("Sources: " + " | ".join(src_label(c, s["video_id"], s["seconds"]) for s in srcs))
    if full:
        for s in srcs[:3]:
            if s["quote"]: out.append(f"  “{s['quote']}” — {src_label(c, s['video_id'], s['seconds'])}")
            if s["visual"]: out.append(f"  (on screen: {s['visual']})")
    return "\n".join(out)


def cmd_search(a, c):
    words = [w for w in re.findall(r"[a-z0-9]+", a.query.lower()) if w not in STOP]
    if not words: sys.exit("empty query")
    q = " OR ".join(f'"{w}"*' for w in words)
    sql = "SELECT e.*, bm25(entries_fts, 6.0, 2.0, 1.0) AS rank FROM entries_fts JOIN entries e ON e.id=entries_fts.rowid WHERE entries_fts MATCH ?"
    args = [q]
    if a.type: sql += " AND e.type=?"; args.append(a.type)
    if a.station: sql += " AND (e.station LIKE ? OR e.component LIKE ?)"; args += [f"%{a.station}%"] * 2
    rows = c.execute(sql + " ORDER BY rank LIMIT ?", args + [a.limit]).fetchall()
    if a.json:
        print(json.dumps([{**dict(r), "data": json.loads(r["data"])} for r in rows], indent=1)); return
    if not rows: print("No matching knowledge entries."); 
    for r in rows: print(render(c, r), "\n")
    stations = {r["station"] for r in rows if r["station"]}
    shown = {r["id"] for r in rows}
    for st in stations:   # safety info for the same equipment is always worth surfacing
        for w in c.execute("SELECT * FROM entries WHERE type='warning' AND station=?", (st,)):
            if w["id"] not in shown: print("(related safety info)\n" + render(c, w, False), "\n")
    if a.transcript or not rows:
        seg = c.execute("SELECT s.*, bm25(segments_fts) r FROM segments_fts JOIN segments s ON s.id=segments_fts.rowid WHERE segments_fts MATCH ? ORDER BY r LIMIT ?", (q, a.limit)).fetchall()
        if seg: print("## Raw transcript matches (unstructured)")
        for s in seg: print(f"- {src_label(c, s['video_id'], s['start'])}: {s['text']}")


def cmd_show(a, c):
    e = c.execute("SELECT * FROM entries WHERE id=?", (a.id,)).fetchone()
    print(render(c, e) if e else "not found")


def cmd_tree(a, c):
    tree = {}
    for e in c.execute("SELECT * FROM entries ORDER BY line, station, component, type, title"):
        node = tree
        for lvl in (e["line"] or "(no line)", e["station"] or "(no station)", e["component"] or "(station-level)", e["type"]):
            node = node.setdefault(lvl, {})
        n = c.execute("SELECT COUNT(DISTINCT video_id) FROM entry_sources WHERE entry_id=?", (e["id"],)).fetchone()[0]
        node[f"#{e['id']} {e['title']}  [{n} video(s)]{' ⚠' if e['has_conflict'] else ''}"] = None
    def show(n, d=0):
        for k, v in n.items():
            print("  " * d + k)
            if v: show(v, d + 1)
    show(tree)


def cmd_videos(a, c):
    for v in c.execute("SELECT v.*, (SELECT COUNT(DISTINCT entry_id) FROM entry_sources WHERE video_id=v.id) n FROM videos v"):
        print(f"#{v['id']} {v['title']} | {v['file_name']} | {fmt(v['duration'])} | {v['source'] or '-'} | {v['status']} | uploaded {v['uploaded_at']} | {v['n']} entries")


def cmd_conflicts(a, c):
    rows = c.execute("SELECT * FROM conflicts" + ("" if a.all else " WHERE status='open'")).fetchall()
    if not rows: print("No open conflicts.")
    for cf in rows:
        e = c.execute("SELECT title FROM entries WHERE id=?", (cf["entry_id"],)).fetchone()
        print(f"CONFLICT #{cf['id']} [{cf['status']}] entry #{cf['entry_id']} '{e['title']}' field '{cf['field']}'\n  existing: {cf['existing_value']}\n  new ({src_label(c, cf['new_video_id'], cf['new_seconds'])}): {cf['new_value']}")


def cmd_resolve(a, c):
    cf = c.execute("SELECT * FROM conflicts WHERE id=?", (a.id,)).fetchone()
    if not cf: sys.exit("unknown conflict")
    e = c.execute("SELECT * FROM entries WHERE id=?", (cf["entry_id"],)).fetchone()
    d = json.loads(e["data"])
    if a.keep == "new": d[cf["field"]] = json.loads(cf["new_value"])
    elif a.keep == "both":
        d[cf["field"] + "_alt"] = json.loads(cf["new_value"])
    c.execute("UPDATE entries SET data=? WHERE id=?", (json.dumps(d), e["id"]))
    c.execute("UPDATE conflicts SET status='resolved', resolution=? WHERE id=?", (f"{a.keep}: {a.note or ''}", a.id))
    c.execute("UPDATE entries SET has_conflict=EXISTS(SELECT 1 FROM conflicts WHERE entry_id=? AND status='open') WHERE id=?", (e["id"], e["id"]))
    reindex(c, e["id"]); c.commit(); print("resolved")


def cmd_set_status(a, c):
    c.execute("UPDATE videos SET status=? WHERE id=?", (a.status, a.id)); c.commit(); print("ok")


def cmd_export(a, c):
    out = {"videos": [dict(r) for r in c.execute("SELECT * FROM videos")],
           "entries": [{**dict(r), "data": json.loads(r["data"]),
                        "sources": [dict(s) for s in c.execute("SELECT * FROM entry_sources WHERE entry_id=?", (r["id"],))]} for r in c.execute("SELECT * FROM entries")],
           "conflicts": [dict(r) for r in c.execute("SELECT * FROM conflicts")]}
    json.dump(out, open(a.out, "w"), indent=1); print(f"exported {len(out['entries'])} entries -> {a.out}")


def main():
    p = argparse.ArgumentParser(); p.add_argument("--kb", default=os.environ.get("VK_HOME", "video-knowledge-data"))
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init")
    s = sub.add_parser("add-video"); s.add_argument("--file"); s.add_argument("--title", required=True); s.add_argument("--source"); s.add_argument("--description")
    s.add_argument("--duration", type=float); s.add_argument("--work", help="dir from extract_media.py"); s.add_argument("--transcript-file")
    s.add_argument("--copy-video", action="store_true"); s.add_argument("--force", action="store_true")
    s = sub.add_parser("set-status"); s.add_argument("id", type=int); s.add_argument("status")
    s = sub.add_parser("ingest"); s.add_argument("video_id", type=int); s.add_argument("entries")
    s.add_argument("--merge-threshold", type=float, default=0.6); s.add_argument("--related-threshold", type=float, default=0.35)
    s = sub.add_parser("search"); s.add_argument("query"); s.add_argument("--type"); s.add_argument("--station"); s.add_argument("--limit", type=int, default=5)
    s.add_argument("--transcript", action="store_true", help="also show raw transcript hits"); s.add_argument("--json", action="store_true")
    s = sub.add_parser("show"); s.add_argument("id", type=int)
    sub.add_parser("tree"); sub.add_parser("videos")
    s = sub.add_parser("conflicts"); s.add_argument("--all", action="store_true")
    s = sub.add_parser("resolve"); s.add_argument("id", type=int); s.add_argument("--keep", choices=["existing", "new", "both"], required=True); s.add_argument("--note")
    s = sub.add_parser("export"); s.add_argument("out")
    a = p.parse_args(); c = db(a.kb)
    if a.cmd == "init": print(f"KB ready at {a.kb}"); return
    {"add-video": cmd_add_video, "set-status": cmd_set_status, "ingest": cmd_ingest, "search": cmd_search, "show": cmd_show,
     "tree": cmd_tree, "videos": cmd_videos, "conflicts": cmd_conflicts, "resolve": cmd_resolve, "export": cmd_export}[a.cmd](a, c)


if __name__ == "__main__":
    main()
