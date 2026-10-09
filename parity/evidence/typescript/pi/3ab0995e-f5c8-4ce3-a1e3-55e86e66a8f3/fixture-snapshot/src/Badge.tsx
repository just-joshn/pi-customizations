export type BadgeStatus = 'ok' | 'warn' | 'err';

export type BadgeProps = {
  status: BadgeStatus;
  label?: string;
};

export function Badge(props: BadgeProps) {
  return props.label ?? props.status;
}
