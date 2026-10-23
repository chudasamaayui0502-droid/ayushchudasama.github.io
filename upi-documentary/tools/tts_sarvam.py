"""Generate the final voiceover with Sarvam AI (Bulbul) — Indian male voice, Hinglish.

Auth, either way (never paste the key in chat):
  - a Network secret in the cloud environment settings for api.sarvam.ai — the proxy adds the header
    (`api-subscription-key: <key>`, or `Authorization: Bearer <key>`) to every request, so the key never
    enters the session; or
  - the environment variable SARVAM_API_KEY, which this script sends itself.
Also needs network access to api.sarvam.ai.

usage:
  python3 tools/tts_sarvam.py --audition                          # 2 test lines in each candidate voice -> assets/vo_audition/
  python3 tools/tts_sarvam.py --speaker anand_hi_documentary       # all lines -> assets/vo/<id>.wav
  python3 tools/tts_sarvam.py --speaker anand_hi_documentary --only c2_14,c3_15   # re-do specific lines
  add --lang en for the English edition (Indian English, en-IN): text = tts_en, output assets/vo_en/

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
# bulbul:v4-flash male documentary / narration personas (docs.sarvam.ai → Text-to-Speech → Voices)
MALE_VOICES = {
    "hi": ["anand_hi_documentary", "mahesh_hi_documentary", "ratan_hi_documentary", "shubh_hi_stories_dramatic"],
    "en": ["girish_en_documentary", "shubh_en_narration", "sarang_en_narration", "rustom_en_suspense"],
}
# a dramatic line + a code-mixed line with a quote and a pause — a good stress test
AUDITION_LINES = ["c0_05", "c2_14"]


def synth(text: str, speaker: str, model: str, pace: float, pitch: float, loudness: float, sr: int, lang_code: str = "hi-IN") -> bytes:
    """pitch/loudness are only sent for bulbul:v2; v3 / v4-flash take pace only."""
    key = os.environ.get("SARVAM_API_KEY")
    body = {
        "text": text,
        "target_language_code": lang_code,
        "speaker": speaker,
        "model": model,
        "pace": pace,
        "speech_sample_rate": sr,
        "output_audio_codec": "wav",
        "enable_preprocessing": True,
    }
    if model == "bulbul:v2":
        body.update(pitch=pitch, loudness=loudness)
    headers = {"Content-Type": "application/json"}
    if key:
        headers["api-subscription-key"] = key  # otherwise the environment's network secret adds it
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers=headers)
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
            if e.code == 401 or (e.code == 403 and "sarvam" in msg.lower()):
                sys.exit(f"Sarvam rejected the credentials ({e.code}). Check the network secret for api.sarvam.ai "
                         f"(header api-subscription-key, no prefix) or SARVAM_API_KEY. Response: {msg[:300]}")
            sys.exit(f"Sarvam error {e.code}: {msg[:500]}")
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
    ap.add_argument("--speaker", default="")
    ap.add_argument("--model", default="bulbul:v4-flash")
    ap.add_argument("--pace", type=float, default=1.05)
    ap.add_argument("--pitch", type=float, default=-0.05)
    ap.add_argument("--loudness", type=float, default=1.1)
    ap.add_argument("--sr", type=int, default=48000)
    ap.add_argument("--only", default="")
    ap.add_argument("--audition", action="store_true")
    ap.add_argument("--lang", choices=["hi", "en"], default="hi")
    a = ap.parse_args()

    script = json.loads((ROOT / "script" / "lines.json").read_text())
    lines = {l["id"]: l for ch in script["chapters"] for l in ch["lines"]}
    field, code, sfx = ("tts", "hi-IN", "") if a.lang == "hi" else ("tts_en", "en-IN", "_en")

    if a.audition:
        out = ROOT / "assets" / f"vo_audition{sfx}"
        out.mkdir(parents=True, exist_ok=True)
        for sp in ([a.speaker] if a.speaker else MALE_VOICES[a.lang]):
            for lid in AUDITION_LINES:
                wav = synth(lines[lid][field], sp, a.model, a.pace, a.pitch, a.loudness, a.sr, code)
                (out / f"{sp}__{lid}.wav").write_bytes(wav)
                print(sp, lid, round(seconds(out / f"{sp}__{lid}.wav"), 2), "s", flush=True)
        print(f"listen to assets/vo_audition{sfx}/*.wav and pick a --speaker")
        return
    if not a.speaker:
        sys.exit("pick a voice first: --speaker <id> (run --audition to hear the candidates)")

    out = ROOT / "assets" / f"vo{sfx}"
    out.mkdir(parents=True, exist_ok=True)
    ids = [i for i in a.only.split(",") if i] or list(lines)
    total = 0.0
    for i in ids:
        wav = synth(lines[i][field], a.speaker, a.model, a.pace, a.pitch, a.loudness, a.sr, code)
        p = out / f"{i}.wav"
        p.write_bytes(wav)
        d = seconds(p)
        total += d
        print(f"{i}  {d:5.2f}s", flush=True)
    print(f"speech total {total:.1f}s for {len(ids)} lines")
    (out / "settings.json").write_text(json.dumps(vars(a), indent=1))


if __name__ == "__main__":
    main()
