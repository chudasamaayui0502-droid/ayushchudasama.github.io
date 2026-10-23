"""Transition sound design — one clean, matched sound per cut style (see video/src/components/Transitions.tsx).

Every function returns (stereo audio [n, 2], anchor seconds): the anchor is the moment the cut reads on
screen, so the caller places it with  bus.add(t_cut - anchor, audio, gain).

Built from shaped pink noise through smoothly swept ladder filters (state kept between blocks, so no
zipper noise), equal-power pan automation, and a few CC0 orchestral samples from VSCO-2-CE
(reversed cymbal, bell tree, rubbed bass drum, glass) — no third-party SFX libraries.
"""
from __future__ import annotations

import math
import pathlib

import numpy as np
import pedalboard as pb
from scipy.signal import butter, sosfilt

from engine import SR, bp, hp, load_wav, lp, secs, sub_boom

VSCO = pathlib.Path("/home/user/sgossner/vsco-2-ce")


def init(vsco: pathlib.Path):
    global VSCO
    VSCO = pathlib.Path(vsco)


def _sample(rel: str) -> np.ndarray:
    return load_wav(str(VSCO / rel)).copy()


def smooth(x: np.ndarray, hz: float, order=6) -> np.ndarray:
    """Steep low-pass: keeps every sound free of hiss above `hz` (the 'clean' in clean)."""
    sos = butter(order, hz, btype="low", fs=SR, output="sos")
    return sosfilt(sos, x, axis=0).astype(np.float32)


