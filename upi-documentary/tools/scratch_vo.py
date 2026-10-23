"""Generate a SCRATCH voiceover (offline Kokoro, Hindi male) for timing only.

The final voice is Sarvam (tools/tts_sarvam.py). Scratch lines go to assets/vo_scratch/<id>.wav.

Usage: <kokoro-venv>/bin/python -I tools/scratch_vo.py <kokoro_dir>
"""
import json
import pathlib
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = pathlib.Path(__file__).resolve().parent.parent
kdir = pathlib.Path(sys.argv[1])
out = ROOT / "assets" / "vo_scratch"
out.mkdir(parents=True, exist_ok=True)

k = Kokoro(str(kdir / "kokoro-v1.0.onnx"), str(kdir / "voices-v1.0.bin"))
lines = json.loads((ROOT / "script" / "lines.json").read_text())
for ch in lines["chapters"]:
    for ln in ch["lines"]:
        samples, sr = k.create(ln["tts"], voice="hm_omega", speed=float(sys.argv[2]) if len(sys.argv) > 2 else 1.15, lang="hi")
        sf.write(out / f"{ln['id']}.wav", samples, sr)
        print(ln["id"], round(len(samples) / sr, 2), flush=True)
