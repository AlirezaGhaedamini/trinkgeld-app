/**
 * Money helpers. Amounts entered by hand live in **cents** (integers) so the
 * keypad never accumulates float error; only the final display converts.
 */

export function centsToAmount(cents: number): number {
  return cents / 100;
}

export function amountToCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Append a digit to a cents value, with an upper bound to stop overflow. */
export function pushDigit(cents: number, digit: number, max = 99_999_999): number {
  return Math.min(cents * 10 + digit, max);
}

/** Remove the last digit — the keypad's backspace. */
export function popDigit(cents: number): number {
  return Math.floor(cents / 10);
}
