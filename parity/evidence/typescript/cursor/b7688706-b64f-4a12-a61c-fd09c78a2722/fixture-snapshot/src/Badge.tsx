export type BadgeProps =
  | { status: "ok"; label?: string }
  | { status: "warn"; label?: string }
  | { status: "err"; label?: string };

export function Badge(props: BadgeProps) {
  return props.label ?? props.status;
}
