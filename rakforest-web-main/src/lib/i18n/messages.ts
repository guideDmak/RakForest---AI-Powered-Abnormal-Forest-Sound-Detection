import english from "./en.json";

export type Language = "th" | "en";
export const languageCookie = "rakforest-language";
export const appTitle = "RakForest — ระบบเฝ้าระวังไฟป่าและตรวจจับเสียงผิดปกติในป่าไม้";
export const appDescription =
  "ระบบศูนย์สั่งการ GIS ตรวจจับเสียงผิดปกติในป่าด้วย AI (AudioCNN) บริหารจัดการโซนป่าไม้ เสาไมค์ตรวจจับเสียง และปฏิบัติการภาคสนาม";
const messages: Readonly<Record<string, string>> = english;

export function englishText(text: string) {
  const key = text.trim();
  return Object.hasOwn(messages, key)
    ? text.replace(key, () => messages[key])
    : text;
}

export const thaiText = (text: string) => text;
