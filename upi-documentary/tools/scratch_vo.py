"""Generate a SCRATCH voiceover (offline Kokoro) for timing only.

The final voice is Sarvam (tools/tts_sarvam.py).
Hindi  -> assets/vo_scratch/<id>.wav     (voice hm_omega)
English-> assets/vo_scratch_en/<id>.wav  (voice am_michael)

Usage: <kokoro-venv>/bin/python -I tools/scratch_vo.py <kokoro_dir> [speed] [--lang en]
"""
import json
import pathlib
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = pathlib.Path(__file__).resolve().parent.parent
args = [a for a in sys.argv[1:] if not a.startswith("--")]
lang = "en" if "--lang" in sys.argv and sys.argv[sys.argv.index("--lang") + 1] == "en" else "hi"
args = [a for a in args if a != "en"]
kdir = pathlib.Path(args[0])
speed = float(args[1]) if len(args) > 1 else (1.15 if lang == "hi" else 1.05)
out = ROOT / "assets" / ("vo_scratch" if lang == "hi" else "vo_scratch_en")
out.mkdir(parents=True, exist_ok=True)

k = Kokoro(str(kdir / "kokoro-v1.0.onnx"), str(kdir / "voices-v1.0.bin"))
lines = json.loads((ROOT / "script" / "lines.json").read_text())
for ch in lines["chapters"]:
    for ln in ch["lines"]:
        text = ln["tts"] if lang == "hi" else ln["tts_en"]
        voice, code = ("hm_omega", "hi") if lang == "hi" else ("am_michael", "en-us")
        samples, sr = k.create(text, voice=voice, speed=speed, lang=code)
        sf.write(out / f"{ln['id']}.wav", samples, sr)
        print(ln["id"], round(len(samples) / sr, 2), flush=True)
