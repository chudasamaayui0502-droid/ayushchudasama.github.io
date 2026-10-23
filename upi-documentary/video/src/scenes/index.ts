import React from "react";
import { SceneProps } from "../timeline";
import { S00_ColdOpen, S01_Title } from "./cold";
import { S20_Vanish, S21_Machine, S22_Subsidy, S23_Gap, S24_Memory, S25_Budget } from "./turn";
import { S30_Law, S31_Notification, S32_Rules, S33_Revenue, S34_Countdown, S35_Map, S36_Court, S37_Deferral } from "./bill";
import { S40_Return, S41_WhoPays, S42_Question, S43_Coin, S50_Outro } from "./prestige";
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
  S20_Vanish,
  S21_Machine,
  S22_Subsidy,
  S23_Gap,
  S24_Memory,
  S25_Budget,
  S30_Law,
  S31_Notification,
  S32_Rules,
  S33_Revenue,
  S34_Countdown,
  S35_Map,
  S36_Court,
  S37_Deferral,
  S40_Return,
  S41_WhoPays,
  S42_Question,
  S43_Coin,
  S50_Outro,
};
