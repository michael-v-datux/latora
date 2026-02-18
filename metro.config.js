const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Виключаємо серверну папку з Metro бандлу —
// вона містить Node.js модулі (express, cors, path, etc.)
// які несумісні з React Native runtime
config.watchFolders = [__dirname];
config.resolver.blockList = [
  new RegExp(`${path.resolve(__dirname, 'server').replace(/\\/g, '\\\\')}[\\/\\\\].*`),
];

module.exports = config;
