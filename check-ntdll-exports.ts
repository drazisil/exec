import { EXEFile } from "./index.ts";

const ntdll = new EXEFile("/data/Downloads/ntdll/ntdll.dll");

console.log("ntdll.dll exports:");
if (ntdll.exportTable) {
    const allExports = Array.from(ntdll.exportTable.entries)
        .filter(e => e.name && (
            e.name.toLowerCase().includes('rtlcapture') ||
            e.name.toLowerCase().includes('rtlunwind') ||
            e.name.toLowerCase().includes('rtlpct')
        ))
        .map(e => e.name);

    console.log(`Found ${allExports.length} matching exports:`);
    allExports.forEach(name => console.log(`  - ${name}`));
}
