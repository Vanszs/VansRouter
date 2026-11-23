const fs = require("fs");

// Owner read/write only: the Root CA private key can sign a certificate for
// any domain once the CA is trusted, so no other local user may read it.
const PRIVATE_KEY_MODE = 0o600;

/**
 * Best-effort enforce owner-only permissions on a private key file.
 *
 * Older releases wrote rootCA.key with the process umask (usually 0644), so an
 * existing install must be retro-fitted, not just new keys. POSIX modes are
 * ignored on Windows (ACLs govern access) and can be unsupported on some
 * filesystems, so a chmod failure is not fatal — the key stays usable, just
 * without the extra hardening.
 *
 * @param {string} keyPath  absolute path to the private key
 * @param {number} [mode]   desired POSIX mode, defaults to 0600
 * @returns {boolean} true when the key exists and is (now) restricted
 */
function restrictPrivateKeyPermissions(keyPath, mode = PRIVATE_KEY_MODE) {
  if (!keyPath) return false;
  try {
    if (!fs.existsSync(keyPath)) return false;
    if ((fs.statSync(keyPath).mode & 0o777) === mode) return true;
    fs.chmodSync(keyPath, mode);
    return true;
  } catch {
    return false;
  }
}

module.exports = { restrictPrivateKeyPermissions, PRIVATE_KEY_MODE };
