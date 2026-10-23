"""Listen-check the final voiceover by machine: transcribe every line back with Sarvam speech-to-text
(saaras:v4, code-mixed output) and compare it with the script. Low scores point at a garbled or
misread line to regenerate (tools/tts_sarvam.py --only <id>).

usage: python3 tools/vo_check.py [--lang en] [--only c2_14,c3_15]
Auth: the environment's network secret for api.sarvam.ai (or SARVAM_API_KEY), as for tts_sarvam.py.
"""
import difflib
import json
import os
import pathlib
import re
import subprocess
import sys
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
LANG = "en" if "--lang" in sys.argv and sys.argv[sys.argv.index("--lang") + 1] == "en" else "hi"
ONLY = set(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else set()
VO = ROOT / "assets" / ("vo" if LANG == "hi" else "vo_en")
FIELD = "tts" if LANG == "hi" else "tts_en"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFC", s.lower())
    s = s.replace("़", "")  # nukta: ज़/ज, फ़/फ read the same
    return re.sub(r"[^\wऀ-ॿ]+", " ", s).strip()


def transcribe(path: pathlib.Path) -> str:
    cmd = ["curl", "-sS", "--max-time", "60", "-X", "POST", "https://api.sarvam.ai/speech-to-text",
           "-F", f"file=@{path};type=audio/wav", "-F", "model=saaras:v4", "-F", "mode=codemix",
           "-F", f"language_code={'hi-IN' if LANG == 'hi' else 'en-IN'}"]
    key = os.environ.get("SARVAM_API_KEY")
    if key:
        cmd[1:1] = ["-H", f"api-subscription-key: {key}"]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=90).stdout
    try:
        return json.loads(out).get("transcript", "") or f"<no transcript: {out[:160]}>"
    except json.JSONDecodeError:
        return f"<bad response: {out[:160]}>"


def main():
    script = json.loads((ROOT / "script" / "lines.json").read_text())
    lines = [l for c in script["chapters"] for l in c["lines"] if not ONLY or l["id"] in ONLY]
    rows = []
    for l in lines:
        got = transcribe(VO / f"{l['id']}.wav")
        score = difflib.SequenceMatcher(None, norm(l[FIELD]), norm(got)).ratio()
        rows.append((score, l["id"], l[FIELD], got))
        print(f"{l['id']}  {score:.2f}", flush=True)
    rows.sort()
    report = ROOT / "assets" / f"vo_check{'' if LANG == 'hi' else '_en'}.txt"
    report.write_text("\n\n".join(f"{s:.2f}  {i}\n  script: {a}\n  heard:  {b}" for s, i, a, b in rows) + "\n")
    print(f"lowest first -> {report.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
