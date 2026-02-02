/**
 * Lists all DLLs that the emulator fails to load.
 * Run with: node --experimental-strip-types scripts/list-missing-dlls.ts
 *
 * Captures loader output and extracts "not found" and "UNRESOLVED" lines,
 * then summarizes what's missing.
 */

import { EXEFile } from "../index.ts";
import { Memory } from "../src/hardware/Memory.ts";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";

const exe = new EXEFile(exePath, [
    "/home/drazisil/mco-source/MCity",
    "/data/Downloads/Motor City Online",
    "/data/Downloads",
    "/data/Downloads/msvcrt",
    "/data/Downloads/kernel32",
    "/data/Downloads/ntdll",
    "/data/Downloads/user32",
    "/data/Downloads/shell32",
    "/data/Downloads/gdi32",
    "/data/Downloads/comctl32",
    "/data/Downloads/comdlg32",
    "/data/Downloads/advapi32",
    "/data/Downloads/ole32",
    "/data/Downloads/oleaut32",
    "/data/Downloads/rpcrt4",
    "/data/Downloads/dsound",
    "/data/Downloads/dinput",
    "/data/Downloads/dinput8",
    "/data/Downloads/winmm",
    "/data/Downloads/wininet",
    "/data/Downloads/wsock32",
    "/data/Downloads/version",
    "/data/Downloads/ifc22",
    "/data/Downloads/d3d8",
    "/data/Downloads/kernelbase(1)",
    "/data/Downloads/api-ms-win-core-apiquery-l1-1-0",
    "/data/Downloads/api-ms-win-core-console-l1-1-0",
    "/data/Downloads/api-ms-win-core-datetime-l1-1-0",
    "/data/Downloads/api-ms-win-core-errorhandling-l1-1-1",
    "/data/Downloads/api-ms-win-core-namedpipe-l1-1-0",
    "/data/Downloads/api-ms-win-core-processthreads-l1-1-0",
    "/data/Downloads/api-ms-win-core-processthreads-l1-1-2",
    "/data/Downloads/api-ms-win-core-profile-l1-1-0",
    "/data/Downloads/api-ms-win-core-rtlsupport-l1-1-0",
    "/data/Downloads/api-ms-win-core-synch-ansi-l1-1-0",
    "/data/Downloads/api-ms-win-core-synch-l1-1-0",
    "/data/Downloads/api-ms-win-core-synch-l1-2-0",
    "/data/Downloads/api-ms-win-core-sysinfo-l1-1-0",
    "/data/Downloads/api-ms-win-core-sysinfo-l1-2-1",
    "/data/Downloads/api-ms-win-core-util-l1-1-0",
]);

// Capture console.log output
const originalLog = console.log;
const logLines: string[] = [];
console.log = (...args: any[]) => {
    logLines.push(args.join(' '));
};

const mem = new Memory(2 * 1024 * 1024 * 1024);
exe.importResolver.setMemory(mem);
exe.importResolver.buildIATMap(exe.importTable, exe.optionalHeader.imageBase);

// Restore console
console.log = originalLog;

// Parse results
const missingDLLs = new Set<string>();
const unresolvedImports: { dll: string; func: string }[] = [];

for (const line of logLines) {
    // Match "Could not find X" or "not found"
    const notFoundMatch = line.match(/Could not find (.+)/);
    if (notFoundMatch) {
        missingDLLs.add(notFoundMatch[1]);
    }
    const notFound2 = line.match(/(\S+\.dll) not found/i);
    if (notFound2) {
        missingDLLs.add(notFound2[1]);
    }

    // Match UNRESOLVED imports
    const unresolvedMatch = line.match(/=> (.+?)!(.+?) UNRESOLVED/);
    if (unresolvedMatch) {
        unresolvedImports.push({ dll: unresolvedMatch[1], func: unresolvedMatch[2] });
    }
}

// Group unresolved by DLL
const unresolvedByDLL = new Map<string, string[]>();
for (const { dll, func } of unresolvedImports) {
    if (!unresolvedByDLL.has(dll)) unresolvedByDLL.set(dll, []);
    unresolvedByDLL.get(dll)!.push(func);
}

// Print summary
console.log("=== Missing DLLs (not found on disk) ===\n");

// Separate api-ms-win-* from regular DLLs
const missingApiMs = [...missingDLLs].filter(d => d.toLowerCase().startsWith('api-ms-win-')).sort();
const missingRegular = [...missingDLLs].filter(d => !d.toLowerCase().startsWith('api-ms-win-')).sort();

if (missingRegular.length > 0) {
    console.log(`Regular DLLs (${missingRegular.length}):`);
    for (const dll of missingRegular) {
        console.log(`  - ${dll}`);
    }
}

if (missingApiMs.length > 0) {
    console.log(`\napi-ms-win-* forwarding DLLs (${missingApiMs.length}):`);
    console.log("  (These are thin forwarders - functions are resolved from loaded DLLs)");
    for (const dll of missingApiMs) {
        console.log(`  - ${dll}`);
    }
}

console.log(`\n=== Unresolved Imports (${unresolvedImports.length} total) ===\n`);
const sortedDLLs = [...unresolvedByDLL.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [dll, funcs] of sortedDLLs) {
    console.log(`${dll} (${funcs.length} unresolved):`);
    for (const func of funcs.sort()) {
        console.log(`  - ${func}`);
    }
}

if (unresolvedImports.length === 0) {
    console.log("None! All imports resolved.");
}
