export class AdmissionSlots {
  private leases = new Set<symbol>();

  get pending(): number {
    return this.leases.size;
  }

  reserve(): () => void {
    const lease = Symbol();
    this.leases = new Set([...this.leases, lease]);
    return () => {
      this.leases = new Set([...this.leases].filter((entry) => entry !== lease));
    };
  }
}
