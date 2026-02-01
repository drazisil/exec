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

console.log("\n=== Virtual Address Space Map ===\n");
console.log(`Main executable:  0x${exe.optionalHeader.imageBase.toString(16).padStart(8, "0")}-0x${(exe.optionalHeader.imageBase + 0x01000000 - 1).toString(16).padStart(8, "0")} (MCity_d.exe)\n`);

console.log("Loaded DLLs:");
for (const mapping of exe.importResolver.getAddressMappings()) {
    console.log(`  0x${mapping.baseAddress.toString(16).padStart(8, "0")}-0x${mapping.endAddress.toString(16).padStart(8, "0")} ${mapping.dllName}`);
}

console.log(`\nStack:            0x${(0x1FF00000).toString(16).padStart(8, "0")}-0x${(0x1FFFFFFF).toString(16).padStart(8, "0")}`);
console.log(`\nTotal memory:     512MB (0x00000000-0x${(512 * 1024 * 1024 - 1).toString(16).padStart(8, "0")})`);
