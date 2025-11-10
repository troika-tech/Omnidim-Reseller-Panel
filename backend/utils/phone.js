// Helper utilities for working with phone numbers

/**
 * Normalize a phone number for consistent comparisons.
 * - Keeps digits only
 * - Strips leading country codes by taking the last 10 digits for long numbers
 * - Returns null for empty or invalid numbers
 *
 * @param {string|number|null|undefined} input
 * @returns {string|null} normalized 10+ digit string or null if empty
 */
function normalizePhoneNumber(input) {
  if (input === null || input === undefined) {
    return null;
  }

  const digitsOnly = String(input).replace(/\D+/g, "");
  if (!digitsOnly) {
    return null;
  }

  // For numbers longer than 10 digits (e.g. +91XXXXXXXXXX), take the last 10 digits
  const trimmed =
    digitsOnly.length > 10 ? digitsOnly.slice(digitsOnly.length - 10) : digitsOnly;

  return trimmed;
}

module.exports = {
  normalizePhoneNumber,
};

