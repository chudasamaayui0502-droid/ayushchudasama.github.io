import React from "react";
import { SceneProps } from "../timeline";
import { S00_ColdOpen, S01_Title } from "./cold";
import { S11_ThreeParts, S12_QR, S13_Launch, S14_ZeroMDR, S15_Explosion, S16_PledgeEnd } from "./pledge";

export const SCENES: Record<string, React.FC<SceneProps>> = {
  S00_ColdOpen,
  S01_Title,
  S11_ThreeParts,
  S12_QR,
  S13_Launch,
  S14_ZeroMDR,
  S15_Explosion,
  S16_PledgeEnd,
};
