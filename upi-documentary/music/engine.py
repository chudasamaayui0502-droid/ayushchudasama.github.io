"""Small offline scoring engine: SFZ sampler (VSCO-2-CE), synth voices and sound design.

Everything renders into numpy stereo buffers at 48 kHz. Deterministic (seeded noise).
"""
from __future__ import annotations

import math
import pathlib
import re
from functools import lru_cache

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, resample_poly

SR = 48000
RNG = np.random.default_rng(20261023)


def secs(n: float) -> int:
    return int(round(n * SR))


def midi_hz(n: float) -> float:
    return 440.0 * 2 ** ((n - 69) / 12)


NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def nn(name: str) -> int:
    """'D3' -> 50, 'Bb2' -> 46, 'F#4' -> 66"""
    m = re.fullmatch(r"([A-G])([b#]?)(-?\d)", name)
    if not m:
        raise ValueError(name)
    v = NOTE[m.group(1)] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)
    return v + 12 * (int(m.group(3)) + 1)


class Bus:
    """A stereo track buffer."""

    def __init__(self, seconds: float):
        self.buf = np.zeros((secs(seconds) + SR * 8, 2), dtype=np.float32)

    def add(self, t: float, audio: np.ndarray, gain: float = 1.0, pan: float = 0.0):
        if audio.ndim == 1:
            l = math.cos((pan + 1) * math.pi / 4)
            r = math.sin((pan + 1) * math.pi / 4)
            audio = np.stack([audio * l * 1.414, audio * r * 1.414], axis=1)
        s = secs(t)
        if s < 0:
            audio = audio[-s:]
            s = 0
        e = min(len(self.buf), s + len(audio))
        if e > s:
            self.buf[s:e] += audio[: e - s] * gain


# --------------------------------------------------------------------- envelopes


def adsr(n: int, a=0.01, d=0.1, s=0.8, r=0.3, sustain_len=None) -> np.ndarray:
    a_n, d_n, r_n = secs(a), secs(d), secs(r)
    hold = n - a_n - d_n - r_n if sustain_len is None else secs(sustain_len)
    hold = max(0, hold)
    env = np.concatenate(
        [
            np.linspace(0, 1, max(1, a_n), endpoint=False),
            np.linspace(1, s, max(1, d_n), endpoint=False),
            np.full(hold, s),
            np.linspace(s, 0, max(1, r_n)),
        ]
    )
    if len(env) < n:
        env = np.pad(env, (0, n - len(env)))
    return env[:n].astype(np.float32)


def fade(x: np.ndarray, fin=0.005, fout=0.05) -> np.ndarray:
    x = x.copy()
    a, b = secs(fin), secs(fout)
    if a:
        x[:a] *= np.linspace(0, 1, a)[:, None] if x.ndim == 2 else np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)[:, None] if x.ndim == 2 else np.linspace(1, 0, b)
    return x


def lp(x: np.ndarray, hz: float, order=2) -> np.ndarray:
    sos = butter(order, min(hz, SR * 0.45), btype="low", fs=SR, output="sos")
    return sosfilt(sos, x, axis=0).astype(np.float32)


def hp(x: np.ndarray, hz: float, order=2) -> np.ndarray:
    sos = butter(order, hz, btype="high", fs=SR, output="sos")
    return sosfilt(sos, x, axis=0).astype(np.float32)


def bp(x: np.ndarray, lo: float, hi: float, order=2) -> np.ndarray:
    sos = butter(order, [lo, min(hi, SR * 0.45)], btype="band", fs=SR, output="sos")
    return sosfilt(sos, x, axis=0).astype(np.float32)


# ------------------------------------------------------------------------ synths


def saw(freq, n, phase=0.0):
    t = np.arange(n) / SR
    return (2 * ((t * freq + phase) % 1.0) - 1).astype(np.float32)


def sine(freq, n, phase=0.0):
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * freq * t + phase).astype(np.float32)


def supersaw(note: float, dur: float, voices=7, detune=0.18) -> np.ndarray:
    n = secs(dur)
    f = midi_hz(note)
    out = np.zeros(n, np.float32)
    for i in range(voices):
        cents = (i - (voices - 1) / 2) / ((voices - 1) / 2) * detune * 100
        out += saw(f * 2 ** (cents / 1200), n, phase=RNG.random())
    return out / voices


