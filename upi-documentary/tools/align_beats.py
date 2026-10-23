"""Re-sync the word-position beats to a new voiceover (no forced aligner needed).

Scenes and the score land hits at fractions of a line's duration (`L.c1_06.fr(0.82)`, `lt("c1_06", 0.82)`),
hand-tuned against the scratch voice. A new voice speaks at its own pace and pauses differently, so
for every beat we find its anchor in the scratch audio and the same anchor in the new audio:

  * beats sitting just before a word onset (the usual case: a stamp lands on a word) snap to the
    matching onset in the new voice, keeping the same small lead;
  * other beats keep the same share of *speech* before them (pauses excluded), which is what stays
    stable between voices.

Onsets are matched by that speech share, so a voice that pauses more or less still lines up.

usage: <musicenv>/bin/python -I tools/align_beats.py [--lang en]
reads  assets/vo_scratch[_en]/ (reference), assets/vo[_en]/ (final voice),
       script/beats_en_scratch.json (the English fractions tuned for the scratch voice)
writes script/beats_hi.json | script/beats_en.json   (fraction overrides, consumed by video + score)
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

import numpy as np
import soundfile as sf

ROOT = pathlib.Path(__file__).resolve().parent.parent
LANG = "en" if "--lang" in sys.argv and sys.argv[sys.argv.index("--lang") + 1] == "en" else "hi"
SCRATCH = ROOT / "assets" / ("vo_scratch" if LANG == "hi" else "vo_scratch_en")
FINAL = ROOT / "assets" / ("vo" if LANG == "hi" else "vo_en")
REF = json.loads((ROOT / "script" / "beats_en_scratch.json").read_text()) if LANG == "en" else {}
SNAP = 0.35  # a beat this close before an onset is "on that word"
MAX_DR = 0.07  # accept a matched onset only if its share of speech is this close


def beats_used() -> set[tuple[str, str]]:
    pairs: set[tuple[str, str]] = set()
    for f in (ROOT / "video" / "src" / "scenes").glob("*.tsx"):
        s = f.read_text()
        alias = dict(re.findall(r"\b([a-z])\s*=\s*L\.(c\d_\d+)", s))
        for m in re.finditer(r"\b(?:L\.(c\d_\d+)|([a-z]))\.fr\(([0-9.]+)\)", s):
            lid = m.group(1) or alias.get(m.group(2))
            if lid:
                pairs.add((lid, m.group(3)))
    score = (ROOT / "music" / "score.py").read_text()
    for m in re.finditer(r'(?:fr|lt)\("(c\d_\d+)", ([0-9.]+)\)', score):
        pairs.add((m.group(1), m.group(2)))
    # beats computed in loops (prestige.tsx S41, score.py chapter 2 timpani)
    for k in (0.3, 0.55, 0.8):
        pairs.add(("c4_06", str(k)))
    for i in range(3):
        pairs.add(("c2_07", str(0.22 + i * 0.25)))
    return pairs


def load(path: pathlib.Path) -> tuple[np.ndarray, int]:
    x, sr = sf.read(str(path), dtype="float32", always_2d=True)
    return x.mean(axis=1), sr


def voiced_segments(x: np.ndarray, sr: int) -> list[tuple[float, float]]:
    hop = int(0.01 * sr)
    win = int(0.03 * sr)
    e = np.convolve(x.astype(np.float64) ** 2, np.ones(win) / win, mode="same")[::hop]
    db = 10 * np.log10(e + 1e-12)
    thr = np.percentile(db, 95) - 32
    v = db > thr
    # close gaps shorter than 90 ms, drop blips shorter than 40 ms
    segs, i, n = [], 0, len(v)
    while i < n:
        if v[i]:
            j = i
            while j < n and v[j]:
                j += 1
            segs.append([i, j])
            i = j
        else:
            i += 1
    merged: list[list[int]] = []
    for s in segs:
        if merged and s[0] - merged[-1][1] < 9:
            merged[-1][1] = s[1]
        else:
            merged.append(s)
    return [(a * 0.01, b * 0.01) for a, b in merged if b - a >= 4]


def speech_before(t: float, segs) -> float:
    return sum(max(0.0, min(b, t) - a) for a, b in segs)


def time_at_speech(target: float, segs) -> float:
    acc = 0.0
    for a, b in segs:
        if acc + (b - a) >= target:
            return a + (target - acc)
        acc += b - a
    return segs[-1][1] if segs else 0.0


def main():
    pairs = sorted(beats_used())
    out: dict[str, dict[str, float]] = {}
    report = []
    for lid, f in pairs:
        old_p, new_p = SCRATCH / f"{lid}.wav", FINAL / f"{lid}.wav"
        if not (old_p.exists() and new_p.exists()):
            continue
        xo, sro = load(old_p)
        xn, srn = load(new_p)
        do, dn = len(xo) / sro, len(xn) / srn
        so, sn = voiced_segments(xo, sro), voiced_segments(xn, srn)
        to, tn_tot = sum(b - a for a, b in so), sum(b - a for a, b in sn)
        f_ref = REF.get(lid, {}).get(f, float(f)) if isinstance(REF.get(lid), dict) else float(f)
        t_old = f_ref * do
        nxt = [a for a, _ in so if a >= t_old - 0.02]
        if nxt and nxt[0] - t_old <= SNAP and so and sn:
            onset, lead = nxt[0], nxt[0] - t_old
            r = speech_before(onset, so) / max(1e-6, to)
            dr, o_new = min((abs(speech_before(a, sn) / max(1e-6, tn_tot) - r), a) for a, _ in sn)
            if dr <= MAX_DR:
                t_new, how = max(0.0, o_new - lead), "onset"
            else:  # the new voice has no pause there: place it by speech share instead
                t_new, how = max(0.0, time_at_speech(r * tn_tot, sn) - lead), "speech*"
        else:
            r = speech_before(t_old, so) / max(1e-6, to)
            t_new, how = time_at_speech(r * tn_tot, sn), "speech"
        f_new = round(min(0.99, t_new / dn), 3)
        out.setdefault(lid, {})[f] = f_new
        report.append(f"{lid} {f:>5} -> {f_new:.3f}  ({how}; ref {f_ref:.2f}, {do:.2f}s -> {dn:.2f}s)")
    name = "beats_hi.json" if LANG == "hi" else "beats_en.json"
    doc = (f"Word-position fractions re-synced to the final {LANG} voiceover by tools/align_beats.py. "
           "Fraction X of line ID becomes the value here (video: beatFrac, score: fr).")
    (ROOT / "script" / name).write_text(json.dumps({"_doc": doc, **{k: out[k] for k in sorted(out)}}, ensure_ascii=False, indent=1) + "\n")
    print("\n".join(report))
    print(f"wrote script/{name} ({len(report)} beats)")


if __name__ == "__main__":
    main()
