import { continueRender, delayRender, staticFile } from "remotion";

const faces: { family: string; file: string; weight?: string; style?: string }[] = [
  { family: "Teko", file: "Teko[wght].ttf", weight: "300 700" },
  { family: "Mukta", file: "Mukta-Regular.ttf", weight: "400" },
  { family: "Mukta", file: "Mukta-Medium.ttf", weight: "500" },
  { family: "Mukta", file: "Mukta-SemiBold.ttf", weight: "600" },
  { family: "Mukta", file: "Mukta-Bold.ttf", weight: "700" },
  { family: "Mukta", file: "Mukta-ExtraBold.ttf", weight: "800" },
  { family: "Tiro Devanagari Hindi", file: "TiroDevanagariHindi-Regular.ttf", weight: "400" },
  { family: "Tiro Devanagari Hindi", file: "TiroDevanagariHindi-Italic.ttf", weight: "400", style: "italic" },
  { family: "Montserrat", file: "Montserrat[wght].ttf", weight: "100 900" },
  { family: "Cormorant Garamond", file: "CormorantGaramond[wght].ttf", weight: "300 700" },
  { family: "IBM Plex Mono", file: "IBMPlexMono-Regular.ttf", weight: "400" },
  { family: "IBM Plex Mono", file: "IBMPlexMono-Medium.ttf", weight: "500" },
  { family: "IBM Plex Mono", file: "IBMPlexMono-SemiBold.ttf", weight: "600" },
];

let started = false;

// Load every font once, before the first frame renders, so no frame shows a fallback face.
export const loadFonts = () => {
  if (started || typeof document === "undefined") return;
  started = true;
  const handle = delayRender("fonts");
  Promise.all(
    faces.map((f) => {
      const face = new FontFace(f.family, `url('${staticFile(`fonts/${f.file}`)}')`, {
        weight: f.weight ?? "400",
        style: f.style ?? "normal",
      });
      return face.load().then((loaded) => (document.fonts as unknown as { add: (f: FontFace) => void }).add(loaded));
    }),
  )
    .then(() => continueRender(handle))
    .catch((err) => {
      console.error("font load failed", err);
      continueRender(handle);
    });
};