def pink(n: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    X = np.fft.rfft(rng.normal(0, 1, n))
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    y = np.fft.irfft(X / np.sqrt(f), n)
    return (y / (np.std(y) + 1e-9)).astype(np.float32)


def curve(n: int, pts: list[tuple[float, float]], log=True) -> np.ndarray:
    """Piecewise curve over n samples from (fraction, value) points, interpolated in log space for Hz."""
    xs = np.array([p[0] for p in pts]) * (n - 1)
    vs = np.array([p[1] for p in pts], dtype=np.float64)
    i = np.arange(n)
    if log:
        return np.exp(np.interp(i, xs, np.log(vs)))
    return np.interp(i, xs, vs)


def swept(x: np.ndarray, cutoff: np.ndarray, mode=pb.LadderFilter.Mode.BPF12, res=0.3, block=128) -> np.ndarray:
    """Time-varying ladder filter (state carried across blocks)."""
    f = pb.LadderFilter(mode=mode, cutoff_hz=float(cutoff[0]), resonance=res)
    out = np.zeros_like(x)
    for i in range(0, len(x), block):
        f.cutoff_hz = float(min(cutoff[min(i + block // 2, len(cutoff) - 1)], SR * 0.45))
        out[i : i + block] = f.process(x[i : i + block][None, :], SR, reset=False)[0]
    return out


def swell_env(n: int, peak: float, rise=2.2, tau=0.08) -> np.ndarray:
    t = np.arange(n) / SR
    up = np.clip(t / peak, 0, 1) ** rise
    down = np.exp(-np.clip(t - peak, 0, None) / tau)
    return np.where(t < peak, up, down).astype(np.float32)


def pan_to_stereo(x: np.ndarray, pan: np.ndarray) -> np.ndarray:
    a = (np.clip(pan, -1, 1) + 1) * math.pi / 4
    return np.stack([x * np.cos(a) * 1.414, x * np.sin(a) * 1.414], axis=1).astype(np.float32)


def space(x: np.ndarray, room=0.35, wet=0.14) -> np.ndarray:
    return pb.Pedalboard([pb.Reverb(room_size=room, damping=0.55, wet_level=wet, dry_level=1.0, width=1.0)])(x.T.copy(), SR).T.astype(np.float32)


def norm(x: np.ndarray, peak=0.9) -> np.ndarray:
    m = float(np.max(np.abs(x))) or 1.0
    return (x * (peak / m)).astype(np.float32)


def place(dst: np.ndarray, at: float, src: np.ndarray, gain=1.0):
    s = secs(at)
    e = min(len(dst), s + len(src))
    if e > s >= 0:
        dst[s:e] += src[: e - s] * gain


def thump(dur=0.09, f0=150.0, f1=90.0) -> np.ndarray:
    n = secs(dur)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t * 40)
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 38)).astype(np.float32)


def reverse_cymbal(length: float, dyn="mp", lowpass=6500.0, seed_rr=1) -> np.ndarray:
    """A crash cymbal played backwards — swells up to a sudden stop (lands on the cut)."""
    c = _sample(f"Percussion/cymbal-crash1_{dyn}_rr{seed_rr}.wav")
    c = c[: secs(length + 0.4)]
    c = space(c, room=0.8, wet=0.35)[: secs(length)]
    c = hp(smooth(c, lowpass), 250)
    r = c[::-1].copy()
    r *= (np.linspace(0, 1, len(r)) ** 1.6)[:, None]
    r[-secs(0.004):] *= np.linspace(1, 0, secs(0.004))[:, None]
    return r.astype(np.float32)


# --------------------------------------------------------------------------- the six cuts


def whip(direction=1, dur=0.46, peak=0.25, seed=11):
    """Tight air swish that travels across the stereo field with the pan."""
    n = secs(dur)
    x = pink(n, seed)
    body = swept(x, curve(n, [(0, 550), (peak / dur, 3400), (1, 1300)]), res=0.42)
    env = swell_env(n, peak, rise=2.6, tau=0.07)
    mono = smooth(body, 8500) * env
    p = curve(n, [(0, -0.75 * direction), (peak / dur, 0.0), (1, 0.75 * direction)], log=False)
    out = pan_to_stereo(mono, p)
    place(out, peak - 0.005, np.repeat(thump(0.08, 140, 85)[:, None], 2, 1), 0.22)
    return norm(smooth(space(out, 0.3, 0.12), 9500), 0.85), peak


def zoom(pre=0.95, post=1.1):
    """Reverse-cymbal swell into a soft, deep landing — the zoom-through."""
    rc = reverse_cymbal(pre, "mp", lowpass=5200)
    n = secs(pre + post)
    out = np.zeros((n, 2), np.float32)
    place(out, 0, rc, 0.8)
    t = np.arange(secs(post)) / SR
    sub = (np.sin(2 * np.pi * np.cumsum(38 + 22 * np.exp(-t * 7)) / SR) * np.exp(-t * 3.2)).astype(np.float32)
    felt = lp(pink(len(t), 23), 900) * np.exp(-t * 45) * 0.45
    land = np.repeat((sub * 0.9 + felt)[:, None], 2, 1)
    place(out, pre, land, 0.75)
    return norm(smooth(space(out, 0.55, 0.16), 8000), 0.85), pre


def panel(direction=1, dur=0.42, peak=0.2, seed=41):
    """Crisp graphic slide + a soft wooden 'thock' as the panel lands."""
    n = secs(dur)
    body = swept(pink(n, seed), curve(n, [(0, 1300), (peak / dur, 5600), (1, 2600)]), res=0.22)
    env = swell_env(n, peak, rise=1.8, tau=0.045)
    p = curve(n, [(0, -0.6 * direction), (1, 0.6 * direction)], log=False)
    out = pan_to_stereo(body * env * 0.8, p)
    k = thump(0.1, 210, 120)
    click = bp(pink(secs(0.01), seed + 3), 2500, 9000) * np.exp(-np.arange(secs(0.01)) / SR * 600)
    place(out, peak, np.repeat(k[:, None], 2, 1), 0.5)
    place(out, peak, np.repeat(click[:, None], 2, 1), 0.25)
    return norm(smooth(space(out, 0.25, 0.1), 10000), 0.8), peak


def glitch(dur=0.34, seed=61):
    """Digital stutter: gated blips and crushed noise, then a downward zap."""
    rng = np.random.default_rng(seed)
    n = secs(dur)
    out = np.zeros((n, 2), np.float32)
    t0 = 0.0
    notes = [880.0, 1174.7, 1568.0, 1760.0, 2349.3]
    crush = pb.Pedalboard([pb.Bitcrush(bit_depth=5), pb.HighpassFilter(400)])
    k = 0
    while t0 < 0.2:
        L = rng.uniform(0.014, 0.03)
        m = secs(L)
        tt = np.arange(m) / SR
        if k % 2 == 0:
            f = notes[rng.integers(len(notes))]
            s = np.sign(np.sin(2 * np.pi * f * tt)).astype(np.float32) * 0.28
        else:
            s = crush(rng.normal(0, 0.5, m).astype(np.float32)[None, :], SR)[0] * 0.5
        s *= np.minimum(1, np.minimum(tt / 0.002, (L - tt) / 0.002)).astype(np.float32)
        place(out, t0, pan_to_stereo(s, np.full(m, rng.uniform(-0.6, 0.6))))
        t0 += L + rng.uniform(0.004, 0.016)
        k += 1
    m = secs(0.12)
    tt = np.arange(m) / SR
    zap = np.sin(2 * np.pi * np.cumsum(120 + 1700 * np.exp(-tt * 30)) / SR) * np.exp(-tt * 22) * 0.45
    place(out, 0.1, np.repeat(zap.astype(np.float32)[:, None], 2, 1))
    place(out, 0.1, np.repeat(thump(0.07, 110, 60)[:, None], 2, 1), 0.4)
    return norm(smooth(hp(out, 120), 9000), 0.75), 0.11


def light(pre=0.95, post=1.3):
    """Bell-tree shimmer swelling into the white-out, with a warm bloom after it (glock notes added by the score)."""
    bt = _sample("Percussion/BellTree_Stroke3_v1_Sum.wav")[: secs(pre + 0.25)]
    bt = smooth(hp(bt, 1500), 11000)[::-1].copy()
    bt = bt[-secs(pre):] * (np.linspace(0, 1, secs(pre)) ** 1.3)[:, None]
    n = secs(pre + post)
    out = np.zeros((n, 2), np.float32)
    place(out, 0, bt, 0.7)
    air = smooth(hp(pink(n, 71), 3000), 9000) * swell_env(n, pre, rise=2.8, tau=0.25) * 0.05
    out += np.repeat(air[:, None], 2, 1)
    t = np.arange(secs(post)) / SR
    bloom = sum(np.sin(2 * np.pi * f * t) * a for f, a in ((293.66, 0.5), (440.0, 0.35), (587.33, 0.25)))
    bloom = (bloom * (1 - np.exp(-t * 30)) * np.exp(-t * 2.4)).astype(np.float32) * 0.06
    place(out, pre, np.repeat(bloom[:, None], 2, 1))
    return norm(smooth(space(out, 0.7, 0.25), 11000), 0.8), pre


def push3d(direction=1, dur=1.05, peak=0.58, seed=81):
    """Deep, weighty swoosh with a doppler body and a rubbed bass-drum rumble — the 3D push."""
    n = secs(dur)
    body = swept(pink(n, seed), curve(n, [(0, 260), (peak / dur, 1700), (1, 380)]), mode=pb.LadderFilter.Mode.LPF24, res=0.25)
    t = np.arange(n) / SR
    dop = np.sin(2 * np.pi * np.cumsum(curve(n, [(0, 200), (peak / dur, 150), (1, 82)])) / SR).astype(np.float32) * 0.22
    env = swell_env(n, peak, rise=2.0, tau=0.16)
    p = curve(n, [(0, -0.55 * direction), (1, 0.55 * direction)], log=False)
    out = pan_to_stereo((body * 0.9 + dop) * env, p)
    rub = _sample("Percussion/bassdrum_rub1_v1.wav")[: n]
    rub = lp(rub, 500) * swell_env(len(rub), peak, rise=1.5, tau=0.3)[:, None]
    place(out, 0, rub, 0.5)
    place(out, peak + 0.02, np.repeat(sub_boom(0.7, 64, 36)[:, None], 2, 1), 0.3)
    return norm(space(out, 0.45, 0.14), 0.85), peak


def dissolve(pre=0.8):
    """Barely-there air swell for the soft cut out of a chapter card."""
    rc = reverse_cymbal(pre, "pp", lowpass=4200)
    return norm(rc, 0.5), pre


# ----------------------------------------------------------------------- moments in the film


def swell(pre=1.2, dyn="mp"):
    """Reverse-cymbal inhale before a big hit (replaces the old noise riser)."""
    rc = reverse_cymbal(pre, dyn)
    n = len(rc)
    return norm(rc, 0.85), pre


def shatter(seed=101):
    """Glass breaking (two CC0 takes layered) with a low body — the word FREE cracks."""
    a = _sample("Miscellania Raw/Misc 1/glass_break.wav")
    b = _sample("Miscellania Raw/Misc 1/glass_break3.wav")
    n = max(len(a), len(b)) + secs(1.2)
    out = np.zeros((n, 2), np.float32)
    place(out, 0, a, 0.8)
    place(out, 0.012, b[:, ::-1], 0.6)
    place(out, 0, np.repeat(sub_boom(1.1, 90, 40)[:, None], 2, 1), 0.55)
    return norm(smooth(space(hp(out, 90), 0.6, 0.2), 12000), 0.9), 0.0


def shockwave(seed=111):
    """Air blast for a word that slams in: fast low-pass sweep down + sub."""
    n = secs(1.4)
    blast = swept(pink(n, seed), curve(n, [(0, 4200), (0.15, 900), (1, 120)]), mode=pb.LadderFilter.Mode.LPF24, res=0.1)
    blast *= np.exp(-np.arange(n) / SR * 3.2).astype(np.float32)
    out = np.repeat(blast[:, None], 2, 1) * 0.8
    place(out, 0, np.repeat(sub_boom(1.4, 70, 30)[:, None], 2, 1), 0.7)
    return norm(space(out, 0.6, 0.2), 0.9), 0.0


def data_shimmer(dur: float, seed=121, density=9.0):
    """Faint digital sparkle under the map of payments (tiny pentatonic pings, randomly panned)."""
    rng = np.random.default_rng(seed)
    n = secs(dur)
    out = np.zeros((n, 2), np.float32)
    notes = [1174.7, 1396.9, 1568.0, 1760.0, 2093.0, 2349.3, 2793.8]
    t = 0.0
    while t < dur - 0.2:
        m = secs(0.18)
        tt = np.arange(m) / SR
        f = notes[rng.integers(len(notes))]
        s = (np.sin(2 * np.pi * f * tt) * np.exp(-tt * 28) * (0.3 + 0.7 * rng.random())).astype(np.float32)
        place(out, t, pan_to_stereo(s, np.full(m, rng.uniform(-0.8, 0.8))))
        t += rng.exponential(1 / density)
    ramp = np.linspace(0.3, 1, n)[:, None]
    return (space(out * ramp, 0.7, 0.3) * 0.5).astype(np.float32), 0.0


CUTS = {"whip": whip, "zoom": zoom, "panel": panel, "glitch": glitch, "light": light, "push3d": push3d, "dissolve": dissolve}


def cut_sound(kind: str, direction=1):
    fn = CUTS[kind]
    if kind in ("whip", "panel", "push3d"):
        return fn(direction=direction)
    return fn()
