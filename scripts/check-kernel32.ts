import { EXEFile } from "./index";
import { DLLLoader } from "./src/loader/DLLLoader";
import { Memory } from "./src/hardware/Memory";

const mem = new Memory(1024 * 1024 * 1024);
const loader = new DLLLoader(["/data/Downloads/kernel32"]);
const dll = loader.loadDLL("KERNEL32.dll", mem);

if (dll) {
    console.log(`=== KERNEL32.dll Loaded ===\n`);
    console.log(`Base: 0x${dll.baseAddress.toString(16).padStart(8, '0')}`);
    console.log(`Size: 0x${dll.size.toString(16).padStart(8, '0')}`);

    // The address in our emulator space
    const jumpTarget = 0x12022cb0;
    const offsetInDLL = jumpTarget - dll.baseAddress;

    console.log(`\nAddress we're jumping to: 0x${jumpTarget.toString(16)}`);
    console.log(`Offset in DLL: 0x${offsetInDLL.toString(16)}`);

    if (offsetInDLL >= 0 && offsetInDLL < dll.size) {
        console.log(`✓ Jump target is within DLL bounds`);

        // Read some bytes from DLL memory
        console.log(`\nBytes at jump target (first 32 bytes):`);
        for (let i = 0; i < 32; i++) {
            const byte = mem.read8(jumpTarget + i);
            if (i % 16 === 0) console.log();
            process.stdout.write(`${byte.toString(16).padStart(2, '0')} `);
        }
        console.log('\n');
    } else {
        console.log(`✗ Jump target is OUTSIDE DLL bounds!`);
    }
} else {
    console.log("Failed to load KERNEL32.dll");
}
