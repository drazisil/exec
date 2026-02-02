import { EXEFile } from "./index";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
const exe = new EXEFile(exePath, []);

console.log("=== Main Executable Sections ===\n");

for (const section of exe.sectionHeaders) {
    console.log(`${section.name.padEnd(8)} VA: 0x${section.virtualAddress.toString(16).padStart(8, '0')}-0x${(section.virtualAddress + section.virtualSize).toString(16).padStart(8, '0')} (0x${section.virtualSize.toString(16).padStart(8, '0')} bytes)`);
    console.log(`           Data size: 0x${section.data.byteLength.toString(16).padStart(8, '0')} bytes`);
    console.log(`           Characteristics: 0x${section.characteristics.toString(16).padStart(8, '0')}`);

    const flags = [];
    if (section.characteristics & 0x00000020) flags.push("CODE");
    if (section.characteristics & 0x00000040) flags.push("INITIALIZED_DATA");
    if (section.characteristics & 0x00000080) flags.push("UNINITIALIZED_DATA");
    if (section.characteristics & 0x02000000) flags.push("DISCARDABLE");
    if (section.characteristics & 0x20000000) flags.push("EXECUTE");
    if (section.characteristics & 0x40000000) flags.push("READ");
    if (section.characteristics & 0x80000000) flags.push("WRITE");

    console.log(`           Flags: ${flags.join(", ")}`);
    console.log();
}

console.log("\n=== Key Info ===");
console.log(`Image Base: 0x${exe.optionalHeader.imageBase.toString(16)}`);
console.log(`Entry Point RVA: 0x${exe.optionalHeader.addressOfEntryPoint.toString(16)}`);

// Check if there are any uninitialized sections that are larger than their raw size
console.log("\n=== Sections with Uninitialized Data ===");
for (const section of exe.sectionHeaders) {
    if (section.virtualSize > section.data.byteLength) {
        const uninitSize = section.virtualSize - section.data.byteLength;
        console.log(`${section.name}: ${uninitSize} bytes of uninitialized data`);
        console.log(`  VA Range: 0x${(section.virtualAddress + section.data.byteLength).toString(16)}-0x${(section.virtualAddress + section.virtualSize).toString(16)}`);
        console.log(`  This data needs to be zero-initialized in memory!`);
    }
}
