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
]);

const mem = new Memory(1024 * 1024 * 1024);
exe.importResolver.setMemory(mem);
exe.importResolver.buildIATMap(exe.importTable, exe.optionalHeader.imageBase);

console.log("=== Address Mappings After buildIATMap ===\n");

const mappings = exe.importResolver.getAddressMappings();
for (const mapping of mappings) {
    console.log(`${mapping.dllName.padEnd(16)} 0x${mapping.baseAddress.toString(16).padStart(8, '0')}-0x${mapping.endAddress.toString(16).padStart(8, '0')}`);
}

console.log(`\nTotal DLLs loaded: ${mappings.length}`);

// Check what DLL owns 0x12022cb0
const testAddr = 0x12022cb0;
const owner = exe.importResolver.findDLLForAddress(testAddr);
console.log(`\nAddress 0x12022cb0 owned by: ${owner ? owner.name : "NONE"}`);
