import { createContext, useContext, useLayoutEffect, useMemo, useState } from "react";
import { groupName, scopeLabel } from "./data.js";
import zhHant from "./zh-Hant.json";

const STORAGE_KEY = "courtside-language";
const ENGLISH = "en";
const CHINESE = "zh-Hant";
const LocaleContext = createContext(null);

function initialLanguage() {
  try {
    if (localStorage.getItem(STORAGE_KEY) === CHINESE) return CHINESE;
  } catch {
    // The picker still works when storage is unavailable.
  }
  return ENGLISH;
}

export function translate(language, message, values) {
  const text = language === CHINESE && Object.hasOwn(zhHant, message) ? zhHant[message] : message;
  return values ? text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`) : text;
}

export function localGroup(language, name) {
  if (language !== CHINESE || !name) return name;
  return name
    .replace(/^YOUTH\s+/i, "")
    .replace(/^GIRLS?\s+/i, "女子 ")
    .replace(/^BOYS?\s+/i, "男子 ")
    .replace(/\bGROUP\s+([A-Z]+)\b/gi, "$1 組")
    .replace(/^(女子 U\d+) ([A-Z])$/i, "$1 $2 組");
}

export function LocaleProvider({ children }) {
  const [language, setLanguage] = useState(initialLanguage);
  useLayoutEffect(() => {
    document.documentElement.lang = language;
    try { localStorage.setItem(STORAGE_KEY, language); } catch {}
  }, [language]);
  const value = useMemo(() => {
    const t = (message, values) => translate(language, message, values);
    const group = (name) => localGroup(language, name);
    return {
      language, setLanguage, t, group,
      scope: (season, id) => language === ENGLISH ? scopeLabel(season, id)
        : [group(groupName(season, id)), t("Season {season}", { season })].filter(Boolean).join(" · "),
    };
  }, [language]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function useT() {
  return useLocale().t;
}
