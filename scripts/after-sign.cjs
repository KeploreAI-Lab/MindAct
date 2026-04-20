/**
 * after-sign.cjs — electron-builder afterSign hook
 *
 * When no real Apple Developer certificate is configured (identity: null),
 * electron-builder produces an UNSIGNED app bundle. macOS Gatekeeper then
 * reports any downloaded copy as "damaged" (rather than merely "unverified"),
 * because it detects neither a valid nor an ad-hoc signature.
 *
 * Ad-hoc signing (`codesign --sign -`) adds a self-signed mark that satisfies
 * Gatekeeper's basic integrity check. The app still cannot be notarized (users
 * see "unverified developer"), but the "damaged" error goes away. Users open it
 * with right-click → Open, or via System Settings → Privacy & Security.
 *
 * This hook runs in CI (GitHub Actions macos-latest runner) where codesign is
 * always available. It is a no-op on non-macOS builders.
 */

'use strict';
const { execSync } = require('child_process');
const path = require('path');

module.exports = async function afterSign(context) {
  // Only applies to macOS builds
  if (process.platform !== 'darwin') return;

  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`[after-sign] Ad-hoc signing: ${appPath}`);
  try {
    execSync(
      `codesign --force --deep --sign - "${appPath}"`,
      { stdio: 'inherit' },
    );
    console.log('[after-sign] Ad-hoc signing complete.');
  } catch (err) {
    // Non-fatal — still produces a usable DMG, just without the signature.
    console.warn('[after-sign] Ad-hoc signing failed (non-fatal):', err.message);
  }
};
