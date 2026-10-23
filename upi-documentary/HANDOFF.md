# UPI documentary — handoff

**Film:** "FREE UPI का बिल कौन भरता है? / Who really pays for your 'free' UPI?"
16:9 · 1920×1080 · 30 fps · target runtime 6:30–7:00 · YouTube-ready (−14 LUFS).
**Two editions from one project:** Hindi (Hinglish) = composition `Main`; English (Indian English) = composition `Main-EN`.
Every tool takes `--lang en` for the English edition (files get an `_en` suffix; the upload kit goes to `publish/en/`).

## Where things stand

| Part | Status | Files |
|---|---|---|
| Research | ✅ every on-screen/narrated fact sourced; 2 items marked **C** need a primary-document check | `research/facts.md` |
| Script | ✅ chapter-wise, Prestige three-act structure, Hinglish, numbers spelled out for TTS | `script/lines.json` |
| Timeline | ✅ auto-built from voiceover durations; video, music and mix all follow it | `tools/build_timeline.py` → `video/src/timeline.json`, `music/cues.json` |
| Animation | ✅ all 33 segments built (3D camera, 2.5D parallax, kinetic type, charts, map, coin) | `video/src/scenes/*.tsx` |
| Score | ✅ original, Zimmer-*style* (ticking clock, Shepard tone, ostinato strings, braams, organ), real orchestral samples (VSCO-2-CE, CC0) | `music/score.py`, `music/engine.py` |
| Mix | ✅ ducking under VO, −14 LUFS / −1 dBTP | `tools/mix.py` |
| Voiceover | ⏳ **scratch only** (offline Kokoro, for timing) for both editions. Final = Sarvam hi-IN / en-IN | `tools/tts_sarvam.py [--lang en]` |
| English edition | ✅ English narration (`tts_en`) + on-screen text in every scene (`useT()`), English timing overrides, thumbnail, kit | `script/lines.json`, `script/beats_en.json`, `video/src/lang.ts` |
| Official documents | ⏳ placeholders (clearly labelled, unreadable) until real PDF pages are added | `video/public/docs/` |
| Photos | ⏳ stylised fallbacks until real photos are added | `video/public/photos/` |
| Upload kit | ✅ description with chapters + sources, Hindi & English subtitles (regenerate after re-timing) | `tools/youtube_meta.py` → `publish/` |

## Next session (needs: Network access = Full, secret `SARVAM_API_KEY`)

```bash
cd upi-documentary
# 0. tools
(cd video && npm ci)
python3 -m venv /tmp/musicenv && /tmp/musicenv/bin/pip install -q numpy scipy soundfile pedalboard mido pyloudnorm
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 --branch SFZ https://github.com/sgossner/vsco-2-ce /home/user/sgossner/vsco-2-ce   # 5 GB samples
curl -sS -o /dev/null -w "%{http_code}\n" https://api.sarvam.ai     # must not be 000

# 1. pick the voice — send the 3 auditions to the user and let them choose
python3 tools/tts_sarvam.py --audition          # assets/vo_audition/{abhilash,karun,hitesh}.wav
# 2. full voiceover, then re-time everything
python3 tools/tts_sarvam.py --speaker <chosen>
python3 tools/build_timeline.py                 # prints total; if > 7:00 re-run TTS with --pace 1.12
# 3. pronunciation pass: if a Latin-script term is misread, use the Devanagari spelling from
#    lines.json → pronunciation, edit that line's `tts`, and re-run with --only <id>
```

### 3b. English edition (same steps, `--lang en`)
```bash
python3 tools/tts_sarvam.py --lang en --audition          # assets/vo_audition_en/ — Indian English (en-IN) voices
python3 tools/tts_sarvam.py --lang en --speaker <chosen>  # assets/vo_en/
python3 tools/build_timeline.py --lang en                 # video/src/timeline_en.json, music/cues_en.json
```
English-only timing: `script/beats_en.json` moves visual hits (e.g. "this.", "zero", "the bill") to where the word lands in the English
sentence; video **and** score read it. After the real English VO, spot-check those moments and nudge the fractions if needed.

