// Metro configuration for Expo.
//
// Uses Expo's default Metro pipeline with NO custom transformer, resolver,
// or plugin overrides. This preserves the hermesc chain and the AAB / IPA
// build path exactly as Expo ships it.
//
// The bare `getDefaultConfig(__dirname)` call is the canonical Expo pattern
// documented at https://docs.expo.dev/guides/customizing-metro/ and is
// the reference shape the OnSpace template's Metro dependency-tree check
// expects. Returning the default config unchanged also lets Expo's Metro
// resolve the correct set of transitive Metro packages for the installed
// Expo SDK / React Native version — matching the template manifest.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
