import { EXEFile } from "./index";
import { CPU, Memory, REG, registerAllOpcodes } from "./src/emulator/index";

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
const cpu = new CPU(mem);

exe.importResolver.setMemory(mem);
exe.importResolver.buildIATMap(exe.importTable, exe.optionalHeader.imageBase);
registerAllOpcodes(cpu);

// Load sections
for (const section of exe.sectionHeaders) {
    const vaddr = exe.optionalHeader.imageBase + section.virtualAddress;
    mem.load(vaddr, section.data);
}

exe.importResolver.writeIATStubs(mem, exe.optionalHeader.imageBase, exe.importTable);

const entryRVA = exe.optionalHeader.addressOfEntryPoint;
const eip = exe.optionalHeader.imageBase + entryRVA;
cpu.eip = (eip >>> 0);
cpu.regs[REG.ESP] = 0x1FF00000;
cpu.regs[REG.EBP] = 0x1FF00000;

console.log("=== Trace to Failure ===\n");

// Run with detailed trace
for (let i = 0; i < 30; i++) {
    const state = cpu.toString();
    const currentDLL = exe.importResolver.findDLLForAddress(cpu.eip);
    const location = currentDLL ? `${currentDLL.name}` : "Main executable";

    try {
        cpu.step();
        console.log(`[${String(i).padStart(2, " ")}] ${state} @ ${location}`);
    } catch (err: any) {
        console.log(`[${String(i).padStart(2, " ")}] ${state} @ ${location}`);
        console.log(`\n[CRASH] ${err.message}`);

        // Extract and display the problematic address
        const match = err.message.match(/0x([0-9a-f]+)/i);
        if (match) {
            const addr = parseInt(match[1], 16);
            console.log(`\nAttempted to access: 0x${addr.toString(16)}`);

            // Try to disassemble the current instruction
            try {
                const opcode = mem.read8(cpu.eip);
                console.log(`Instruction at crash point: opcode 0x${opcode.toString(16).padStart(2, "0")}`);
            } catch {
                console.log(`(Could not read instruction at EIP)`);
            }
        }
        break;
    }
}
