// Expo's auto-generated expo-env.d.ts references the full `expo/types`, which
// pulls in `expo/types/react-native-web`. That file augments react-native's
// ViewProps/ViewStyle/TextProps/etc. as *interfaces*, which conflicts with the
// strict API's *type-alias* declarations (customConditions: react-native-strict-api)
// and breaks every library component typed `ViewProps & {...}` (expo-linear-gradient,
// expo-image, expo-router Link, ...). We exclude expo-env.d.ts from tsc (see tsconfig
// "exclude") and re-reference only the Expo ambient types we actually need here —
// deliberately omitting react-native-web. See issue #288.
/// <reference path="../node_modules/expo/types/global.d.ts" />
/// <reference path="../node_modules/expo/types/metro-require.d.ts" />