def braam(notes: list[str], dur: float = 5.0, bright: float = 1.0) -> np.ndarray:
    """The big low 'BRAAAM': detuned saws through a closing low-pass, saturated."""
    n = secs(dur)
    x = np.zeros(n, np.float32)
    for name in notes:
        x += supersaw(nn(name), dur, voices=7, detune=0.12)
    x /= max(1, len(notes))
    # time-varying low-pass: open fast, close slowly (chunked)
    out = np.zeros_like(x)
    chunk = secs(0.02)
    for i in range(0, n, chunk):
        t = i / SR
        cutoff = 180 + 2600 * bright * math.exp(-t * 1.6) + 300 * math.exp(-t * 0.4)
        seg = x[max(0, i - 2048) : i + chunk]
        filt = lp(seg, cutoff, order=2)
        out[i : i + chunk] = filt[-len(x[i : i + chunk]) :]
    out = np.tanh(out * 2.6)
    env = adsr(n, a=0.04, d=0.6, s=0.65, r=dur * 0.55)
    return out * env


def sub_boom(dur=2.5, start_hz=70.0, end_hz=32.0) -> np.ndarray:
    n = secs(dur)
    t = np.arange(n) / SR
    f = end_hz + (start_hz - end_hz) * np.exp(-t * 6)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 1.6)
    click = lp(RNG.normal(0, 1, n).astype(np.float32), 1800) * np.exp(-t * 60) * 0.5
    return np.tanh((body + click) * 1.6).astype(np.float32)


def impact(dur=3.0) -> np.ndarray:
    """Cinematic hit: sub boom + noise crack + long tail."""
    n = secs(dur)
    t = np.arange(n) / SR
    boom = sub_boom(dur)
    crack = bp(RNG.normal(0, 1, n).astype(np.float32), 200, 6000) * np.exp(-t * 18) * 0.6
    tail = lp(RNG.normal(0, 1, n).astype(np.float32), 900) * np.exp(-t * 1.2) * 0.12
    return (boom + crack + tail).astype(np.float32)


def whoosh(dur=0.9, peak=0.6, lo=300, hi=7000) -> np.ndarray:
    """Band-passed noise sweep, peaking at `peak` seconds."""
    n = secs(dur)
    t = np.arange(n) / SR
    noise = RNG.normal(0, 1, n).astype(np.float32)
    out = np.zeros(n, np.float32)
    chunk = secs(0.015)
    for i in range(0, n, chunk):
        tt = i / SR
        k = math.exp(-((tt - peak) ** 2) / (2 * (dur / 5) ** 2))
        c = lo + (hi - lo) * k
        seg = noise[max(0, i - 1024) : i + chunk]
        f = bp(seg, max(60, c * 0.5), c * 1.5)
        out[i : i + chunk] = f[-len(noise[i : i + chunk]) :]
    env = np.exp(-((t - peak) ** 2) / (2 * (dur / 6) ** 2))
    return (out * env * 1.6).astype(np.float32)


def riser(dur=3.0, lo=200, hi=5000) -> np.ndarray:
    """Tension riser: pink noise through a smoothly swept band-pass (filter state kept between blocks,
    so no zipper noise) plus a rising tonal cluster, steeply low-passed so it never hisses."""
    import pedalboard as pb  # local: engine stays importable without it

    n = secs(dur)
    t = np.arange(n) / SR
    X = np.fft.rfft(RNG.normal(0, 1, n))
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    noise = np.fft.irfft(X / np.sqrt(f), n).astype(np.float32)
    noise /= np.std(noise) + 1e-9
    flt = pb.LadderFilter(mode=pb.LadderFilter.Mode.BPF12, cutoff_hz=float(lo), resonance=0.3)
    out = np.zeros(n, np.float32)
    blk = 128
    for i in range(0, n, blk):
        k = (i / n) ** 2
        flt.cutoff_hz = float(min(lo * (hi / lo) ** k, SR * 0.45))
        out[i : i + blk] = flt.process(noise[i : i + blk][None, :], SR, reset=False)[0]
    sos = butter(6, min(hi * 1.6, 11000), btype="low", fs=SR, output="sos")
    out = sosfilt(sos, out).astype(np.float32)
    tone = sum(np.sin(2 * np.pi * np.cumsum(midi_hz(50 + 12 * k) * (1 + 1.0 * (t / dur) ** 2)) / SR) for k in range(3)) / 3
    env = (t / dur) ** 2.2
    return ((out * 1.3 + tone * 0.25) * env).astype(np.float32)


