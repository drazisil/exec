import { CPU, Memory, REG, REG_NAMES, registerAllOpcodes } from "./src/emulator/index.ts";

// Hand-assembled test program:
//
//   mov eax, 10        ; B8 0A000000
//   mov ebx, 20        ; BB 14000000
//   add eax, ebx       ; 01 D8          (add r/m32, r32: mod=11, reg=EBX(3), rm=EAX(0) -> modrm=0xD8)
//   push eax           ; 50
//   mov ecx, 5         ; B9 05000000
//   sub eax, ecx       ; 29 C8          (sub r/m32, r32: mod=11, reg=ECX(1), rm=EAX(0) -> modrm=0xC8)
//   cmp eax, ebx       ; 39 D8          (cmp r/m32, r32: mod=11, reg=EBX(3), rm=EAX(0) -> modrm=0xD8)
//   jne skip           ; 75 02          (skip 2 bytes)
//   inc edx            ; 42             (should be skipped)
//   inc edx            ; 42             (should be skipped)
// skip:
//   pop edx            ; 5A
//   xor esi, esi       ; 31 F6          (xor r/m32, r32: mod=11, reg=ESI(6), rm=ESI(6) -> modrm=0xF6)
//   call func          ; E8 08000000    (rel32 = 8: call ends at +0x22, func at +0x2A)
//   mov edi, eax       ; 8B F8          (mov r32, r/m32: mod=11, reg=EDI(7), rm=EAX(0) -> modrm=0xF8)
//                                        ^ wait, 8B = mov r32, r/m32: reg=7(EDI), rm=0(EAX), mod=11 -> modrm = 11_111_000 = 0xF8
//   jmp end            ; EB 03          (skip 3 bytes to hlt)
//   nop                ; 90
//   nop                ; 90
//   nop                ; 90
// end:
//   hlt                ; F4
//
// func:
//   mov eax, 42        ; B8 2A000000
//   ret                ; C3

const code = Buffer.from([
    // mov eax, 10
    0xB8, 0x0A, 0x00, 0x00, 0x00,
    // mov ebx, 20
    0xBB, 0x14, 0x00, 0x00, 0x00,
    // add eax, ebx  (modrm: mod=11, reg=3(EBX), rm=0(EAX) = 0b11_011_000 = 0xD8)
    0x01, 0xD8,
    // push eax
    0x50,
    // mov ecx, 5
    0xB9, 0x05, 0x00, 0x00, 0x00,
    // sub eax, ecx (modrm: mod=11, reg=1(ECX), rm=0(EAX) = 0b11_001_000 = 0xC8)
    0x29, 0xC8,
    // cmp eax, ebx (modrm: mod=11, reg=3(EBX), rm=0(EAX) = 0b11_011_000 = 0xD8)
    0x39, 0xD8,
    // jne +2 (skip 2 inc edx instructions)
    0x75, 0x02,
    // inc edx (should be skipped because 25 != 20)
    0x42,
    // inc edx (should be skipped)
    0x42,
    // pop edx
    0x5A,
    // xor esi, esi (modrm: mod=11, reg=6(ESI), rm=6(ESI) = 0b11_110_110 = 0xF6)
    0x31, 0xF6,
    // call func (rel32 = 8: call ends at +0x22, func at +0x2A, delta = 8)
    0xE8, 0x08, 0x00, 0x00, 0x00,
    // mov edi, eax (modrm: mod=11, reg=7(EDI), rm=0(EAX) = 0b11_111_000 = 0xF8)
    0x8B, 0xF8,
    // jmp end (+3, skip 3 nops)
    0xEB, 0x03,
    // 3 nops (padding)
    0x90, 0x90, 0x90,
    // hlt
    0xF4,
    // func: mov eax, 42
    0xB8, 0x2A, 0x00, 0x00, 0x00,
    // ret
    0xC3,
]);

const BASE = 0x1000;

const mem = new Memory(0x100000);
mem.load(BASE, code);

const cpu = new CPU(mem);
registerAllOpcodes(cpu);
cpu.eip = BASE;
cpu.regs[REG.ESP] = 0x80000;

console.log("=== x86 Emulator MVP Test ===\n");
console.log(`Loaded ${code.length} bytes at 0x${BASE.toString(16)}\n`);
console.log("Before:");
console.log(cpu.toString());
console.log("");

cpu.run();

console.log("After:");
console.log(cpu.toString());
console.log(`\nExecuted ${cpu.stepCount} instructions`);

// Verify expected results
console.log("\n=== Verification ===");
const checks: [string, number, number][] = [
    ["EAX", cpu.regs[REG.EAX], 42],        // func returned 42
    ["EBX", cpu.regs[REG.EBX], 20],        // unchanged
    ["ECX", cpu.regs[REG.ECX], 5],          // unchanged
    ["EDX", cpu.regs[REG.EDX], 30],         // popped from stack (10+20=30)
    ["ESI", cpu.regs[REG.ESI], 0],          // xor esi,esi
    ["EDI", cpu.regs[REG.EDI], 42],         // mov edi, eax (after call)
];

let allPassed = true;
for (const [name, actual, expected] of checks) {
    const pass = actual === expected;
    if (!pass) allPassed = false;
    console.log(`  ${name}: ${actual === expected ? "PASS" : "FAIL"} (got 0x${(actual >>> 0).toString(16)}, expected 0x${expected.toString(16)})`);
}
console.log(allPassed ? "\nAll checks passed!" : "\nSome checks FAILED!");
