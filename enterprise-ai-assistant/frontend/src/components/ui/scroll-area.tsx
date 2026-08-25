import * as React from "react";
import { cn } from "@/lib/utils";

// Simple scroll-area wrapper using native scrolling (avoids Radix portal overhead).
export const ScrollArea = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={cn("overflow-auto", className)} {...props}>
      {children}
    </div>
  ),
);
ScrollArea.displayName = "ScrollArea";
