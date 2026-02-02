// The pointer at 0x81818 in KERNEL32 contains 0xa54f0
// This is a small value (0xa54f0 = 676080 decimal)
// It's NOT a full 32-bit address

// In the executable at 0x400000 (image base), 0xa54f0 is at RVA 0x654f0
// which is within the executable's sections

// So this pointer is pointing to the MAIN EXECUTABLE, not to a DLL
// And it's NOT a full address - it's RVA!

console.log("=== Analyzing the pointer at 0x81818 ===");
console.log("");
console.log("Value in KERNEL32 at RVA 0x81818: 0xa54f0");
console.log("");
console.log("This appears to be an RVA, not a full address");
console.log("If interpreted as RVA from main exe base (0x400000):");
console.log("  Full address = 0x400000 + 0xa54f0 = 0x40a54f0");
console.log("");
console.log("Is 0xa54f0 a valid RVA in MCity_d.exe?");

import { EXEFile } from "./index";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
const exe = new EXEFile(exePath, []);

console.log(`Image base: 0x${exe.optionalHeader.imageBase.toString(16)}`);

// Check which section contains RVA 0xa54f0
const rva = 0xa54f0;
for (const section of exe.sectionHeaders) {
    if (rva >= section.virtualAddress && rva < section.virtualAddress + section.virtualSize) {
        console.log(`RVA 0x${rva.toString(16)} is in section ${section.name}`);
        console.log(`  Section VA: 0x${section.virtualAddress.toString(16)}`);
        console.log(`  Section size: 0x${section.virtualSize.toString(16)}`);
        console.log(`  Offset in section: 0x${(rva - section.virtualAddress).toString(16)}`);
        break;
    }
}

console.log("");
console.log("CONCLUSION: This pointer should NOT be relocated!");
console.log("It's stored as a small value (RVA or already-adjusted address)");
console.log("The relocation table intentionally excludes it");
