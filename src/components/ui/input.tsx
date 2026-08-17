"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Eye, EyeOff, AlertCircle, CheckCircle } from "lucide-react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  success?: boolean;
  icon?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, error, success, icon, ...props }, ref) => {
    const [showPassword, setShowPassword] = React.useState(false);
    const [isFocused, setIsFocused] = React.useState(false);
    const [hasValue, setHasValue] = React.useState(!!props.value || !!props.defaultValue);
    const inputRef = React.useRef<HTMLInputElement>(null);

    React.useImperativeHandle(ref, () => inputRef.current!);

    const isPassword = type === "password";
    const inputType = isPassword && showPassword ? "text" : type;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setHasValue(e.target.value.length > 0);
      props.onChange?.(e);
    };

    return (
      <div className="relative w-full">
        <div
          className={cn(
            "relative flex items-center rounded-xl border bg-[#111715] transition-all duration-300",
            isFocused && "border-emerald-500 ring-2 ring-emerald-500/20",
            error && "border-red-500 ring-2 ring-red-500/20",
            success && "border-emerald-500",
            !isFocused && !error && !success && "border-white/10 hover:border-white/20"
          )}
        >
          {icon && (
            <span className="absolute right-4 text-emerald-500/50">
              {icon}
            </span>
          )}
          <input
            type={inputType}
            className={cn(
              "peer h-14 w-full bg-transparent px-4 pt-4 pb-1 text-white placeholder-transparent outline-none text-base",
              icon && "pr-12",
              isPassword && "pl-12",
              className
            )}
            ref={inputRef}
            placeholder={label}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onChange={handleChange}
            {...props}
          />
          {label && (
            <label
              className={cn(
                "absolute right-4 text-gray-400 transition-all duration-200 pointer-events-none",
                icon && "right-12",
                (isFocused || hasValue) && "top-2 text-xs text-emerald-400",
                (!isFocused && !hasValue) && "top-1/2 -translate-y-1/2 text-base"
              )}
            >
              {label}
            </label>
          )}
          {isPassword && (
            <button
              type="button"
              className="absolute left-4 text-gray-400 hover:text-emerald-400 transition-colors"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          )}
          {error && (
            <span className="absolute left-4 text-red-400">
              <AlertCircle size={20} />
            </span>
          )}
          {success && !error && (
            <span className="absolute left-4 text-emerald-400">
              <CheckCircle size={20} />
            </span>
          )}
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-400 animate-slide-up flex items-center gap-1">
            <AlertCircle size={14} />
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export { Input };
