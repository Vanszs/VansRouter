"use client";

import { useState } from "react";
import { getProviderIconSrc, markProviderIconMissing } from "@/shared/utils/providerIcon";

export default function ProviderIcon({
  src,
  providerId,
  alt,
  size = 32,
  className = "",
  fallbackText = "?",
  fallbackColor,
}) {
  const providerName = providerId || (src ? String(src).match(/^\/providers\/([^/.]+)/i)?.[1] : null);
  const effectiveSrc = providerName ? getProviderIconSrc(providerName) : src;
  const [errored, setErrored] = useState(false);

  if (providerName === "a6api" || providerName === "a6api-cli") {
    return (
      <span
        className={`inline-flex items-center justify-center font-bold rounded-full ${className}`.trim()}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          position: "relative",
          overflow: "hidden",
          color: "var(--navy, #1F2937)",
          fontSize: `${Math.max(10, Math.floor(size * 0.35))}px`,
          letterSpacing: 0,
          background: "radial-gradient(circle at 34% 28%, rgba(255, 255, 255, .38), transparent 22%), conic-gradient(from 210deg, #3157ff, #16b8a6, #74c86a, #3157ff)",
          boxShadow: "0 12px 26px #3157ff38",
          isolation: "isolate",
        }}
      >
        <span>A6</span>
      </span>
    );
  }

  if (!effectiveSrc || errored) {
    return (
      <span
        className={`inline-flex items-center justify-center font-bold rounded-lg ${className}`.trim()}
        style={{
          width: size,
          height: size,
          color: fallbackColor,
          fontSize: Math.max(10, Math.floor(size * 0.38)),
        }}
      >
        {fallbackText}
      </span>
    );
  }

  return (
    <img
      src={effectiveSrc}
      alt={alt}
      width={size}
      height={size}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (providerName) markProviderIconMissing(providerName);
        setErrored(true);
      }}
    />
  );
}
