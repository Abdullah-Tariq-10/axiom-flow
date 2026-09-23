import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
  {
    variants: {
      variant: {
        idle: "border-slate-300 bg-slate-100 text-slate-600",
        running: "border-amber-300 bg-amber-100 text-amber-700 animate-pulse",
        yes: "border-emerald-300 bg-emerald-100 text-emerald-700",
        no: "border-rose-300 bg-rose-100 text-rose-700",
        done: "border-blue-300 bg-blue-100 text-blue-700",
        error: "border-red-400 bg-red-100 text-red-700",
      },
    },
    defaultVariants: { variant: "idle" },
  }
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}