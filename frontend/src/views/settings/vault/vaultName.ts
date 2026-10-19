// Mirrors backend/core/vault.py _NAME_RE: must start alphanumeric, then
// letters/digits/dash/underscore, max 64 chars total.
export const VAULT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
