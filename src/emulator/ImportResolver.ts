import { ImportTable, ImportEntry } from "../ImportTable.ts";

export interface ImportResolverOptions {
    dllSearchPaths: string[];
}

export class ImportResolver {
    private _dllSearchPaths: string[];
    // Map: iatRva => { dllName, functionName, stubAddr }
    private _iatMap: Map<number, { dllName: string; functionName: string; stubAddr: number }>;
    // Map: address => handler function for stubs
    private _stubHandlers: Map<number, (cpu: any) => void>;
    private _nextStubAddr: number;

    constructor(options: ImportResolverOptions) {
        this._dllSearchPaths = options.dllSearchPaths;
        this._iatMap = new Map();
        this._stubHandlers = new Map();
        // Stubs start at 0x10000000 (above typical user code)
        this._nextStubAddr = 0x10000000;
    }

    /**
     * Build the IAT map from the import table.
     * This should be called before running the emulator.
     */
    buildIATMap(importTable: ImportTable | null, imageBase: number): void {
        if (!importTable) return;

        for (const descriptor of importTable.descriptors) {
            const dllName = descriptor.dllName.toLowerCase();
            for (const entry of descriptor.entries) {
                // Create a stub address for this import
                const stubAddr = this._nextStubAddr;
                this._nextStubAddr += 4; // Reserve space for stub

                // Create a stub handler that logs/traces the call
                // The handler is stateless and can be called from the CPU
                this._stubHandlers.set(stubAddr, (cpu: any) => {
                    console.log(
                        `[IMPORT] Called ${dllName}!${entry.name} (stub 0x${stubAddr.toString(16)})`
                    );
                    // Return address is on stack (pushed by CALL)
                    cpu.eip = cpu.pop32();
                });

                // Map the IAT RVA to this stub
                this._iatMap.set(entry.iatRva, {
                    dllName,
                    functionName: entry.name,
                    stubAddr,
                });
            }
        }

        console.log(`[ImportResolver] Built IAT map with ${this._iatMap.size} imports`);
    }

    /**
     * Write stub addresses into the IAT at the given memory address.
     * This should be called after loading sections but before running.
     */
    writeIATStubs(memory: any, imageBase: number, importTable: ImportTable | null): void {
        if (!importTable) return;

        for (const descriptor of importTable.descriptors) {
            for (const entry of descriptor.entries) {
                const mapEntry = this._iatMap.get(entry.iatRva);
                if (mapEntry) {
                    const iatAddr = imageBase + entry.iatRva;
                    memory.write32(iatAddr, mapEntry.stubAddr);
                    console.log(
                        `[ImportResolver] IAT @ 0x${iatAddr.toString(16)} => stub 0x${mapEntry.stubAddr.toString(16)}`
                    );
                }
            }
        }
    }

    /**
     * Get the stub handler for a given address, if it exists.
     */
    getStubHandler(addr: number): ((cpu: any) => void) | undefined {
        return this._stubHandlers.get(addr);
    }

    /**
     * Check if an address is a stub address.
     */
    isStubAddress(addr: number): boolean {
        return this._stubHandlers.has(addr);
    }

    /**
     * Get all DLL search paths.
     */
    getDllSearchPaths(): string[] {
        return [...this._dllSearchPaths];
    }

    /**
     * Add a DLL search path.
     */
    addDllSearchPath(path: string): void {
        if (!this._dllSearchPaths.includes(path)) {
            this._dllSearchPaths.push(path);
        }
    }
}
