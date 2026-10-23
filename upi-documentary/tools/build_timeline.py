"""Build the master timeline from the script + measured voiceover durations.

Reads  script/lines.json and assets/vo/<id>.wav (falls back to assets/vo_scratch/).
Writes video/src/timeline.json  (frames, used by Remotion)
       music/cues.json          (seconds, used by the score + mixer)

Re-run this every time the voiceover changes; video, music and mix all follow it.
"""
import json
import math
import pathlib
import sys
import wave

ROOT = pathlib.Path(__file__).resolve().parent.parent
FPS = 30
GRID = 0.5  # seconds; scene cuts snap to this grid (120 BPM beat)

# Extra silence after a line (seconds) — the dramatic beats.
PAUSE_AFTER = {
    "c0_04": 0.35, "c0_05": 0.45, "c0_06": 0.9,
    "c1_02": 0.5, "c1_03": 1.3, "c1_05": 0.6, "c1_08": 0.5, "c1_09": 1.0, "c1_11": 0.6, "c1_13": 1.2,
    "c2_02": 0.9, "c2_05": 0.8, "c2_07": 0.6, "c2_09": 0.8, "c2_11": 0.6, "c2_12": 0.5, "c2_13": 0.7,
    "c2_14": 1.2, "c2_16": 1.2,
    "c3_03": 0.2, "c3_08": 0.8, "c3_09": 0.6, "c3_10": 0.6, "c3_12": 0.6, "c3_15": 0.9, "c3_16": 0.5,
    "c3_17": 1.6,
    "c4_01": 0.8, "c4_02": 0.8, "c4_04": 0.8, "c4_06": 1.0, "c4_08": 0.8, "c4_10": 2.6,
}
GAP = 0.32          # default silence between lines in one scene
GAP_COLD = 0.22     # tighter in the cold open
SCENE_PRE = 0.45    # silence at the start of a scene before the first line
SCENE_TAIL = 0.55   # silence after a scene's last line

COLD_PRE = 1.2      # black + ticking before the first word
TITLE_DUR = 4.0
DISCLAIMER_DUR = 3.0
CHAPTER_DUR = 3.0
COIN_BLACK = 1.2    # hard cut to black after the coin
ENDSCREEN = 10.0    # YouTube end-screen space


def wav_seconds(path: pathlib.Path) -> float:
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


def snap(t: float) -> float:
    return math.ceil(round(t / GRID, 6)) * GRID


def main():
    script = json.loads((ROOT / "script" / "lines.json").read_text())
    vo_dir = ROOT / "assets" / "vo"
    if not vo_dir.exists() or not any(vo_dir.glob("*.wav")):
        vo_dir = ROOT / "assets" / "vo_scratch"
    print("voiceover from", vo_dir.relative_to(ROOT), file=sys.stderr)

    segments, cues = [], []
    t = 0.0

    def add_scene(scene_id, lines, chapter, pre, gap):
        nonlocal t
        start = snap(t)
        cur = start + pre
        out_lines = []
        for i, ln in enumerate(lines):
            dur = wav_seconds(vo_dir / f"{ln['id']}.wav")
            out_lines.append({**ln, "t": round(cur, 3), "dur": round(dur, 3)})
            cur += dur + PAUSE_AFTER.get(ln["id"], gap if i < len(lines) - 1 else 0)
        end = cur + SCENE_TAIL
        segments.append({"kind": "scene", "id": scene_id, "chapter": chapter, "t": start,
                         "dur": round(end - start, 3), "lines": out_lines})
        t = end

    def add_fixed(kind, seg_id, dur, **extra):
        nonlocal t
        start = snap(t)
        segments.append({"kind": kind, "id": seg_id, "t": start, "dur": dur, **extra})
        t = start + dur

    for ci, ch in enumerate(script["chapters"]):
        if ch["id"] not in ("c0", "c5"):
            add_fixed("chapter", f"CH_{ch['id']}", CHAPTER_DUR, chapter=ch["id"], num=ci,
                      name_en=ch["name_en"], name_hi=ch["name_hi"])
        # group consecutive lines by scene
        groups = []
        for ln in ch["lines"]:
            if groups and groups[-1][0] == ln["scene"]:
                groups[-1][1].append(ln)
            else:
                groups.append((ln["scene"], [ln]))
        for gi, (scene_id, lines) in enumerate(groups):
            if ch["id"] == "c0":
                add_scene(scene_id, lines, ch["id"], COLD_PRE, GAP_COLD)
            else:
                add_scene(scene_id, lines, ch["id"], SCENE_PRE, GAP)
        if ch["id"] == "c0":
            add_fixed("title", "S01_Title", TITLE_DUR)
            add_fixed("disclaimer", "S02_Disclaimer", DISCLAIMER_DUR)
        if ch["id"] == "c4":
            # the coin keeps spinning in silence (pause already added), then black
            add_fixed("black", "BLACK", COIN_BLACK)
    # outro: extend the last scene with end-screen space
    segments[-1]["dur"] = round(segments[-1]["dur"] + ENDSCREEN, 3)
    t = segments[-1]["t"] + segments[-1]["dur"]

    total = round(t, 3)
    # frames
    tl = {"fps": FPS, "seconds": total, "frames": int(round(total * FPS)), "voDir": vo_dir.name,
          "disclaimer": script["disclaimer"], "title_hi": script["title_hi"], "title_en": script["title_en"],
          "segments": []}
    for s in segments:
        f = dict(s)
        f["from"] = int(round(s["t"] * FPS))
        f["frames"] = int(round(s["dur"] * FPS))
        if "lines" in s:
            f["lines"] = [{"id": l["id"], "display": l["display"], "en": l["en"], "src": l["src"],
                           "from": int(round(l["t"] * FPS)), "frames": int(round(l["dur"] * FPS)),
                           "t": l["t"], "dur": l["dur"]} for l in s["lines"]]
        tl["segments"].append(f)
    (ROOT / "video" / "src" / "timeline.json").write_text(json.dumps(tl, ensure_ascii=False, indent=1))

    # music/mix cues (seconds)
    for s in segments:
        cues.append({"kind": s["kind"], "id": s["id"], "chapter": s.get("chapter"), "t": s["t"], "dur": s["dur"],
                     "lines": [{"id": l["id"], "t": l["t"], "dur": l["dur"]} for l in s.get("lines", [])]})
    (ROOT / "music").mkdir(exist_ok=True)
    (ROOT / "music" / "cues.json").write_text(json.dumps({"seconds": total, "voDir": vo_dir.name, "segments": cues},
                                                        ensure_ascii=False, indent=1))
    m, sec = divmod(total, 60)
    print(f"total {int(m)}:{sec:05.2f}  ({tl['frames']} frames, {len(segments)} segments)", file=sys.stderr)
    for s in segments:
        print(f"  {s['t']:7.2f}  {s['dur']:6.2f}  {s['kind']:10s} {s['id']}", file=sys.stderr)


if __name__ == "__main__":
    main()
