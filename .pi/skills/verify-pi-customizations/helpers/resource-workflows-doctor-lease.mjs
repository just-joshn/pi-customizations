import { readFileSync } from 'node:fs';

export function doctorLeasePolicy({ doctor }) {
  return readFileSync(doctor.profile, 'utf8');
}
