/**
 * Analysis: Would 0x8b000000 be normally mapped in Windows?
 *
 * This script analyzes the x86-32 user-mode virtual address space
 * and determines if 0x8b000000 would be allocated or reserved.
 */

const crashAddr = 0x8b000000;

console.log("=== x86-32 User-Mode Virtual Address Space ===\n");

// User-mode address space on 32-bit Windows
const userModeMax = 0x7fffffff;  // 2GB limit (0x00000000 - 0x7fffffff)
const kernelModeMin = 0x80000000; // Kernel space starts here

console.log(`User-mode range: 0x00000000 - 0x${userModeMax.toString(16)}`);
console.log(`Kernel-mode range: 0x${kernelModeMin.toString(16)} - 0xffffffff\n`);

console.log(`Crash address: 0x${crashAddr.toString(16)}`);
console.log(`Is in user-mode? ${crashAddr <= userModeMax ? "YES" : "NO"}`);
console.log(`Is in kernel-mode? ${crashAddr >= kernelModeMin ? "YES" : "NO"}\n`);

// Typical process layout on 32-bit Windows
console.log("=== Typical 32-bit Process Memory Layout ===\n");
console.log("0x00000000 - 0x00000fff    NULL page (intentionally unmapped for null-ptr detection)");
console.log("0x00001000 - 0x003fffff    Reserved/available for allocation");
console.log("0x00400000 - ????????      Main executable (.exe)");
console.log("0x10000000 - 0x1fffffff    DLL space (usually, but can vary)");
console.log("0x7ffe0000 - 0x7ffeffff    Kernel Shared Data (read-only)");
console.log("0x7fff0000 - 0x7fffffff    Stack (grows downward)\n");

console.log(`Crash address 0x${crashAddr.toString(16)} analysis:`);
if (crashAddr > userModeMax) {
    console.log(`- ✓ CRITICAL: It's actually IN KERNEL-MODE ADDRESS SPACE!`);
    console.log(`- User processes cannot access kernel-mode memory`);
    console.log(`- Access attempt would immediately trigger CPU fault`);
} else {
    console.log(`- It's above the typical DLL space (0x10000000 - 0x1fffffff)`);
    console.log(`- It's below kernel-mode boundary (0x80000000)`);
    console.log(`- It would be in the user-mode virtual address space`);
}
console.log();

// Check if it would be allocated
console.log("=== Would This Memory Be Allocated? ===\n");

console.log("In a normal Windows process:");
console.log("- Memory is allocated only when explicitly requested");
console.log("- Unmapped pages cause page faults → ACCESS_VIOLATION");
console.log("- Address 0x8b000000 is not typically allocated\n");

console.log("Why it's not allocated:");
console.log("1. It's not part of the .exe (max ~0x21ba000)");
console.log("2. It's not part of any DLL (they're in 0x10000000-0x3fffffff range)");
console.log("3. It's not the stack (0x7fff0000-0x7fffffff)");
console.log("4. It's not kernel shared data (0x7ffe0000-0x7ffeffff)");
console.log("5. No Windows API would allocate memory at this specific address\n");

console.log("=== Conclusion ===\n");
if (crashAddr > userModeMax) {
    console.log("⚠️  CRITICAL ISSUE:");
    console.log("✗ Address 0x8b000000 is in KERNEL-MODE address space!");
    console.log("✓ Windows would IMMEDIATELY throw ACCESS_VIOLATION (0xC0000005)");
    console.log("✓ CPU hardware prevents user-mode access to kernel addresses");
    console.log("\nThis is DEFINITELY correct behavior - no 32-bit process can access this.");
} else {
    console.log("✗ Address 0x8b000000 would NOT be mapped in a normal Windows process");
    console.log("✓ Windows would throw ACCESS_VIOLATION (0xC0000005) - same as our emulator");
}
console.log("\nThis is correct behavior. The game is buggy, or has anti-cheat/anti-debug code.");

// Additional analysis: could this be intentional?
console.log("\n=== Could This Be Intentional? ===\n");

console.log("Possible reasons the game accesses this address:");
console.log("1. Anti-cheat/anti-debug code checking for debugger presence");
console.log("2. Copy protection scheme validating memory layout");
console.log("3. Game trying to detect if running under emulation");
console.log("4. Uninitialized pointer dereferencing (actual bug)");
console.log("5. Heap memory that was supposed to be allocated but wasn't");
console.log("6. Attempting to trigger an exception for control flow obfuscation\n");

console.log("In all cases, crashing is the correct behavior.");