def shepard(dur: float, base_note=38, rising=True, cycle=6.0) -> np.ndarray:
    """Shepard–Risset glissando: endlessly rising tension (the Dunkirk trick)."""
    n = secs(dur)
    t = np.arange(n) / SR
    out = np.zeros(n, np.float32)
    octaves = 6
    for k in range(octaves):
        pos = ((t / cycle) + k / octaves) % 1.0
        if not rising:
            pos = 1 - pos
        semis = pos * 12 * octaves
        f = midi_hz(base_note) * 2 ** (semis / 12)
        amp = np.exp(-((pos - 0.5) ** 2) / (2 * 0.16 ** 2))
        ph = 2 * np.pi * np.cumsum(f) / SR
        out += (np.sin(ph) + 0.35 * np.sin(2 * ph)) * amp
    return (out / octaves).astype(np.float32)


def tick(accent=False) -> np.ndarray:
    """Pocket-watch tick (the Dunkirk clock)."""
    n = secs(0.12)
    t = np.arange(n) / SR
    noise = RNG.normal(0, 1, n).astype(np.float32)
    body = bp(noise, 2500, 9000) * np.exp(-t * 280)
    ring = np.sin(2 * np.pi * (3400 if accent else 2900) * t) * np.exp(-t * 90) * 0.5
    return ((body + ring) * (1.0 if accent else 0.7)).astype(np.float32)


def heartbeat() -> np.ndarray:
    a = sub_boom(0.5, 60, 38) * 0.9
    b = sub_boom(0.5, 55, 36) * 0.6
    out = np.zeros(secs(0.9), np.float32)
    out[: len(a)] += a
    s = secs(0.28)
    out[s : s + len(b)] += b[: len(out) - s]
    return out


def typewriter_click() -> np.ndarray:
    n = secs(0.05)
    t = np.arange(n) / SR
    return (bp(RNG.normal(0, 1, n).astype(np.float32), 1500, 7000) * np.exp(-t * 400)).astype(np.float32)


def stamp_thud() -> np.ndarray:
    n = secs(0.6)
    t = np.arange(n) / SR
    thump = sub_boom(0.6, 120, 50) * 0.8
    slap = bp(RNG.normal(0, 1, n).astype(np.float32), 400, 3500) * np.exp(-t * 70) * 0.8
    return (thump + slap).astype(np.float32)


def pad(notes: list[str], dur: float, bright=0.25) -> np.ndarray:
    """Warm synth pad (supersaw through a dark low-pass) to glue the orchestra."""
    n = secs(dur)
    x = np.zeros(n, np.float32)
    for name in notes:
        x += supersaw(nn(name), dur, voices=5, detune=0.08)
    x = lp(x / max(1, len(notes)), 400 + 2400 * bright, order=2)
    return x * adsr(n, a=min(1.5, dur * 0.3), d=0.5, s=0.9, r=min(2.5, dur * 0.4))


# ------------------------------------------------------------------ SFZ sampler


