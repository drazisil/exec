/**
 * Setup verification script
 * Run: npx ts-node check-setup.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface CheckResult {
    name: string;
    pass: boolean;
    message: string;
}

const checks: CheckResult[] = [];

function check(name: string, condition: boolean, message: string) {
    checks.push({
        name,
        pass: condition,
        message
    });
    const icon = condition ? '✅' : '❌';
    console.log(`${icon} ${name}: ${message}`);
}

console.log('=== Electron Setup Verification ===\n');

// Check files exist
check(
    'package.json',
    fs.existsSync('package.json'),
    'Found'
);

check(
    'tsconfig.json',
    fs.existsSync('tsconfig.json'),
    'Found'
);

check(
    'public/index.html',
    fs.existsSync('public/index.html'),
    'Found'
);

check(
    'electron-main.ts',
    fs.existsSync('electron-main.ts'),
    'Found'
);

check(
    'electron-preload.ts',
    fs.existsSync('electron-preload.ts'),
    'Found'
);

// Check node_modules
check(
    'node_modules/electron',
    fs.existsSync('node_modules/electron'),
    fs.existsSync('node_modules/electron') ? 'Installed' : 'Run: npm install'
);

check(
    'node_modules/typescript',
    fs.existsSync('node_modules/typescript'),
    fs.existsSync('node_modules/typescript') ? 'Installed' : 'Run: npm install'
);

// Check dist
check(
    'dist/',
    fs.existsSync('dist'),
    fs.existsSync('dist') ? 'Compiled' : 'Run: npm run build'
);

if (fs.existsSync('dist')) {
    check(
        'dist/electron-main.js',
        fs.existsSync('dist/electron-main.js'),
        fs.existsSync('dist/electron-main.js') ? 'Found' : 'Recompile: npm run build'
    );

    check(
        'dist/electron-preload.js',
        fs.existsSync('dist/electron-preload.js'),
        fs.existsSync('dist/electron-preload.js') ? 'Found' : 'Recompile: npm run build'
    );
}

console.log('\n=== Summary ===\n');

const passed = checks.filter(c => c.pass).length;
const total = checks.length;

console.log(`${passed}/${total} checks passed`);

if (passed === total) {
    console.log('\n✅ Setup complete! Run: npm start');
} else {
    console.log('\n❌ Setup incomplete. Follow the suggestions above.');
    console.log('\nNext steps:');
    console.log('1. npm install');
    console.log('2. npm run build');
    console.log('3. npm start');
}
