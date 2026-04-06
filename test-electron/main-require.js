// Test 1: require('electron') - classic approach
console.log('process.versions.electron:', process.versions.electron);
console.log('process.type:', process.type);

try {
  const electron = require('electron');
  console.log('require("electron") type:', typeof electron);
  if (typeof electron === 'string') {
    console.log('FAIL: got path string:', electron);
  } else if (electron && electron.app) {
    console.log('SUCCESS: got electron module with app');
  } else {
    console.log('PARTIAL: got', Object.keys(electron || {}));
  }
} catch (e) {
  console.log('require("electron") THREW:', e.message);
}

try {
  const electron = require('electron/main');
  console.log('require("electron/main") type:', typeof electron);
  if (electron && electron.app) {
    console.log('SUCCESS electron/main: got app');
  } else {
    console.log('electron/main keys:', Object.keys(electron || {}));
  }
} catch (e) {
  console.log('require("electron/main") THREW:', e.message);
}

try {
  const { app } = require('electron');
  console.log('destructure app from require("electron"):', typeof app);
} catch (e) {
  console.log('destructure THREW:', e.message);
}

// Test process._linkedBinding
try {
  const features = process._linkedBinding('electron_common_features');
  console.log('linkedBinding electron_common_features works:', typeof features);
} catch(e) {
  console.log('linkedBinding features THREW:', e.message);
}

// Check module paths
console.log('module.paths[0]:', module.paths && module.paths[0]);

setTimeout(() => {
  console.log('exiting...');
  process.exit(0);
}, 2000);