class SFZ:
    """Minimal SFZ reader for VSCO-2-CE instruments (key ranges, velocity layers, round-robin ignored)."""

    def __init__(self, path: pathlib.Path):
        self.root = path.parent
        default_path = ""
        glob: dict = {}
        group: dict = {}
        cur: dict | None = None
        regions = []
        hdr = None
        for raw in path.read_text(errors="ignore").splitlines():
            line = raw.split("//")[0].strip()
            if not line:
                continue
            for tok in re.split(r"(<\w+>)", line):
                tok = tok.strip()
                if not tok:
                    continue
                if tok.startswith("<"):
                    if cur is not None:
                        regions.append({**glob, **group, **cur})
                        cur = None
                    hdr = tok[1:-1]
                    if hdr == "group":
                        group = {}
                    if hdr == "region":
                        cur = {}
                    continue
                m_path = re.match(r"(sample|default_path)=(.+)$", tok)
                pairs = [(m_path.group(1), m_path.group(2).strip())] if m_path else re.findall(r"(\w+)=(\S+)", tok)
                for k, v in pairs:
                    if hdr == "control" and k == "default_path":
                        default_path = v.replace("\\", "/")
                    elif hdr == "global":
                        glob[k] = v
                    elif hdr == "group":
                        group[k] = v
                    elif hdr == "region" and cur is not None:
                        cur[k] = v
        if cur is not None:
            regions.append({**glob, **group, **cur})
        self.regions = []
        for r in regions:
            if "sample" not in r:
                continue
            p = self.root / default_path / r["sample"].replace("\\", "/")
            if not p.exists():
                continue
            key = r.get("key")
            lo = r.get("lokey", key if key is not None else "0")
            hi = r.get("hikey", key if key is not None else "127")
            pk = r.get("pitch_keycenter", key if key is not None else None)
            r["_path"] = p
            r["_lo"] = _key(lo)
            r["_hi"] = _key(hi)
            r["_center"] = _key(pk) if pk is not None else (r["_lo"] + r["_hi"]) // 2
            r["_lovel"] = int(r.get("lovel", 0))
            r["_hivel"] = int(r.get("hivel", 127))
            r["_vol"] = float(r.get("volume", 0))
            r["_tune"] = float(r.get("tune", 0))
            self.regions.append(r)
        if not self.regions:
            raise RuntimeError(f"no playable regions in {path}")

    def pick(self, note: int, vel: int):
        cands = [r for r in self.regions if r["_lo"] <= note <= r["_hi"] and r["_lovel"] <= vel <= r["_hivel"]]
        if not cands:
            cands = [r for r in self.regions if r["_lo"] <= note <= r["_hi"]]
        if not cands:
            cands = sorted(self.regions, key=lambda r: abs(r["_center"] - note))[:1]
        return cands[0]

    def render(self, note: int, vel: int, dur: float, release=0.6, attack=0.0) -> np.ndarray:
        r = self.pick(note, vel)
        data = load_wav(str(r["_path"]))
        semis = note - r["_center"] + r["_tune"] / 100
        y = pitch_shift(data, semis)
        n = min(len(y), secs(dur + release))
        y = y[:n].copy()
        env = np.ones(n, np.float32)
        a = secs(attack)
        if a > 0:
            env[: min(a, n)] = np.linspace(0, 1, min(a, n))
        rs = secs(dur)
        if rs < n:
            env[rs:] *= np.linspace(1, 0, n - rs)
        y *= env[:, None]
        g = (vel / 127) ** 1.4 * 10 ** (r["_vol"] / 20)
        return (y * g).astype(np.float32)


def _key(v) -> int:
    v = str(v).strip()
    if v.lstrip("-").isdigit():
        return int(v)
    return nn_sfz(v)


def nn_sfz(v) -> int:
    v = str(v).strip().replace("♯", "#")
    m = re.fullmatch(r"([A-Ga-g])([#b]?)(-?\d)", v)
    if not m:
        return 60
    base = NOTE[m.group(1).upper()] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)
    return base + 12 * (int(m.group(3)) + 1)


@lru_cache(maxsize=512)
def load_wav(path: str) -> np.ndarray:
    data, sr = sf.read(path, dtype="float32", always_2d=True)
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    if sr != SR:
        g = math.gcd(sr, SR)
        data = resample_poly(data, SR // g, sr // g, axis=0).astype(np.float32)
    return data


def pitch_shift(data: np.ndarray, semis: float) -> np.ndarray:
    """Resample-based repitch (like a real sampler: duration changes with pitch)."""
    if abs(semis) < 1e-3:
        return data
    ratio = 2 ** (semis / 12)
    n_out = int(len(data) / ratio)
    idx = np.arange(n_out) * ratio
    i0 = np.floor(idx).astype(int)
    frac = (idx - i0)[:, None]
    i1 = np.minimum(i0 + 1, len(data) - 1)
    return (data[i0] * (1 - frac) + data[i1] * frac).astype(np.float32)
