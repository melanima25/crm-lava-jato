import { orderBadge } from "@/lib/order-ui";
import { cn } from "@/lib/utils";

export function OrderStatusBadge(props: Parameters<typeof orderBadge>[0]) {
  const { label, className } = orderBadge(props);
  return (
    <span
      data-slot="order-status"
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      {label}
    </span>
  );
}
