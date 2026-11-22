"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Languages } from "lucide-react";
import {
  appTitle,
  appDescription,
  englishText,
  thaiText,
  languageCookie,
  type Language,
} from "./messages";

type LanguageContextValue = {
  language: Language;
  t: (text: string) => string;
  toggle: () => void;
};
const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
  initial,
  children,
}: {
  initial: Language;
  children: ReactNode;
}) {
  const [language, setLanguage] = useState(initial);

  function toggle() {
    const next = language === "th" ? "en" : "th";
    document.cookie = `${languageCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = next;
    const localize = next === "en" ? englishText : thaiText;
    document.title = localize(appTitle);
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", localize(appDescription));
    setLanguage(next);
  }

  return (
    <LanguageContext.Provider
      value={{
        language,
        toggle,
        t: language === "en" ? englishText : thaiText,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("LanguageProvider is required");
  return context;
}

export function useNotice() {
  const { t } = useLanguage();
  const [notice, setNotice] = useState<{
    text: string;
    values: Record<string, string>;
  }>({ text: "", values: {} });
  const message = t(notice.text).replace(
    /\{(\w+)\}/g,
    (placeholder, key: string) => notice.values[key] ?? placeholder,
  );
  function setMessage(text: string, values: Record<string, string> = {}) {
    setNotice({ text, values });
  }
  return [message, setMessage] as const;
}

export function LanguageToggle() {
  const { language, toggle } = useLanguage();
  const target = language === "th" ? "en" : "th";
  const label = target === "en" ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      lang={target}
      className="inline-flex min-h-12 shrink-0 items-center justify-center gap-1 rounded-lg border border-[#B8C7BC] bg-white px-2 text-sm font-semibold text-[#1B4332] hover:bg-[#EBF2ED]"
    >
      <Languages aria-hidden="true" size={16} />
      {target === "en" ? "EN" : "ไทย"}
    </button>
  );
}
