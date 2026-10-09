export function parseRecords(n = 10_000) {
  let checksum = 0;
  for (let i = 0; i < n; i += 1) {
    checksum = (checksum + (i * 17) % 251) % 1_000_003;
  }
  return checksum;
}
