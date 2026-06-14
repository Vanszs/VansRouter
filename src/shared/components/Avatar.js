"use client";

import Image from "next/image";
import { cn } from "@/shared/utils/cn";

const AVATAR_SIZES = {
  xs: "size-6 text-xs",
  sm: "size-8 text-sm",
  md: "size-10 text-base",
  lg: "size-12 text-lg",
  xl: "size-16 text-xl",
};

// Get initials from name
function getInitials(name) {
  if (!name) return "?";
  const parts = name.split(" ");
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

// Generate color from name
function getColorFromName(name) {
  if (!name) return "bg-primary";
  const colors = [
    "bg-red-500",
    "bg-orange-500",
    "bg-amber-500",
    "bg-yellow-500",
    "bg-lime-500",
    "bg-green-500",
    "bg-emerald-500",
    "bg-teal-500",
    "bg-cyan-500",
    "bg-sky-500",
    "bg-blue-500",
    "bg-indigo-500",
    "bg-violet-500",
    "bg-purple-500",
    "bg-fuchsia-500",
    "bg-pink-500",
    "bg-rose-500",
  ];
  const index = name.charCodeAt(0) % colors.length;
  return colors[index];
}

export default function Avatar({
  src,
  alt = "Avatar",
  name,
  size = "md",
  className,
}) {
  if (src) {
    return (
      <span
        className={cn(
          "relative inline-block rounded-full overflow-hidden",
          "ring-2 ring-white dark:ring-surface-dark shadow-sm",
          AVATAR_SIZES[size],
          className
        )}
      >
        <Image
          src={src}
          alt={alt}
          fill
          sizes="48px"
          className="object-cover"
          unoptimized
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "rounded-full flex items-center justify-center font-semibold text-white",
        "ring-2 ring-white dark:ring-surface-dark shadow-sm",
        AVATAR_SIZES[size],
        getColorFromName(name),
        className
      )}
      aria-label={alt}
    >
      {getInitials(name)}
    </span>
  );
}
