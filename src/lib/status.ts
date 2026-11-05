export const ORDER_STATUS: Record<string, { label: string; tone: string }> = {
  AWAITING_PAYMENT: { label: "Awaiting payment", tone: "bg-amber-tint text-amber-deep" },
  ACTIVE: { label: "In progress", tone: "bg-green-tint text-green" },
  DELIVERED: { label: "Delivered", tone: "bg-green-tint text-green" },
  COMPLETED: { label: "Completed", tone: "bg-line text-ink" },
  CANCELLED: { label: "Cancelled", tone: "bg-line text-ink-muted" },
  DISPUTED: { label: "In dispute", tone: "bg-amber-tint text-amber-deep" },
};
