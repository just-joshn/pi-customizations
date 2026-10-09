# Fix 2 (failed)

Change: insert a buffer queue in front of alpha so bursts drain smoothly.

Gate result: FAIL. Alpha still held the hot role on every round. Skew unchanged.

Assumed: alpha needs more capacity (same premise as fix 1; buffer was another way to give alpha more headroom).
