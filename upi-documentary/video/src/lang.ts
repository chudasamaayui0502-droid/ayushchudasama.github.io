import React, { useContext } from "react";

export type Lang = "hi" | "en";

/** Which edition is rendering. Main / SegmentPreview provide it; scenes read it. */
export const LangCtx = React.createContext<Lang>("hi");

export const useLang = () => useContext(LangCtx);

/** t("हिंदी", "English") → the string for the current edition. */
export const useT = () => {
  const lang = useLang();
  return <T,>(hi: T, en: T): T => (lang === "en" ? en : hi);
};
