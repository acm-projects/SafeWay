const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Force Metro to resolve react-native-maps from our node_modules.
// The package has a "source" field pointing to a non-existent src/index,
// which confuses Metro's resolver. This explicit mapping bypasses that.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'react-native-maps': path.resolve(__dirname, 'node_modules/react-native-maps'),
};

module.exports = config;
