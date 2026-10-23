"""Generate the final voiceover with Sarvam AI (Bulbul) — Indian male voice, Hinglish.

Needs the environment variable SARVAM_API_KEY (add it in the cloud environment settings,
never in chat) and network access to api.sarvam.ai.

usage:
  python3 tools/tts_sarvam.py --audition           # one test line in every male voice -> assets/vo_audition/
  python3 tools/tts_sarvam.py --speaker abhilash    # all lines -> assets/vo/<id>.wav
  python3 tools/tts_sarvam.py --speaker abhilash --only c2_14,c3_15   # re-do specific lines

Then: python3 tools/build_timeline.py && music + mix (see HANDOFF.md).
Check https://docs.sarvam.ai for the current model names / speakers if a request is rejected.
"""
import argparse
import base64
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request
import wave

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = "https://api.sarvam.ai/text-to-speech"
MALE_VOICES = ["abhilash", "karun", "hitesh"]  # bulbul:v2 male speakers
AUDITION_LINE = "c2_14"  # has Hindi, an English quote and a pause — a good stress test


def synth(text: str, speaker: str, model: str, pace: float, pitch: float, loudness: float, sr: int) -> bytes:
    key = os.environ.get("SARVAM_API_KEY")
    if not key:
        sys.exit("SARVAM_API_KEY is not set — add it in the environment settings and start a new session.")
    body = {
        "text": text,
        "target_language_code": "hi-IN",
        "speaker": speaker,
        "model": model,
        "pace": pace,
        "pitch": pitch,
        "loudness": loudness,
        "speech_sample_rate": sr,
        "enable_preprocessing": True,
    }
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={"api-subscription-key": key, "Content-Type": "application/json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.loads(r.read())
            return base64.b64decode(data["audios"][0])
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="ignore")
            if e.code in (429, 500, 502, 503) and attempt < 4:
                time.sleep(2 ** (attempt + 1))
                continue
            sys.exit(f"Sarvam error {e.code}: {msg}")
        except urllib.error.URLError as e:
            if attempt < 4:
                time.sleep(2 ** (attempt + 1))
                continue
            sys.exit(f"network error: {e}")
    raise RuntimeError("unreachable")


def seconds(path: pathlib.Path) -> float:
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--speaker", default="abhilash")
    ap.add_argument("--model", default="bulbul:v2")
    ap.add_argument("--pace", type=float, default=1.05)
    ap.add_argument("--pitch", type=float, default=-0.05)
    ap.add_argument("--loudness", type=float, default=1.1)
    ap.add_argument("--sr", type=int, default=24000)
    ap.add_argument("--only", default="")
    ap.add_argument("--audition", action="store_true")
    a = ap.parse_args()

    script = json.loads((ROOT / "script" / "lines.json").read_text())
    lines = {l["id"]: l for ch in script["chapters"] for l in ch["lines"]}

    if a.audition:
        out = ROOT / "assets" / "vo_audition"
        out.mkdir(parents=True, exist_ok=True)
        for sp in MALE_VOICES:
            wav = synth(lines[AUDITION_LINE]["tts"], sp, a.model, a.pace, a.pitch, a.loudness, a.sr)
            (out / f"{sp}.wav").write_bytes(wav)
            print(sp, round(seconds(out / f"{sp}.wav"), 2), "s")
        print("listen to assets/vo_audition/*.wav and pick a --speaker")
        return

    out = ROOT / "assets" / "vo"
    out.mkdir(parents=True, exist_ok=True)
    ids = [i for i in a.only.split(",") if i] or list(lines)
    total = 0.0
    for i in ids:
        wav = synth(lines[i]["tts"], a.speaker, a.model, a.pace, a.pitch, a.loudness, a.sr)
        p = out / f"{i}.wav"
        p.write_bytes(wav)
        d = seconds(p)
        total += d
        print(f"{i}  {d:5.2f}s", flush=True)
    print(f"speech total {total:.1f}s for {len(ids)} lines")
    (out / "settings.json").write_text(json.dumps(vars(a), indent=1))


if __name__ == "__main__":
    main()
