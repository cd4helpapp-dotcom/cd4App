const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

const expoNestedNodeModules = path.resolve(projectRoot, 'node_modules', 'expo', 'node_modules');
const projectNodeModules = path.resolve(projectRoot, 'node_modules');

const extraNodeModulePaths = [projectNodeModules];
if (fs.existsSync(expoNestedNodeModules)) {
  extraNodeModulePaths.push(expoNestedNodeModules);
  config.watchFolders = [...new Set([...(config.watchFolders || []), expoNestedNodeModules])];
}

config.resolver.nodeModulesPaths = [
  ...new Set([...(config.resolver.nodeModulesPaths || []), ...extraNodeModulePaths]),
];

module.exports = config;
