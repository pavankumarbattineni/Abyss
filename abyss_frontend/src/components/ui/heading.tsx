import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const headingVariants = cva("font-heading text-foreground", {
  variants: {
    size: {
      xl: "text-2xl font-semibold",
      lg: "text-lg font-semibold",
      md: "text-base font-semibold",
      sm: "text-sm font-semibold",
      xs: "text-xs font-semibold uppercase tracking-wide text-muted-foreground",
    },
  },
  defaultVariants: {
    size: "lg",
  },
})

type HeadingElement = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "span" | "div"

function Heading({
  className,
  size,
  as: Comp = "h2",
  ...props
}: React.ComponentProps<"h1"> &
  VariantProps<typeof headingVariants> & {
    as?: HeadingElement
  }) {
  return (
    <Comp
      data-slot="heading"
      className={cn(headingVariants({ size, className }))}
      {...props}
    />
  )
}

export { Heading, headingVariants }
