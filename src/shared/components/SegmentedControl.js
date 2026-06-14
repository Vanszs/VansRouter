"use client";

import { cn } from "@/shared/utils/cn";

const SEGMENT_SIZES = {
  sm: "h-7 text-xs",
  md: "h-9 text-sm",
  lg: "h-11 text-base",
};

const EMPTY_OPTIONS = [];

export default function SegmentedControl({
  options = EMPTY_OPTIONS,
  value,
  onChange,
  size = "md",
  className,
}) {

  return (
    <div
      className={cn(
        "inline-flex items-center p-1 rounded-[10px] overflow-x-auto",
        "bg-surface-2",
        className
      )}
    >
      {options.map((option) => (
        <button type="button"
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "shrink-0 px-4 rounded-[8px] font-medium transition-all",
            SEGMENT_SIZES[size],
            value === option.value
              ? "bg-surface text-text-main shadow-sm"
              : "text-text-muted hover:text-text-main"
          )}
        >
          {option.icon && (
            <span className="material-symbols-outlined text-[16px] mr-1.5">
              {option.icon}
            </span>
          )}
          {option.label}
        </button>
      ))}
    </div>
  );
}
