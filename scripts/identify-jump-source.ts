import { EXEFile } from "./index";
import { DLLLoader } from "./src/loader/DLLLoader";
import { Memory } from "./src/hardware/Memory";

const mem = new Memory(1024 * 1024 * 1024);
const loader = new DLLLoader([
    "/data/Downloads/kernel32",
    "/data/Downloads/msvcrt",
    "/data/Downloads/ntdll",
]);

// Load several DLLs to see address ranges
const kernel32 = loader.loadDLL("KERNEL32.dll", mem);
const msvcrt = loader.loadDLL("MSVCRT.dll", mem);
const ntdll = loader.loadDLL("NTDLL.dll", mem);

console.log("\n=== DLL Address Ranges ===\n");
if (kernel32) {
    console.log(`KERNEL32: 0x${kernel32.baseAddress.toString(16)}-0x${(kernel32.baseAddress + kernel32.size).toString(16)}`);
}
if (msvcrt) {
    console.log(`MSVCRT:   0x${msvcrt.baseAddress.toString(16)}-0x${(msvcrt.baseAddress + msvcrt.size).toString(16)}`);
}
if (ntdll) {
    console.log(`NTDLL:    0x${ntdll.baseAddress.toString(16)}-0x${(ntdll.baseAddress + ntdll.size).toString(16)}`);
}

console.log(`\nJump target: 0x12022cb0`);

// Which DLL does 0x12022cb0 actually belong to?
const jumpAddr = 0x12022cb0;
const allDlls = [
    { name: "KERNEL32", base: 0x10000000, size: 0x01000000 },
    { name: "MSVCRT", base: 0x11000000, size: 0x01000000 },
    { name: "NTDLL", base: 0x12000000, size: 0x01000000 },
];

for (const dll of allDlls) {
    const endAddr = dll.base + dll.size;
    if (jumpAddr >= dll.base && jumpAddr < endAddr) {
        console.log(`✓ 0x12022cb0 is in ${dll.name} (offset 0x${(jumpAddr - dll.base).toString(16)})`);

        // Try to read code at that location
        const bytes = [];
        for (let i = 0; i < 16; i++) {
            bytes.push(mem.read8(jumpAddr + i));
        }
        console.log(`  Bytes: ${bytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
        break;
    }
}
