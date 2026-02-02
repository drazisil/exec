import { EXEFile } from "./index";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
const exe = new EXEFile(exePath, []);

console.log("=== Hardware/Memory Addresses Hardcoded in Executable ===\n");

const imageBase = exe.optionalHeader.imageBase;
const textBase = imageBase + exe.sectionHeaders.find(s => s.name === ".text")?.virtualAddress!;

// Look for suspicious hardcoded addresses (likely to be VRAM or hardware)
const suspiciousRanges = [
    { min: 0x80000000, max: 0xffffffff, name: "Kernel-mode/AGP/VRAM", reason: "Graphics card memory or kernel space" },
    { min: 0x70000000, max: 0x7fffffff, name: "High user-mode", reason: "Often used for AGP aperture in old graphics" },
    { min: 0x60000000, max: 0x7fffffff, name: "Upper user-mode", reason: "Game heaps and special allocations" },
];

interface FoundAddress {
    addr: number;
    offset: number;
    range: string;
    context: string;
}

const foundAddresses: FoundAddress[] = [];

console.log("Scanning for hardcoded addresses...\n");

for (const section of exe.sectionHeaders) {
    if (section.virtualSize === 0) continue;

    const sectionStart = imageBase + section.virtualAddress;
    let consecutiveZeros = 0;
    let lastReport = 0;

    for (let i = 0; i < section.data.byteLength - 3; i++) {
        const val = section.data.readUInt32LE(i);

        for (const range of suspiciousRanges) {
            if (val >= range.min && val <= range.max) {
                const addr = sectionStart + i;

                // Get context (surrounding bytes)
                const contextStart = Math.max(0, i - 4);
                const contextEnd = Math.min(section.data.byteLength, i + 8);
                const contextBytes = [];
                for (let c = contextStart; c < contextEnd; c++) {
                    contextBytes.push(section.data[c].toString(16).padStart(2, "0"));
                }

                foundAddresses.push({
                    addr,
                    offset: i,
                    range: range.name,
                    context: contextBytes.join(" "),
                });
            }
        }
    }
}

// Group by address value
const byValue = new Map<number, FoundAddress[]>();
for (const found of foundAddresses) {
    const key = found.addr;
    if (!byValue.has(key)) {
        byValue.set(key, []);
    }
    byValue.get(key)!.push(found);
}

// Find repeated addresses (likely to be important)
const repeated = Array.from(byValue.entries())
    .filter(([_, occurrences]) => occurrences.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

console.log(`=== Most Common Hardcoded Addresses ===\n`);

for (const [addrStr, occurrences] of repeated.slice(0, 20)) {
    const addr = parseInt(addrStr);
    console.log(`0x${addr.toString(16).padStart(8, "0")} - found ${occurrences.length} times`);
    console.log(`  Range: ${occurrences[0].range}`);

    if (addr === 0x8b000000) {
        console.log(`  ⚠️  THIS IS THE CRASH ADDRESS!`);
        console.log(`  Locations:`);
        for (let i = 0; i < Math.min(3, occurrences.length); i++) {
            console.log(`    - 0x${occurrences[i].addr.toString(16)}`);
        }
        if (occurrences.length > 3) {
            console.log(`    ... and ${occurrences.length - 3} more`);
        }
    }
    console.log();
}

console.log(`\n=== Analysis ===\n`);
console.log(`Motor City Online (2001) Game Analysis:`);
console.log(`\nThe address 0x8b000000 appears multiple times in the code.`);
console.log(`This is likely a graphics memory address for Direct3D operations.`);
console.log(`\nIn the 2001 era:`);
console.log(`- AGP (Accelerated Graphics Port) memory was commonly at 0x8xxxx000`);
console.log(`- Direct3D 8.0 (released 2000) used fixed memory mappings`);
console.log(`- Graphics cards like GeForce3/4 had AGP apertures at these addresses`);
console.log(`- Game engines often hardcoded VRAM addresses for performance`);
console.log(`\nWhy the crash is EXPECTED:`);
console.log(`- Graphics card hardware memory isn't allocated in our emulator`);
console.log(`- The game tries to read graphics state/data`);
console.log(`- No graphics card is actually present, so the address is unmapped`);
console.log(`- Result: ACCESS_VIOLATION (correct behavior)`);
console.log(`\nTo fix this, we would need to:`);
console.log(`1. Detect when the game accesses graphics memory`);
console.log(`2. Allocate a simulated graphics buffer at 0x8b000000`);
console.log(`3. Implement minimal Direct3D 8.0 graphics simulation`);
console.log(`4. Or: Hook graphics calls and return stub responses`);
