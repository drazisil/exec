import { EXEFile } from "./index";

const exe = new EXEFile("/home/drazisil/mco-source/MCity/MCity_d.exe");

if (exe.importTable) {
    const dlls: { [key: string]: string[] } = {};

    for (const desc of exe.importTable.descriptors) {
        if (!dlls[desc.dllName]) {
            dlls[desc.dllName] = [];
        }
        for (const entry of desc.entries) {
            dlls[desc.dllName].push(entry.name);
        }
    }

    console.log("Import Summary:\n");
    for (const [dll, funcs] of Object.entries(dlls)) {
        console.log(`${dll}: ${funcs.length} imports`);
        console.log(`  ${funcs.slice(0, 10).join(", ")}${funcs.length > 10 ? "..." : ""}\n`);
    }
}
