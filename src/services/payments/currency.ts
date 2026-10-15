/**
 * Minor-unit conversion for gateways that speak decimal major units
 * (Flutterwave). Zero-decimal currencies have no minor unit, so "minor" and
 * "major" are the same number; everything else is 2-decimal.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

export function isZeroDecimalCurrency(currency: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase());
}

/** Integer minor units -> decimal major-unit string ("10.00", or "500" for JPY). */
export function minorToMajor(amountMinor: number, currency: string): string {
  return isZeroDecimalCurrency(currency) ? String(amountMinor) : (amountMinor / 100).toFixed(2);
}

/** Decimal major-unit amount (number) -> integer minor units. */
export function majorToMinor(amountMajor: number, currency: string): number {
  return isZeroDecimalCurrency(currency) ? Math.round(amountMajor) : Math.round(amountMajor * 100);
}
