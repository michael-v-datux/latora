#!/usr/bin/env node
/**
 * Patches expo-notifications/build/PushTokenManager.native.js to use
 * requireOptionalNativeModule instead of requireNativeModule, so Expo Go
 * (which doesn't ship ExpoPushTokenManager) doesn't crash at bundle init.
 *
 * Run automatically via postinstall. Safe to re-run (idempotent).
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname, '..', 'node_modules',
  'expo-notifications', 'build', 'PushTokenManager.native.js'
);

if (!fs.existsSync(filePath)) {
  console.log('[patch-expo-notifications] File not found, skipping.');
  process.exit(0);
}

const original = fs.readFileSync(filePath, 'utf8');

// Already patched — idempotent
if (original.includes('requireOptionalNativeModule')) {
  console.log('[patch-expo-notifications] Already patched, skipping.');
  process.exit(0);
}

const patched = original.replace(
  `import { requireNativeModule } from 'expo-modules-core';\nexport default requireNativeModule('ExpoPushTokenManager');`,
  `import { requireOptionalNativeModule } from 'expo-modules-core';\nexport default requireOptionalNativeModule('ExpoPushTokenManager') ?? {};`
);

if (patched === original) {
  console.warn('[patch-expo-notifications] Pattern not found — skipping patch.');
  process.exit(0);
}

fs.writeFileSync(filePath, patched, 'utf8');
console.log('[patch-expo-notifications] Patched successfully.');
