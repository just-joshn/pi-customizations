export type BadgeProps = {
  status: 'ok' | 'warn' | 'err';
  label?: string;
};

export function Badge(props: BadgeProps) {
  return props.label ?? props.status;
}
