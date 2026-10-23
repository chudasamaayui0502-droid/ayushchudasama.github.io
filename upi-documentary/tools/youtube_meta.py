"""Write the YouTube upload kit from the timeline: description (chapters, sources, credits) + subtitles.

Outputs (upi-documentary/publish/):
  description.md   paste into YouTube description (chapters are clickable)
  subtitles_hi.srt Hinglish captions (on-screen wording)
  subtitles_en.srt English captions
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
tl = json.loads((ROOT / "video" / "src" / "timeline.json").read_text())
script = json.loads((ROOT / "script" / "lines.json").read_text())
facts = (ROOT / "research" / "facts.md").read_text()
out = ROOT / "publish"
out.mkdir(exist_ok=True)
fps = tl["fps"]


def ts(sec: float) -> str:
    m, s = divmod(int(sec), 60)
    return f"{m:02d}:{s:02d}"


def srt_ts(sec: float) -> str:
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s - int(s)) * 1000)):03d}"


# chapters
chapters = [(0.0, "Cold open — हर दिन 80 करोड़ बार")]
names = {c["id"]: c for c in script["chapters"]}
for s in tl["segments"]:
    if s["kind"] == "chapter":
        c = names[s["chapter"]]
        chapters.append((s["from"] / fps, f"Chapter {s['num']} — {c['name_en'].title()} ({c['name_hi']})"))
outro = next(s for s in tl["segments"] if s["id"] == "S50_Outro")
chapters.append((outro["from"] / fps, "आपकी राय + sources"))

# sources: every markdown link in the fact sheet, de-duplicated, in order
links = []
for label, url in re.findall(r"\[([^\]]+)\]\((https?://[^)]+)\)", facts):
    if url not in [u for _, u in links]:
        links.append((label, url))

desc = f"""{tl['title_hi']} | {tl['title_en']}

UPI पर 0.4% MDR — दो हज़ार रुपये से ऊपर के merchant payments पर नई fee। लेकिन असली सवाल: पिछले छह साल से "free" UPI का बिल कौन भर रहा था? Government data, NPCI numbers और court records के साथ — एक cinematic documentary।

⏱ CHAPTERS
""" + "\n".join(f"{ts(t)} {n}" for t, n in chapters) + f"""

⚠️ DISCLAIMER
{script['disclaimer']['en']}
{script['disclaimer']['hi']}

📚 SOURCES (facts as of {script['facts_as_of']})
""" + "\n".join(f"• {l} — {u}" for l, u in links) + """

🎵 CREDITS
• Original score composed for this film (no third-party music). Orchestral samples: VS Chamber Orchestra Community Edition (VSCO-2-CE), public domain (CC0).
• India map: datameet/maps "india-composite" (CC BY 2.5 India), simplified.
• Fonts: Teko, Mukta, Tiro Devanagari Hindi, Montserrat, Cormorant Garamond, IBM Plex Mono — SIL Open Font License.
• Photos: see the credits list in this description once added (Wikimedia Commons / Pexels; licences noted per image).

#UPI #MDR #NPCI #DigitalIndia #Explained #HindiDocumentary
"""
(out / "description.md").write_text(desc)


def write_srt(path: pathlib.Path, field: str):
    rows, i = [], 1
    for s in tl["segments"]:
        for l in s.get("lines", []):
            text = l["display"] if field == "display" else l["en"]
            text = text.replace("*", "")
            start = l["from"] / fps
            stop = start + l["frames"] / fps
            rows.append(f"{i}\n{srt_ts(start)} --> {srt_ts(stop)}\n{text}\n")
            i += 1
    path.write_text("\n".join(rows))


write_srt(out / "subtitles_hi.srt", "display")
# English uses the `en` field from the script (timeline lines carry it too)
write_srt(out / "subtitles_en.srt", "en")
print("wrote", *(p.name for p in out.iterdir()))
