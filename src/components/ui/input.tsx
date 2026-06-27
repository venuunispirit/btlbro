"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    const { theme } = useTheme();
    const isDark = theme === "dark";

    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E87A1E] disabled:cursor-not-allowed disabled:opacity-50",
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
Input.displayName = "Input";

export { Input };
