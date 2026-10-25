import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-xs bg-surface-hover motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Skeleton }
