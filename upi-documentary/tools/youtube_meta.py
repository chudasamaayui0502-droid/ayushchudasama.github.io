"""Write the YouTube upload kit from the timeline: description (chapters, sources, credits) + subtitles.

usage: python3 tools/youtube_meta.py [--lang en]

Hindi edition (upi-documentary/publish/):      description.md, subtitles_hi.srt, subtitles_en.srt
English edition (upi-documentary/publish/en/): description.md, subtitles_en.srt
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LANG = "en" if "--lang" in sys.argv and sys.argv[sys.argv.index("--lang") + 1] == "en" else "hi"
SFX = "" if LANG == "hi" else "_en"
tl = json.loads((ROOT / "video" / "src" / f"timeline{SFX}.json").read_text())
script = json.loads((ROOT / "script" / "lines.json").read_text())
facts = (ROOT / "research" / "facts.md").read_text()
out = ROOT / "publish" / ("" if LANG == "hi" else "en")
out.mkdir(parents=True, exist_ok=True)
fps = tl["fps"]


def ts(sec: float) -> str:
    m, s = divmod(int(sec), 60)
    return f"{m:02d}:{s:02d}"


def srt_ts(sec: float) -> str:
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s - int(s)) * 1000)):03d}"


names = {c["id"]: c for c in script["chapters"]}
outro = next(s for s in tl["segments"] if s["id"] == "S50_Outro")
if LANG == "hi":
    chapters = [(0.0, "Cold open — हर दिन 80 करोड़ बार")]
else:
    chapters = [(0.0, "Cold open — 800 million times a day")]
for s in tl["segments"]:
    if s["kind"] == "chapter":
        c = names[s["chapter"]]
        sub = c["name_hi"] if LANG == "hi" else c.get("sub_en", "")
        chapters.append((s["from"] / fps, f"Chapter {s['num']} — {c['name_en'].title()} ({sub})"))
chapters.append((outro["from"] / fps, "आपकी राय + sources" if LANG == "hi" else "Your verdict + sources"))

# sources: every markdown link in the fact sheet, de-duplicated, in order
links = []
for label, url in re.findall(r"\[([^\]]+)\]\((https?://[^)]+)\)", facts):
    if url not in [u for _, u in links]:
        links.append((label, url))

chapter_block = "\n".join(f"{ts(t)} {n}" for t, n in chapters)
source_block = "\n".join(f"• {l} — {u}" for l, u in links)
credits = """🎵 CREDITS
• Original score composed for this film (no third-party music). Orchestral samples: VS Chamber Orchestra Community Edition (VSCO-2-CE), public domain (CC0).
• India map: datameet/maps "india-composite" (CC BY 2.5 India), simplified.
• Fonts: Teko, Mukta, Tiro Devanagari Hindi, Montserrat, Cormorant Garamond, IBM Plex Mono — SIL Open Font License.
• Photos: see the credits list in this description once added (Wikimedia Commons / Pexels; licences noted per image)."""

if LANG == "hi":
    desc = f"""{tl['title_hi']} | {tl['title_en']}

UPI पर 0.4% MDR — दो हज़ार रुपये से ऊपर के merchant payments पर नई fee। लेकिन असली सवाल: पिछले छह साल से "free" UPI का बिल कौन भर रहा था? Government data, NPCI numbers और court records के साथ — एक cinematic documentary।

⏱ CHAPTERS
{chapter_block}

⚠️ DISCLAIMER
{script['disclaimer']['en']}
{script['disclaimer']['hi']}

📚 SOURCES (facts as of {script['facts_as_of']})
{source_block}

{credits}

#UPI #MDR #NPCI #DigitalIndia #Explained #HindiDocumentary
"""
else:
    desc = f"""Who Really Pays for Your 'Free' UPI? | The hidden cost of India's digital payments

From 2020, UPI ran with zero merchant fees — 800 million payments a day, almost half of the world's real-time payments. Now a 0.4% MDR is coming for merchant payments above ₹2,000. So who was paying the bill all along? A cinematic documentary built on government data, NPCI numbers and court records.

⏱ CHAPTERS
{chapter_block}

⚠️ DISCLAIMER
{script['disclaimer_en_card']}

📚 SOURCES (facts as of {script['facts_as_of']})
{source_block}

{credits}

#UPI #MDR #NPCI #DigitalIndia #Explained #India #Documentary
"""
(out / "description.md").write_text(desc)


def write_srt(path: pathlib.Path, field: str):
    rows, i = [], 1
    for s in tl["segments"]:
        for l in s.get("lines", []):
            text = l[field].replace("*", "")
            start = l["from"] / fps
            stop = start + l["frames"] / fps
            rows.append(f"{i}\n{srt_ts(start)} --> {srt_ts(stop)}\n{text}\n")
            i += 1
    path.write_text("\n".join(rows))


if LANG == "hi":
    write_srt(out / "subtitles_hi.srt", "display")
    write_srt(out / "subtitles_en.srt", "en")
else:
    write_srt(out / "subtitles_en.srt", "display")
print("wrote", *(p.name for p in out.iterdir() if p.is_file()))
