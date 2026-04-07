console.log('process.type:', process.type);
console.log('process.versions.electron:', process.versions.electron);
const electronPath = require('electron');
console.log('typeof electronPath:', typeof electronPath);
console.log('electronPath value:', JSON.stringify(electronPath).slice(0, 100));
process.exit(0);