### 4. Official documents (shown as real pages in S31; also verify the **C** facts)
Render page 1 of each PDF at ~150 dpi (`pdftoppm -png -r 150 -f 1 -l 1`), crop to A4 and save as:

| File | Source to find | Used in |
|---|---|---|
| `video/public/docs/mof_notification_2026-09-14.png` | Ministry of Finance notification of 14 Sep 2026 under Sec 10A, PSS Act (egazette.gov.in / finmin.gov.in) | S31 left |
| `video/public/docs/npci_circular_2026-09-15.png` | NPCI operational circular of 15 Sep 2026 on UPI MDR (npci.org.in → Circulars → UPI) | S31 right |

Then set the yellow `highlight={{ top, height }}` in `S31_Notification` (`video/src/scenes/bill.tsx`) to the line with the 0.4% / ₹2,000 rule.
While reading them, confirm facts 5.4 (flat ₹5 categories) and 5.8 (circular number) in `research/facts.md`; fix `c3_06` in the script if needed.

### 5. Photos (2.5D plates; dimmed + Ken Burns automatically)
`video/public/photos/parliament.jpg`, `supreme_court.jpg`, `kirana_shop.jpg` (≥1920 px wide).
Use Wikimedia Commons (CC BY / CC BY-SA → credit required) or Pexels/Unsplash. Write every credit into the CREDITS block of `tools/youtube_meta.py`.
Do **not** use the State Emblem of India or any company/bank logo.

### 6. Optional upgrade
Replace the illustrative growth curve in `S15_Explosion` (`video/src/scenes/pledge.tsx`, `curvePts`) with NPCI's monthly UPI volumes (npci.org.in → UPI product statistics), then remove the "curve shape illustrative" label.

### 7. Build, check, render
```bash
/tmp/musicenv/bin/python -I music/score.py      # score.wav + sfx.wav from the new cues
/tmp/musicenv/bin/python -I tools/mix.py        # video/public/audio/mix.wav
python3 tools/youtube_meta.py                   # description, chapters, SRTs
# English edition: the same three commands with --lang en  → score_en.wav, mix_en.wav, publish/en/
cd video
node tools/stills.mjs qc seg-S00-ColdOpen:200,700 seg-S32-Rules:300,700 seg-S41-WhoPays:600   # spot-check layouts after re-timing
npx remotion render Main out/render.mp4                # Hindi, ~25 min on 4 CPUs
npx remotion render Main-EN out/render_en.mp4         # English
npx remotion still Thumbnail-EN ../publish/en/thumbnail.png --image-format=png
cd .. && tools/finish.sh video/out/render.mp4 video/out/upi_documentary_final.mp4         # grain + vignette + YouTube encode
tools/finish.sh video/out/render_en.mp4 video/out/upi_documentary_final_en.mp4
```
Check: no text overlaps after re-timing, the coin cuts to black on the beat, loudness −14 LUFS.

## Render performance notes (CPU-only container)
- WebGL uses legacy SwiftShader (`remotion.config.ts`): same pixels as "swangle", ~25× faster frame capture here.
- Backdrops and the perspective grid are pre-baked images (`video/public/tex/bg_*.png`, `grid_*.png`); dust is one canvas.
  Re-bake the grid with `npx remotion still GridBake public/tex/grid_<hue>.png --props='{"hue":"<hue>"}' --image-format=png`.
- Reflections are baked once per scene (`StudioEnv` in `three/kit.tsx`); drei's `<Environment>` re-bakes every frame — don't use it.
- 3D layers render at 0.75 scale and are upscaled (`REMOTION_3D_RES=1` for full-res if time allows).
- Grain + vignette are added by ffmpeg in `tools/finish.sh`, not in the browser.

## Design notes
- Structure = *The Prestige*'s three acts (Pledge → Turn → Prestige) + cold open in medias res, ticking-clock tension in chapter 3, spinning-coin open ending (an *Inception* nod). No film footage, quotes or music from any film are used.
- Glow is done with additive "halo" sprites — post-processing bloom renders black on this CPU-only (SwiftShader) setup.
- Every number on screen has a `Source ·` lower-third. The disclaimer card runs exactly 3 s after the title.
- Music is 100% original and the samples are CC0, so there is no third-party Content ID risk.
