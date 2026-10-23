"""Original score for "Who really pays for your 'free' UPI?" — composed in code, synced to music/cues.json.

Style brief: Zimmer-inspired *techniques* (ticking clock, Shepard tone, ostinato strings,
low brass "braams", organ), all original material. Key: D minor, 120 BPM grid.

Writes music/render/score.wav (music) and music/render/sfx.wav (sound design).
usage: python -I music/score.py [VSCO_DIR] [--lang en]
"""
from __future__ import annotations

import json
import os
import pathlib
import sys

import numpy as np
import pedalboard as pb
import soundfile as sf

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from engine import (  # noqa: E402
    SFZ, SR, Bus, adsr, braam, fade, heartbeat, impact, load_wav, lp, nn, pad, riser, secs, shepard,
    stamp_thud, sub_boom, supersaw, tick, typewriter_click, whoosh,
)

ROOT = pathlib.Path(__file__).resolve().parent.parent
LANG = "en" if "--lang" in sys.argv and sys.argv[sys.argv.index("--lang") + 1] == "en" else "hi"
SFX = "" if LANG == "hi" else "_en"
_pos = [a for a in sys.argv[1:] if not a.startswith("--") and a not in ("en", "hi")]
VSCO = pathlib.Path(_pos[0] if _pos else os.environ.get("VSCO_DIR", "/home/user/sgossner/vsco-2-ce"))
FPS = 30
cues = json.loads((ROOT / "music" / f"cues{SFX}.json").read_text())
T = cues["seconds"] + 4
SEG = {s["id"]: s for s in cues["segments"]}
LINE = {l["id"]: l for s in cues["segments"] for l in s["lines"]}


def at(seg: str) -> float:
    return SEG[seg]["t"]


def end(seg: str) -> float:
    return SEG[seg]["t"] + SEG[seg]["dur"]


BEATS_EN = json.loads((ROOT / "script" / "beats_en.json").read_text()) if LANG == "en" else {}


def fr(lid: str, frac: float) -> float:
    """Word-position fraction, with the English override table in the English edition (same as the video)."""
    return BEATS_EN.get(lid, {}).get(str(frac), frac) if isinstance(BEATS_EN.get(lid), dict) else frac


def lt(lid: str, frac: float = 0.0, frames: float = 0.0) -> float:
    """Time of a line (+ fraction of its duration, + frames) — mirrors the TSX timing formulas."""
    l = LINE[lid]
    return round(l["t"] + l["dur"] * fr(lid, frac) + frames / FPS, 4)


def lend(lid: str) -> float:
    return LINE[lid]["t"] + LINE[lid]["dur"]


# ------------------------------------------------------------------ instruments
_inst: dict[str, SFZ] = {}


def I(name: str) -> SFZ:
    if name not in _inst:
        _inst[name] = SFZ(VSCO / f"{name}.sfz")
    return _inst[name]


strings, brass, perc, keys, synth, sfx = (Bus(T) for _ in range(6))


def play(bus: Bus, inst: str, note, t: float, dur: float, vel=80, gain=1.0, pan=0.0, release=0.8, attack=0.0):
    n = nn(note) if isinstance(note, str) else note
    y = I(inst).render(n, int(vel), dur, release=release, attack=attack)
    bus.add(t, y, gain, pan)


def chord(bus, inst, notes, t, dur, vel=70, gain=1.0, release=1.2, attack=0.0, spread=0.6):
    for i, n in enumerate(notes):
        pan = (i / max(1, len(notes) - 1) - 0.5) * spread
        play(bus, inst, n, t, dur, vel, gain / max(1, len(notes)) ** 0.5, pan, release, attack)


CH = {  # voicings
    "Dm": ["D2", "A2", "D3", "F3", "A3", "D4", "F4"],
    "Bb": ["Bb1", "F2", "Bb2", "D3", "F3", "Bb3", "D4"],
    "F": ["F2", "C3", "F3", "A3", "C4", "F4", "A4"],
    "C": ["C2", "G2", "C3", "E3", "G3", "C4", "E4"],
    "Gm": ["G1", "D2", "G2", "Bb2", "D3", "G3", "Bb3"],
    "A": ["A1", "E2", "A2", "C#3", "E3", "A3", "C#4"],
    "Dm/C": ["C2", "A2", "D3", "F3", "A3", "D4", "F4"],
    "Bbmaj7": ["Bb1", "F2", "D3", "F3", "A3", "D4"],
    "Dsus2": ["D2", "A2", "D3", "E3", "A3", "D4", "E4"],
}
PROG_A = ["Dm", "Bb", "F", "C"]
PROG_B = ["Dm", "Dm/C", "Bb", "A"]
PROG_C = ["Bb", "F", "C", "Dm"]
ROOTS = {"Dm": "D", "Bb": "Bb", "F": "F", "C": "C", "Gm": "G", "A": "A", "Dm/C": "C", "Bbmaj7": "Bb", "Dsus2": "D"}


