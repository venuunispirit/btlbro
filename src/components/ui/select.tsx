"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
  placeholder?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, placeholder, ...props }, ref) => {
    const { theme } = useTheme();
    const isDark = theme === "dark";

    return (
<select
            className={cn(
              "flex h-10 w-full rounded-lg border px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E87A1E] disabled:cursor-not-allowed disabled:opacity-50",
              isDark
                ? "border-white/20 bg-[#2a2a2a] text-white"
                : "border-gray-200 bg-gray-50 text-gray-900",
              className
            )}
            ref={ref}
            {...props}
          >
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  }
);
Select.displayName = "Select";

export { Select };
