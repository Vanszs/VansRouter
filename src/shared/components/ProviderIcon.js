"use client";

import { useState } from "react";
import PropTypes from "prop-types";
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

ProviderIcon.propTypes = {
  src: PropTypes.string,
  providerId: PropTypes.string,
  alt: PropTypes.string,
  size: PropTypes.number,
  className: PropTypes.string,
  fallbackText: PropTypes.string,
  fallbackColor: PropTypes.string,
};
