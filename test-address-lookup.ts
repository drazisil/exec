import { EXEFile } from "./index.ts";
import { Memory } from "./src/emulator/index.ts";

const exePath = "/home/drazisil/mco-source/MCity/MCity_d.exe";

const exe = new EXEFile(exePath, [
    "/home/drazisil/mco-source/MCity",
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

const mem = new Memory(512 * 1024 * 1024);
exe.importResolver.setMemory(mem);
exe.importResolver.buildIATMap(exe.importTable, exe.optionalHeader.imageBase);

console.log("\n=== Address Lookup Tests ===\n");

const testAddresses = [
    0x00400000,    // Main executable
    0x12022cb0,    // KERNEL32 function
    0x10000100,    // d3d8.dll
    0x6b881818,    // Outside range (the error address)
];

for (const addr of testAddresses) {
    const dll = exe.importResolver.findDLLForAddress(addr);
    const inRange = exe.importResolver.isInDLLRange(addr);
    console.log(`Address 0x${addr.toString(16).padStart(8, "0")}: ${dll ? `${dll.name}` : "Not in DLL range"}${inRange ? "" : " (INVALID)"}`);
}
