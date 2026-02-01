import { EXEFile } from "./index.ts";
import { Memory } from "./src/hardware/Memory.ts";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";
const exe = new EXEFile(exePath, [
    "/home/drazisil/mco-source/MCity",
    "/data/Downloads/Motor City Online",
    "/data/Downloads",
    "/data/Downloads/msvcrt",
    "/data/Downloads/kernel32",
    "/data/Downloads/ntdll",
]);

const mem = new Memory(1024 * 1024 * 1024);
exe.importResolver.setMemory(mem);

console.log("=== Tracing DLL Loading During buildIATMap ===\n");

// Manually step through the import table to see load order
const importTable = exe.importTable;
if (importTable) {
    for (const descriptor of importTable.descriptors) {
        console.log(`\nImport: ${descriptor.dllName}`);

        // Simulate what buildIATMap does
        const loadedDll = exe.importResolver.getDLLLoader().loadDLL(descriptor.dllName, mem);
        if (loadedDll) {
            console.log(`  Loaded at: 0x${loadedDll.baseAddress.toString(16)}-0x${(loadedDll.baseAddress + loadedDll.size).toString(16)}`);
        }
    }
}

console.log("\n=== Final Mappings ===\n");
const mappings = exe.importResolver.getAddressMappings();
for (const m of mappings) {
    console.log(`${m.dllName.padEnd(16)} 0x${m.baseAddress.toString(16)}-0x${m.endAddress.toString(16)}`);
}
