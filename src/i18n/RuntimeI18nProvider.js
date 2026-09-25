"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { initRuntimeI18n, reloadTranslations } from "./runtime";

export function RuntimeI18nProvider({ children }) {
  const pathname = usePathname();

  useEffect(() => {
    initRuntimeI18n();
  }, []);

  useEffect(() => {
    if (pathname) reloadTranslations();
  }, [pathname]);

  return <>{children}</>;
}