def low(ch: str, octv=2):
    return f"{ROOTS[ch]}{octv}"


def string_pad(t0, t1, prog, bar=4.0, vel=60, gain=1.0, sections=("CelloEnsSusVib", "ViolaEnsSusVib", "ViolinEnsSusVib", "ContrabassSusVB")):
    t, i = t0, 0
    while t < t1 - 0.25:
        ch = prog[i % len(prog)]
        d = min(bar, t1 - t)
        notes = CH[ch]
        for inst in sections:
            lo_, hi_ = min(r["_lo"] for r in I(inst).regions), max(r["_hi"] for r in I(inst).regions)
            sel = [n for n in notes if lo_ <= nn(n) <= hi_][:3]
            if inst.startswith("Contrabass"):
                sel = [low(ch, 1) if nn(low(ch, 1)) >= lo_ else low(ch, 2)]
            for k, n in enumerate(sel):
                play(strings, inst, n, t, d + 0.3, vel, gain * 0.55, (k - 1) * 0.4, release=1.6, attack=0.35)
        t += bar
        i += 1


def ostinato(t0, t1, prog, step=0.125, bar=2.0, vel=78, gain=1.0, insts=("CelloEnsSpic", "ViolaEnsSpic"), shape=(0, 0, 7, 0, 12, 0, 7, 0)):
    t, k = t0, 0
    while t < t1 - 1e-3:
        ch = prog[int((t - t0) // bar) % len(prog)]
        root = nn(low(ch, 3))
        iv = shape[k % len(shape)]
        accent = 1.0 if k % 4 == 0 else 0.78
        for j, inst in enumerate(insts):
            play(strings, inst, root + iv + (12 if j == 1 else 0), t, step * 0.9, vel * accent, gain * 0.5, (-0.3 if j == 0 else 0.3), release=0.25)
        t += step
        k += 1


def ticks(t0, t1, step=0.5, gain=0.35):
    t, k = t0, 0
    while t < t1 - 1e-3:
        sfx.add(t, tick(accent=(k % 4 == 0)), gain)
        t += step
        k += 1


def hit(t, gain=0.8, cym=True, timp="D2"):
    synth.add(t, impact(3.5), gain * 0.9)
    if timp:
        play(perc, "Timpani", timp, t, 2.0, 120, gain * 1.2, release=3)
    bd = VSCO / "Percussion" / "BDrumNewhit_v7_rr1_Sum.wav"
    if bd.exists():
        perc.add(t, load_wav(str(bd)), gain * 0.9)
    if cym:
        c = VSCO / "VSCO 1 Percussion" / "cymbal-crash1_ff.wav"
        if c.exists():
            perc.add(t, load_wav(str(c)), gain * 0.45, 0.2)


def big_braam(t, notes=("D1", "A1", "D2", "F2"), dur=5.0, gain=0.7):
    synth.add(t, braam(list(notes), dur), gain)
    for n, inst in (("D1", "TubaSus"), ("D2", "TromboneSus"), ("A2", "TromboneSus"), ("D3", "FHornSus"), ("F3", "FHornSus"), ("A3", "FHornSus")):
        if inst == "TubaSus" and nn(n) < min(r["_lo"] for r in I(inst).regions):
            n = "D2"
        play(brass, inst, n, t, dur * 0.7, 120, gain * 0.55, release=1.8)


def pre_suck(t, dur=1.2, gain=0.5):
    """Reverse-swell into a hit (the classic inhale before the BRAAM)."""
    r = riser(dur, 300, 7000)
    synth.add(t - dur, r, gain)


def motif(bus, inst, t, octv=4, vel=70, gain=1.0, beat=0.5, var=False):
    """Original 4-note motif: D – F – E – A (descending fourth answer)."""
    seq = [("D", 4), ("F", 2), ("E", 2), ("A", 8)] if not var else [("D", 4), ("F", 2), ("E", 2), ("C", 2), ("A", 6)]
    tt = t
    for note, beats in seq:
        o = octv - 1 if note == "A" and not var else octv
        if var and note in ("C", "A"):
            o = octv
        play(bus, inst, f"{note}{o}", tt, beats * beat, vel, gain, release=1.5)
        tt += beats * beat


def harp_gliss(t, notes=("D4", "F4", "A4", "D5", "F5", "A5", "D6"), step=0.045, gain=0.5):
    for i, n in enumerate(notes):
        play(keys, "Harp", n, t + i * step, 1.5, 85, gain, (i / len(notes) - 0.5), release=2.0)


def whoosh_at(t, gain=0.35, dur=0.9):
    sfx.add(t - dur * 0.6, whoosh(dur, dur * 0.6), gain)


def typewrite(t, text, gain=0.18):
    for i, ch in enumerate(text):
        if ch != " ":
            sfx.add(t + i * 1.6 / FPS, typewriter_click(), gain * (0.8 + 0.4 * ((i * 7) % 3) / 2))


# =============================================================== COMPOSITION
def cold_open():
    s = at("S00_ColdOpen")
    a, b, c, d, e, f, g = (lt(f"c0_0{i}") for i in range(1, 8))
    ticks(s + 0.0, e, 0.5, 0.42)
    sh = shepard(e - (s + 1.0) + 0.3, base_note=38)
    sh *= np.linspace(0.15, 1.0, len(sh)) ** 1.5
    synth.add(s + 1.0, sh, 0.16)
    # pulse
    t = a
    while t < e:
        synth.add(t, sub_boom(0.45, 80, 40), 0.32 if t < c else 0.4)
        t += 0.5 if t < c else 0.25
    string_pad(a, e, ["Dm"], bar=e - a, vel=55, gain=0.7)
    ostinato(b, e, PROG_A, step=0.125, bar=2.0, vel=82, gain=0.9)
    hit(b, 0.45, cym=False)
    hit(c, 0.5, cym=False, timp="A1" if False else "D2")
    whoosh_at(c, 0.4)
    paid = c + (lend("c0_03") - c) * fr("c0_03", 0.72)
    play(keys, "Glockenspiel", "A5", paid, 1.2, 100, 0.55)
    play(keys, "Glockenspiel", "D6", paid + 0.09, 1.2, 100, 0.55)
    # FREE
    hit(d, 0.7, cym=True)
    chord(brass, "FHornSus", ["D3", "F3", "A3"], d, 0.6, 115, 0.9)
    sfx.add(d + 8 / FPS, stamp_thud(), 0.5)
    sfx.add(d + (lend("c0_04") - d) * fr("c0_04", 0.45), stamp_thud(), 0.5)
    # "लेकिन..." — the floor drops out
    synth.add(e, sub_boom(4.0, 60, 28), 0.8)
    synth.add(e, braam(["D1", "A1"], 4.0, bright=0.4), 0.35)
    synth.add(e, pad(["D2", "A2", "D3"], f - e + 1.0, bright=0.08), 0.35)
    # the endless bill: heartbeat + dark low strings
    t = f
    while t < g - 0.3:
        synth.add(t, heartbeat(), 0.45)
        t += 0.9
    for n, inst in (("Bb1", "ContrabassSusVB"), ("D2", "CelloEnsTrem"), ("F2", "CelloEnsTrem")):
        lo_ = min(r["_lo"] for r in I(inst).regions)
        play(strings, inst, n if nn(n) >= lo_ else "D2", f, g - f, 70, 0.6, release=0.8, attack=0.6)
    # silence on "कौन?", then the inhale into the title
    pre_suck(at("S01_Title"), 1.3, 0.45)


def title_and_disclaimer():
    t = at("S01_Title")
    big_braam(t, dur=6.0, gain=0.85)
    hit(t, 0.9)
    play(perc, "TimpaniRolls", "D2", t + 0.05, 3.0, 110, 0.6, release=2)
    string_pad(t + 0.5, end("S02_Disclaimer") + 1.0, ["Dm"], bar=8, vel=50, gain=0.5, sections=("CelloEnsSusVib", "ContrabassSusVB"))
    play(strings, "SViolinVib", "A5", at("S02_Disclaimer"), 3.2, 45, 0.35, attack=0.8)


def chapter_cards():
    for cid in ("c1", "c2", "c3", "c4"):
        t = at(f"CH_{cid}")
        pre_suck(t, 1.0, 0.35)
        hit(t, 0.65, cym=True, timp="D2")
        play(brass, "FHornSus", "D3", t, 2.6, 95, 0.7, release=2)
        play(brass, "TromboneSus", "D2", t, 2.6, 95, 0.6, release=2)
        if cid == "c1":
            chord(keys, "OrganQuiet", ["D3", "F3", "A3", "D4"], t + 0.3, 3.0, 70, 0.6, attack=0.6)
        if cid == "c2":
            play(strings, "CelloEnsTrem", "D2", t + 0.2, 3.0, 70, 0.6, attack=0.5)
        if cid == "c4":
            synth.add(t + 0.2, pad(["D3", "A3", "D4", "F4"], 3.4, bright=0.15), 0.35)


def chapter1():
    t0, t1 = at("S11_ThreeParts"), end("S16_PledgeEnd")
    # organ + strings bed through the chapter (wonder)
    tt, i = t0, 0
    while tt < at("S15_Explosion") - 0.2:
        ch = PROG_A[i % 4]
        chord(keys, "OrganQuiet", [n for n in CH[ch] if 48 <= nn(n) <= 72][:4], tt, 4.0, 62, 0.5, attack=0.8, release=1.5)
        tt += 4.0
        i += 1
    string_pad(at("S13_Launch"), at("S15_Explosion"), PROG_A, bar=4.0, vel=50, gain=0.55)
    motif(keys, "UprightPiano", lt("c1_02"), octv=5, vel=62, gain=0.7)
    # QR reveal
    rv = lt("c1_03", 0.62)
    harp_gliss(rv - 0.3)
    play(keys, "Glockenspiel", "D6", rv, 2.0, 100, 0.5)
    synth.add(rv, sub_boom(2.0, 70, 35), 0.4)
    # 21 banks: ascending glock pings
    lit0 = lt("c1_04", 0.45)
    lit_len = LINE["c1_04"]["dur"] * fr("c1_04", 0.5)
    scale = ["D5", "E5", "F5", "G5", "A5", "Bb5", "C6"]
    for k in range(21):
        play(keys, "Glockenspiel" if k % 3 else "Harp", scale[k % 7], lit0 + k * lit_len / 21, 0.6, 70, 0.18, (k / 21 - 0.5))
    # pizzicato pulse under the launch
    t = at("S13_Launch")
    while t < at("S15_Explosion") - 0.5:
        ch = PROG_A[int((t - at("S13_Launch")) // 4) % 4]
        play(strings, "CelloEnsPizz", low(ch, 3), t, 0.3, 70, 0.35, -0.2)
        play(strings, "ViolinEnsPizz", f"{ROOTS[ch]}4" if ROOTS[ch] != "Bb" else "Bb4", t + 0.25, 0.3, 60, 0.25, 0.3)
        t += 0.5
    # zero MDR
    zero = lt("c1_06", 0.82)
    sfx.add(zero, stamp_thud(), 0.55)
    chord(brass, "FHornSus", ["F3", "A3", "C4"], zero, 1.6, 100, 0.8)
    play(keys, "Glockenspiel", "F6", zero + 0.05, 1.2, 90, 0.35)
    # explosion
    burst = lend("c1_09") - 4 / FPS
    synth.add(lt("c1_09") - 0.2, riser(burst - lt("c1_09") + 0.2, 200, 6000), 0.45)
    hit(burst, 0.9)
    big_braam(burst, ("D1", "A1", "D2"), 4.0, 0.55)
    ostinato(burst, lt("c1_11", 0.4), PROG_A, step=0.125, bar=2.0, vel=96, gain=1.1, insts=("CelloEnsSpic", "ViolinEnsSpic"))
    ostinato(burst, lt("c1_11", 0.4), PROG_A, step=0.25, bar=2.0, vel=90, gain=0.8, insts=("ContrabassSpic", "ViolaEnsSpic"), shape=(0, 0, 0, 7))
    string_pad(burst, lend("c1_11") + 1, PROG_A, bar=2.0, vel=85, gain=0.8)
    motif(brass, "FHornSus", burst + 2.0, octv=4, vel=110, gain=1.0)
    motif(brass, "TromboneSus", burst + 2.0, octv=3, vel=100, gain=0.6)
    t = burst
    while t < lt("c1_11", 0.4):
        perc.add(t, load_wav(str(VSCO / "Percussion" / "BDrumNewhit_v5_rr1_Sum.wav")), 0.55)
        t += 1.0
    chord(keys, "OrganLoud", ["D3", "A3", "D4", "F4", "A4"], lt("c1_11"), lend("c1_11") - lt("c1_11") + 2, 80, 0.6, attack=0.4)
    # triad slams + doubt
    seg16 = SEG["S16_PledgeEnd"]
    base = lt("c1_12", 0.35)
    step = (lend("c1_12") - base) / 3
    for k in range(3):
        hit(base + k * step, 0.45, cym=k == 2, timp=["D2", "F2", "A2"][k])
        chord(brass, "FHornSus", [["D3", "F3", "A3"], ["F3", "A3", "C4"], ["A3", "D4", "F4"]][k], base + k * step, 0.8, 110, 0.7)
    dbt = lt("c1_13", 0.35)
    for n in ("C#5", "D5", "Eb5"):
        play(strings, "ViolinEnsTrem", n, dbt, end("S16_PledgeEnd") - dbt + 0.5, 60, 0.4, attack=1.2)
    synth.add(dbt, pad(["D2", "Ab2"], end("S16_PledgeEnd") - dbt + 1.0, bright=0.05), 0.4)


def chapter2():
    # S20 vanish
    go = lt("c2_01", 0.7)
    pre_suck(go, 1.4, 0.4)
    hit(go, 0.6, cym=True)
    whoosh_at(go + 0.4, 0.5, 1.4)
    for k, n in enumerate(("D6", "F6", "A6", "C7")):
        play(keys, "Glockenspiel", n if nn(n) <= 96 else "A6", go + 0.1 + k * 0.07, 1.5, 80, 0.25)
    bil = lt("c2_02", 0.55)
    sfx.add(bil, stamp_thud(), 0.5)
    play(brass, "TromboneSus", "Bb1" if nn("Bb1") >= 34 else "D2", bil, 1.8, 110, 0.8)
    whoosh_at(lend("c2_02") + 0.4, 0.4, 1.2)
    synth.add(at("S20_Vanish"), pad(["D2", "A2"], end("S20_Vanish") - at("S20_Vanish"), bright=0.06), 0.3)
    # S21 machine: synth bass pulse + spiccato, until the question
    t0 = at("S21_Machine")
    ask = lt("c2_05", 0.45)
    t, k = t0, 0
    while t < ask:
        ch = PROG_B[int((t - t0) // 4) % 4]
        n = nn(low(ch, 1))
        x = supersaw(n, 0.22, voices=3, detune=0.05)
        x = lp(x, 380) * adsr(len(x), a=0.005, d=0.05, s=0.7, r=0.08)
        synth.add(t, x, 0.55 if k % 2 == 0 else 0.4)
        t += 0.25
        k += 1
    ostinato(t0, ask, PROG_B, step=0.25, bar=4.0, vel=78, gain=0.8, insts=("CelloEnsSpic", "ViolaEnsSpic"), shape=(0, 12, 7, 12))
    string_pad(t0, ask + 0.5, PROG_B, bar=4.0, vel=55, gain=0.6)
    hit(ask, 0.6, cym=False)
    ticks(ask + 0.5, end("S21_Machine"), 0.5, 0.25)
    synth.add(ask, pad(["D2", "A2", "D3"], end("S21_Machine") - ask + 0.5, bright=0.05), 0.35)
    # S22 / S23: the subsidy and the gap
    t0, t1 = at("S22_Subsidy"), end("S23_Gap")
    string_pad(t0, t1, PROG_B, bar=4.0, vel=52, gain=0.55)
    t = t0
    while t < t1:
        play(keys, "UprightPiano", "D4", t, 1.8, 55, 0.4)
        play(keys, "UprightPiano", "A3", t + 1.0, 0.9, 45, 0.3)
        t += 2.0
    for i in range(3):
        bt = lt("c2_07", 0.22 + i * 0.25)
        play(perc, "Timpani", ["D2", "F2", "A2"][i], bt, 1.5, 95, 0.7)
        play(keys, "Glockenspiel", ["A5", "C6", "D6"][i], bt + 0.6, 1.0, 70, 0.25)
    fill = lt("c2_08", 0.82)
    synth.add(fill - 1.2, riser(1.2, 200, 3000), 0.25)
    play(brass, "TromboneSus", "D2", fill + 1.0, 2.5, 95, 0.6)
    # S24 memory: clock + music box
    t0, t1 = at("S24_Memory"), end("S24_Memory")
    ticks(t0, t1, 0.5, 0.3)
    synth.add(t0, pad(["D3", "A3", "F4"], t1 - t0, bright=0.08), 0.28)
    for k, st in enumerate((lt("c2_12"), lt("c2_13"), lt("c2_14"))):
        whoosh_at(st - 4 / FPS, 0.25, 0.7)
        if k < 2:
            motif(keys, "Glockenspiel", st + 0.4, octv=6, vel=62, gain=0.35, beat=0.35)
    rbi = lt("c2_14")
    pre_suck(rbi, 1.0, 0.35)
    big_braam(rbi, ("D1", "A1", "D2"), 4.5, 0.6)
    hit(rbi, 0.55, cym=False)
    play(keys, "TubularBells", "D5" if nn("D5") <= 79 else "D4", lt("c2_14", 0.75), 3.0, 90, 0.5)
    # S25 budget + ghost bill
    t0 = at("S25_Budget")
    string_pad(t0, end("S25_Budget"), ["Dm", "Bb"], bar=4.0, vel=50, gain=0.5, sections=("CelloEnsSusVib", "ContrabassSusVB"))
    play(perc, "Timpani", "A1" if nn("A1") >= 36 else "D2", lt("c2_15", 0.55), 1.5, 90, 0.6)
    synth.add(lt("c2_16"), riser(end("S25_Budget") - lt("c2_16"), 300, 4000), 0.22)
    for n in ("A5", "Bb5"):
        play(strings, "ViolinEnsTrem", n, lt("c2_16"), end("S25_Budget") - lt("c2_16"), 45, 0.3, attack=1.5)


def chapter3():
    t0 = at("CH_c3")
    quote = lt("c3_15")
    freeze = lend("c3_16") - 6 / FPS
    # ticking clock all chapter (double time in the countdown scene)
    ticks(t0, at("S34_Countdown"), 0.5, 0.38)
    ticks(at("S34_Countdown"), at("S35_Map"), 0.25, 0.4)
    ticks(at("S35_Map"), quote, 0.5, 0.38)
    ticks(at("S37_Deferral"), freeze, 0.25, 0.45)
    # Shepard tone: tension that never resolves
    for a_, b_, g0, g1 in ((at("S30_Law"), quote, 0.05, 0.16), (at("S37_Deferral"), freeze, 0.16, 0.24)):
        sh = shepard(b_ - a_, base_note=40)
        sh *= np.linspace(g0, g1, len(sh))
        synth.add(a_, sh, 1.0)
    # ostinato engine
    ostinato(at("S30_Law"), at("S32_Rules"), ["Dm"], step=0.25, bar=4.0, vel=78, gain=0.8, shape=(0, 0, 12, 0))
    ostinato(at("S32_Rules"), quote, PROG_B, step=0.125, bar=4.0, vel=88, gain=0.95)
    ostinato(at("S37_Deferral"), freeze, PROG_B, step=0.125, bar=2.0, vel=100, gain=1.05, insts=("CelloEnsSpic", "ViolinEnsSpic"))
    string_pad(at("S32_Rules"), quote, PROG_B, bar=4.0, vel=60, gain=0.6)
    t = at("S32_Rules")
    while t < quote:
        perc.add(t, load_wav(str(VSCO / "Percussion" / "BDrumNewhit_v4_rr1_Sum.wav")), 0.35)
        t += 1.0
    # law + documents
    sfx.add(lt("c3_01", 0.45), stamp_thud(), 0.5)
    play(brass, "FHornSus", "D3", lt("c3_01", 0.45), 1.2, 105, 0.6)
    whoosh_at(lt("c3_02"), 0.35)
    whoosh_at(lt("c3_02", 0.55), 0.35)
    # rules: a braam per rule
    for lid in ("c3_04", "c3_05", "c3_06", "c3_07", "c3_08"):
        synth.add(lt(lid, frames=-4), braam(["D1", "A1"], 2.2, bright=0.6), 0.4)
        play(perc, "Timpani", "D2", lt(lid, frames=-4), 1.5, 110, 0.6)
        whoosh_at(lt(lid, frames=-4), 0.25, 0.6)
    sfx.add(lt("c3_08", 0.62), stamp_thud(), 0.55)
    # revenue counter
    rc = lt("c3_09", 0.35)
    synth.add(rc - 1.2, riser(1.2, 300, 6000), 0.3)
    hit(rc, 0.5, cym=True)
    # survey donuts
    for x in (lt("c3_11", 0.35), lt("c3_12", 0.3)):
        play(perc, "Timpani", "A1" if nn("A1") >= 36 else "D2", x, 1.0, 95, 0.5)
        play(brass, "TromboneSus", "D2", x, 1.4, 95, 0.5)
    # map pins
    for x in (lt("c3_13", frames=30), lt("c3_13", 0.72)):
        synth.add(x, sub_boom(1.0, 90, 45), 0.4)
        play(keys, "Glockenspiel", "A5", x, 0.8, 80, 0.25)
    # court
    sfx.add(lt("c3_14", 0.42), stamp_thud(), 0.55)
    hit(quote, 0.55, cym=False)
    synth.add(quote, pad(["D2", "A2", "D3"], at("S37_Deferral") - quote + 0.5, bright=0.05), 0.4)
    play(strings, "CelloEnsTrem", "D2", quote, at("S37_Deferral") - quote, 60, 0.45, attack=0.4)
    # the freeze — everything stops dead
    synth.add(freeze - 0.9, riser(0.9, 600, 9000), 0.45)
    synth.add(freeze, sub_boom(3.0, 50, 25), 0.7)
    st = lt("c3_17", 0.18)
    hit(st, 0.6, cym=True)
    sfx.add(st, stamp_thud(), 0.6)
    # Diwali warmth: what's left after the countdown dies
    warm0 = st + 0.3
    warm1 = end("S37_Deferral") + 0.6
    chord(keys, "OrganQuiet", ["Bb2", "F3", "A3", "D4"], warm0, warm1 - warm0, 60, 0.5, attack=1.0)
    harp_gliss(lt("c3_17", 0.55), ("Bb3", "D4", "F4", "A4", "D5", "F5"), 0.06, 0.4)
    play(keys, "TubularBells", "F4" if nn("F4") >= 60 else "D5", lt("c3_17", 0.55), 3.0, 70, 0.35)


def chapter4():
    t0 = at("S40_Return")
    # organ + strings, PROG_C
    tt, i = t0, 0
    while tt < at("S41_WhoPays"):
        ch = PROG_C[i % 4]
        chord(keys, "OrganQuiet", [n for n in CH[ch] if 48 <= nn(n) <= 72][:4], tt, 4.0, 66, 0.55, attack=0.8, release=1.5)
        tt += 4.0
        i += 1
    string_pad(t0, at("S41_WhoPays"), PROG_C, bar=4.0, vel=58, gain=0.65)
    reform = lt("c4_02", 0.2, 20)
    synth.add(reform - 1.6, riser(1.6, 200, 5000), 0.3)
    harp_gliss(reform - 0.2)
    motif(brass, "FHornSus", reform, octv=4, vel=95, gain=0.85)
    sfx.add(lt("c4_04", 0.6), stamp_thud(), 0.55)
    # S41: the build
    a41 = at("S41_WhoPays")
    q = LINE["c4_06"]
    beats = [q["t"] + q["dur"] * fr("c4_06", k) for k in (0.3, 0.55, 0.8)]
    mirror = q["t"] + q["dur"] + 4 / FPS
    ostinato(lt("c4_05"), q["t"], ["Dm", "Bb"], step=0.25, bar=4.0, vel=78, gain=0.7, shape=(0, 12, 7, 12))
    string_pad(a41, mirror, ["Dm", "Bb", "Gm", "A"], bar=4.0, vel=65, gain=0.7)
    ostinato(q["t"], mirror, ["Dm", "Bb", "Gm", "A"], step=0.125, bar=2.0, vel=92, gain=1.0, insts=("CelloEnsSpic", "ViolinEnsSpic"))
    play(perc, "TimpaniRolls", "A1" if nn("A1") >= 36 else "D2", mirror - 3.0, 3.0, 90, 0.6, attack=2.5)
    synth.add(q["t"], pad(["D3", "A3", "D4", "F4"], mirror - q["t"], bright=0.2), 0.3)
    for k, b in enumerate(beats):
        hit(b, 0.45, cym=False, timp=["D2", "F2", "A2"][k])
        chord(brass, "FHornSus", [["D3", "F3", "A3"], ["F3", "Bb3", "D4"], ["A3", "C#4", "E4"]][k], b, 1.0, 110, 0.7)
    # CLIMAX — "आप"
    pre_suck(mirror, 1.2, 0.5)
    big_braam(mirror, ("D1", "A1", "D2", "F2"), 6.0, 0.9)
    hit(mirror, 1.0, cym=True)
    string_pad(mirror, mirror + 6.0, ["Dm"], bar=6.0, vel=100, gain=1.0)
    chord(keys, "OrganLoud", ["D3", "A3", "D4", "F4", "A4", "D5"], mirror, 6.0, 95, 0.8, attack=0.1)
    motif(strings, "ViolinEnsSusVib", mirror + 0.2, octv=5, vel=110, gain=0.9)
    # S42: the unanswered question — dominant suspension that never resolves
    a42, b42 = at("S42_Question"), end("S42_Question")
    string_pad(a42, b42, ["Gm", "A", "Gm", "A"], bar=4.0, vel=58, gain=0.6)
    t = a42
    while t < b42:
        play(strings, "ContrabassSpic", "A1" if nn("A1") >= 24 else "D2", t, 0.4, 75, 0.45)
        t += 1.0
    sfx.add(lt("c4_07", 0.3), whoosh(0.6, 0.3), 0.25)
    # S43: the spinning coin
    a43, black = at("S43_Coin"), at("BLACK")
    play(strings, "SViolinVib", "A5", a43 + 0.2, black - a43 - 0.3, 50, 0.45, attack=1.2, release=0.1)
    play(keys, "OrganQuietPedal", "D2" if nn("D2") >= 36 else "D3", a43, black - a43, 60, 0.6, attack=1.0, release=0.1)
    play(keys, "Glockenspiel", "D6", lt("c4_10"), 1.5, 70, 0.3)
    ticks(lt("c4_10"), black, 0.5, 0.25)


def outro():
    a = at("S50_Outro")
    e_ = end("S50_Outro")
    tt, i = a + 0.3, 0
    while tt < e_ - 2:
        ch = ["Dm", "Bb", "F", "C"][i % 4]
        chord(keys, "OrganQuiet", [n for n in CH[ch] if 50 <= nn(n) <= 69][:3], tt, 4.0, 52, 0.4, attack=1.0)
        tt += 4.0
        i += 1
    motif(keys, "UprightPiano", a + 1.0, octv=5, vel=58, gain=0.6)
    motif(keys, "UprightPiano", a + 9.0, octv=5, vel=52, gain=0.5, var=True)
    play(strings, "CelloEnsSusVib", "D3", a + 0.5, e_ - a - 1.5, 50, 0.4, attack=1.5)


def transitions():
    segs = cues["segments"]
    for prev, nxt in zip(segs, segs[1:]):
        if prev["kind"] == "scene" and nxt["kind"] == "scene":
            whoosh_at(nxt["t"], 0.22, 0.8)


def datelines():
    for lid, txt in (("c1_04", "AUG 2016"), ("c1_06", "01 JAN 2020"), ("c3_01", "AUG 2026"), ("c3_02", "14 SEP 2026"), ("c3_14", "28 SEP 2026"), ("c3_16", "13 OCT 2026")):
        typewrite(lt(lid), txt)


# ================================================================== RENDER
def chain(*plugins):
    return pb.Pedalboard(list(plugins))


def process(bus: Bus, board: pb.Pedalboard) -> np.ndarray:
    return board(bus.buf.T, SR).T.astype(np.float32)


def main():
    print("composing…", flush=True)
    for fn in (cold_open, title_and_disclaimer, chapter_cards, chapter1, chapter2, chapter3, chapter4, outro, transitions, datelines):
        fn()
        print(" ", fn.__name__, flush=True)
    hall = dict(room_size=0.88, damping=0.45, width=1.0)
    s = process(strings, chain(pb.HighpassFilter(45), pb.Reverb(**hall, wet_level=0.32, dry_level=0.78), pb.Compressor(-18, 2.0, 30, 250)))
    b = process(brass, chain(pb.HighpassFilter(35), pb.Reverb(**hall, wet_level=0.36, dry_level=0.75), pb.Compressor(-16, 2.5, 20, 200)))
    p = process(perc, chain(pb.Reverb(room_size=0.8, damping=0.5, wet_level=0.25, dry_level=0.85), pb.Compressor(-14, 3.0, 5, 150)))
    k = process(keys, chain(pb.HighpassFilter(60), pb.Reverb(room_size=0.92, damping=0.35, wet_level=0.42, dry_level=0.7)))
    y = process(synth, chain(pb.HighpassFilter(24), pb.Reverb(room_size=0.7, damping=0.5, wet_level=0.15, dry_level=0.95), pb.Compressor(-14, 2.5, 10, 200)))
    music = s * 1.0 + b * 0.9 + p * 0.85 + k * 0.8 + y * 0.9
    music = chain(pb.HighpassFilter(28), pb.Compressor(-16, 2.2, 25, 220), pb.Limiter(-1.5, 300))(music.T, SR).T
    fx = chain(pb.Reverb(room_size=0.5, damping=0.6, wet_level=0.12, dry_level=0.95))(sfx.buf.T, SR).T
    # hard silence on the cut to black (the coin never lands)
    for arr in (music, fx):
        b0, b1 = secs(at("BLACK")), secs(at("BLACK") + SEG["BLACK"]["dur"])
        arr[b0:b1] = 0
        arr[b0 - secs(0.01) : b0] *= np.linspace(1, 0, secs(0.01))[:, None]
    n = secs(cues["seconds"])
    out = ROOT / "music" / "render"
    out.mkdir(exist_ok=True)
    sf.write(out / f"score{SFX}.wav", fade(music[:n], 0.0, 1.5), SR, subtype="PCM_24")
    sf.write(out / f"sfx{SFX}.wav", fx[:n], SR, subtype="PCM_24")
    print("wrote", out / f"score{SFX}.wav", out / f"sfx{SFX}.wav")


if __name__ == "__main__":
    main()
