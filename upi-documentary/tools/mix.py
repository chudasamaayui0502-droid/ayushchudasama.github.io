"""Final mix: voiceover + score + sound design → video/public/audio/mix.wav

- VO lines are placed at their timeline positions, cleaned (HPF, de-mud, compression) and
  levelled to the same loudness.
- Music and SFX duck automatically under speech (sidechain envelope from the VO timeline).
- Master is normalised to -14 LUFS integrated with a -1 dBTP ceiling (YouTube's target).

usage: <musicenv>/bin/python -I tools/mix.py [--lang en]
"""
import json
import math
import pathlib
import sys

import numpy as np
import pedalboard as pb
import pyloudnorm as pyln
import soundfile as sf
from scipy.ndimage import maximum_filter1d, minimum_filter1d, uniform_filter1d
from scipy.signal import resample_poly

ROOT = pathlib.Path(__file__).resolve().parent.parent
SR = 48000
LANG = "en" if "--lang" in sys.argv and sys.argv[sys.argv.index("--lang") + 1] == "en" else "hi"
SFX = "" if LANG == "hi" else "_en"
cues = json.loads((ROOT / "music" / f"cues{SFX}.json").read_text())
vo_dir = ROOT / "assets" / cues["voDir"]
N = int(math.ceil(cues["seconds"] * SR))
meter = pyln.Meter(SR)


def load(path: pathlib.Path) -> np.ndarray:
    x, sr = sf.read(str(path), dtype="float32", always_2d=True)
    x = x.mean(axis=1)
    if sr != SR:
        g = math.gcd(sr, SR)
        x = resample_poly(x, SR // g, sr // g).astype(np.float32)
    return x


def fit(x: np.ndarray, n: int) -> np.ndarray:
    out = np.zeros((n, 2), np.float32)
    m = min(n, len(x))
    out[:m] = x[:m]
    return out


voice_chain = pb.Pedalboard([
    pb.HighpassFilter(85),
    pb.LowShelfFilter(cutoff_frequency_hz=220, gain_db=-1.5),
    pb.PeakFilter(cutoff_frequency_hz=3200, gain_db=2.0, q=0.9),  # presence
    pb.Compressor(threshold_db=-20, ratio=3.0, attack_ms=8, release_ms=120),
    pb.Gain(2.0),
])

vo = np.zeros(N, np.float32)
speech = np.zeros(N, np.float32)
lines = [l for s in cues["segments"] for l in s["lines"]]
for l in lines:
    x = load(vo_dir / f"{l['id']}.wav")
    x = voice_chain(x[None, :], SR)[0]
    # level every line to the same loudness so the narration sits evenly
    if len(x) > SR * 0.5:
        lufs = meter.integrated_loudness(x)
        if np.isfinite(lufs):
            x = x * 10 ** ((-17.0 - lufs) / 20)
    s = int(round(l["t"] * SR))
    e = min(N, s + len(x))
    vo[s:e] += x[: e - s]
    speech[s:e] = 1.0

# sidechain envelope: fast attack, slow release
att, rel = math.exp(-1 / (0.09 * SR)), math.exp(-1 / (0.55 * SR))
env = np.zeros(N, np.float32)
lookahead = int(0.12 * SR)
target = np.concatenate([speech[lookahead:], np.zeros(lookahead, np.float32)])
target = np.maximum(target, speech)
v = 0.0
for i in range(N):  # one-pole follower
    t = target[i]
    v = att * v + (1 - att) * t if t > v else rel * v + (1 - rel) * t
    env[i] = v

music = fit(sf.read(str(ROOT / "music" / "render" / f"score{SFX}.wav"), dtype="float32", always_2d=True)[0], N)
fx = fit(sf.read(str(ROOT / "music" / "render" / f"sfx{SFX}.wav"), dtype="float32", always_2d=True)[0], N)

music_gain = 10 ** (-9.0 / 20) * (1 - 0.70 * env)  # ≈ -10.5 dB extra under speech
fx_gain = 10 ** (-10.0 / 20) * (1 - 0.45 * env)
mix = music * music_gain[:, None] + fx * fx_gain[:, None] + vo[:, None]

master = pb.Pedalboard([
    pb.HighpassFilter(25),
    pb.Compressor(threshold_db=-14, ratio=1.8, attack_ms=30, release_ms=250),
])
mix = master(mix.T, SR).T


def limit(x: np.ndarray, ceiling: float, look_ms=5.0) -> np.ndarray:
    """Look-ahead brick-wall limiter (gain computed from the windowed peak, smoothed)."""
    L = max(2, int(SR * look_ms / 1000))
    peak = maximum_filter1d(np.abs(x).max(axis=1), size=2 * L + 1)
    g = np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))
    g = minimum_filter1d(g, size=2 * L + 1)
    g = uniform_filter1d(g, size=L)
    return (x * g[:, None]).astype(np.float32)


CEIL = 10 ** (-1.0 / 20)
for _ in range(4):
    lufs = meter.integrated_loudness(mix)
    mix = mix * 10 ** ((-14.0 - lufs) / 20)
    mix = limit(mix, CEIL * 0.98)
print(f"mix: {len(mix) / SR:.1f}s, {meter.integrated_loudness(mix):.1f} LUFS, peak {20 * np.log10(np.abs(mix).max()):.1f} dBFS")
out = ROOT / "video" / "public" / "audio"
out.mkdir(parents=True, exist_ok=True)
sf.write(out / f"mix{SFX}.wav", mix.astype(np.float32), SR, subtype="PCM_24")
sf.write(ROOT / "music" / "render" / f"vo_only{SFX}.wav", vo, SR, subtype="PCM_24")
print("wrote", out / f"mix{SFX}.wav")
