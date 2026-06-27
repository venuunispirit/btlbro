"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    const { theme } = useTheme();
    const isDark = theme === "dark";

    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-lg border px-3 py-2 text-sm ring-offset-background placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E87A1E] disabled:cursor-not-allowed disabled:opacity-50",
          isDark
            ? "border-[#333] bg-[#1a1a1a] text-white"
            : "border-gray-200 bg-gray-50 text-gray-900",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
