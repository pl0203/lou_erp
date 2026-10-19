export function registerCustomerTargetTests(
  test: (name: string, run: () => Promise<void>) => unknown,
  createCustomerTargetSender: typeof import('../../src/lib/catalogue/customerTargets').createCustomerTargetSender,
): void
