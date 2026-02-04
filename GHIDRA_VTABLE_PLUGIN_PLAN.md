# Ghidra VTable Reference Plugin - Implementation Plan

A Ghidra plugin to add navigable cross-references for virtual function calls through vtables.

## The Problem

When Ghidra decompiles a virtual call:
```c
(*this->vtable->DoSomething)(this, param1);
```

Even with properly typed vtable structs:
- The name shows, but you **cannot click through** to navigate
- No xref exists from call site → target function
- "Find References To" doesn't find virtual callers

## The Solution

A plugin that:
1. Finds all vtable structs you've defined
2. Finds all indirect calls through those vtables
3. Adds synthetic `RefType.CALL` references from call site → target function
4. Now navigation and xrefs work

---

## Prerequisites

1. **Java JDK 21** (Ghidra 11.x requires it)
2. **Ghidra installed** (11.0+ recommended)
3. **Eclipse or IntelliJ** with GhidraDev plugin (optional but helpful)

Or just write scripts directly in Ghidra's Script Manager.

---

## Approach: Start as a Script, Graduate to Plugin

Ghidra scripts (`.java` files in `ghidra_scripts/`) are the fastest way to iterate. Once it works, you can package it as a proper extension.

---

## Step 1: Create the Script File

**Location:** `~/ghidra_scripts/AddVTableReferences.java`

(Ghidra looks in `~/ghidra_scripts/` by default, or set your own script directory)

```java
// AddVTableReferences.java
// Adds cross-references for virtual function calls through vtables
//
// @category Analysis
// @keybinding
// @menupath Analysis.Add VTable References
// @toolbar

import ghidra.app.script.GhidraScript;
import ghidra.program.model.symbol.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.data.*;

public class AddVTableReferences extends GhidraScript {

    @Override
    protected void run() throws Exception {
        println("=== Add VTable References ===");
        
        // We'll build this up step by step
        // For now, just verify the script runs
        
        int refCount = 0;
        
        // TODO: Step 2 - Find vtable data types
        // TODO: Step 3 - Find vtable instances in memory
        // TODO: Step 4 - Find indirect calls through vtables
        // TODO: Step 5 - Add references
        
        println("Added " + refCount + " vtable references");
    }
}
```

**Test it:**
1. Open Ghidra, load any program
2. Window → Script Manager
3. Find "AddVTableReferences" (or refresh scripts)
4. Run it - should print the message

---

## Step 2: Find VTable Data Types

You need to identify which structs in the Data Type Manager are vtables.

**Convention:** Name vtable structs with a pattern like `vtable_ClassName` or `ClassName_vftable`.

```java
import ghidra.program.model.data.*;
import java.util.*;

// Add inside run():

List<Structure> vtableTypes = new ArrayList<>();
DataTypeManager dtm = currentProgram.getDataTypeManager();

// Iterate all data types
for (DataType dt : dtm.getAllDataTypes()) {
    if (dt instanceof Structure) {
        String name = dt.getName().toLowerCase();
        // Match your naming convention
        if (name.contains("vtable") || name.contains("vftable")) {
            vtableTypes.add((Structure) dt);
            println("Found vtable type: " + dt.getName());
        }
    }
}

println("Found " + vtableTypes.size() + " vtable types");
```

---

## Step 3: Find VTable Instances in Memory

For each vtable type, find where it's applied in the program's data section.

```java
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;

// Add after finding vtable types:

Map<Address, Structure> vtableInstances = new HashMap<>();

Listing listing = currentProgram.getListing();

for (Structure vtableType : vtableTypes) {
    // Find all data items with this type
    DataIterator dataIter = listing.getDefinedData(true);
    while (dataIter.hasNext()) {
        Data data = dataIter.next();
        DataType dataType = data.getDataType();
        
        // Check if this data is our vtable type (or pointer to it)
        if (dataType.equals(vtableType) || 
            (dataType instanceof Pointer && 
             ((Pointer)dataType).getDataType().equals(vtableType))) {
            vtableInstances.put(data.getAddress(), vtableType);
            println("Found vtable instance at: " + data.getAddress());
        }
    }
}

println("Found " + vtableInstances.size() + " vtable instances");
```

---

## Step 4: Map VTable Entries to Functions

For each vtable instance, read the function pointers and map index → function address.

```java
import ghidra.program.model.mem.*;

// Add this helper method to the class:

private Map<Integer, Address> getVTableEntries(Address vtableAddr, Structure vtableType) 
        throws Exception {
    Map<Integer, Address> entries = new HashMap<>();
    Memory memory = currentProgram.getMemory();
    int pointerSize = currentProgram.getDefaultPointerSize();
    
    int index = 0;
    for (DataTypeComponent component : vtableType.getComponents()) {
        if (component.getDataType() instanceof Pointer) {
            Address entryAddr = vtableAddr.add(component.getOffset());
            
            // Read the function pointer
            long funcAddrValue;
            if (pointerSize == 4) {
                funcAddrValue = memory.getInt(entryAddr) & 0xFFFFFFFFL;
            } else {
                funcAddrValue = memory.getLong(entryAddr);
            }
            
            Address funcAddr = toAddr(funcAddrValue);
            
            // Verify it points to a function
            Function func = getFunctionAt(funcAddr);
            if (func != null) {
                entries.put(index, funcAddr);
                println("  [" + index + "] " + component.getFieldName() + 
                        " -> " + func.getName() + " @ " + funcAddr);
            }
            index++;
        }
    }
    
    return entries;
}
```

---

## Step 5: Find Indirect Calls Through VTables

This is the tricky part. You need to find instructions that:
1. Load a vtable pointer from an object
2. Index into the vtable
3. Call the result

**Simplified approach:** Find all `CALL` instructions with computed targets, then check if any operand references a known vtable.

```java
import ghidra.program.model.listing.*;
import ghidra.program.model.pcode.*;

// Find indirect calls
InstructionIterator instrIter = listing.getInstructions(true);
List<Instruction> indirectCalls = new ArrayList<>();

while (instrIter.hasNext()) {
    Instruction instr = instrIter.next();
    
    // Check if it's a CALL instruction
    if (instr.getMnemonicString().equalsIgnoreCase("CALL")) {
        // Check if target is computed (not a direct address)
        FlowType flowType = instr.getFlowType();
        if (flowType.isComputed()) {
            indirectCalls.add(instr);
        }
    }
}

println("Found " + indirectCalls.size() + " indirect calls");
```

---

## Step 6: Use Decompiler to Resolve VTable Access

The decompiler's Pcode/high-level IR can tell you what a computed call resolves to.

```java
import ghidra.app.decompiler.*;
import ghidra.program.model.pcode.*;

// Set up decompiler
DecompInterface decomp = new DecompInterface();
decomp.openProgram(currentProgram);

// For each function containing indirect calls
for (Instruction instr : indirectCalls) {
    Function func = getFunctionContaining(instr.getAddress());
    if (func == null) continue;
    
    // Decompile the function
    DecompileResults results = decomp.decompileFunction(func, 30, monitor);
    if (!results.decompileCompleted()) continue;
    
    HighFunction highFunc = results.getHighFunction();
    if (highFunc == null) continue;
    
    // Find the PcodeOp for this call
    Iterator<PcodeOpAST> ops = highFunc.getPcodeOps(instr.getAddress());
    while (ops.hasNext()) {
        PcodeOpAST op = ops.next();
        if (op.getOpcode() == PcodeOp.CALLIND) {
            // op.getInput(0) is the call target
            Varnode target = op.getInput(0);
            
            // Analyze the target to see if it's a vtable access
            // This requires walking the Pcode definition chain
            analyzeVTableCall(op, target, instr.getAddress());
        }
    }
}

decomp.dispose();
```

---

## Step 7: Add the References

Once you've identified: call site address + target function address, add the reference.

```java
import ghidra.program.model.symbol.*;

private void addVTableReference(Address callSite, Address targetFunc, String vtableName, int index) 
        throws Exception {
    ReferenceManager refMgr = currentProgram.getReferenceManager();
    
    // Check if reference already exists
    Reference[] existingRefs = refMgr.getReferencesFrom(callSite);
    for (Reference ref : existingRefs) {
        if (ref.getToAddress().equals(targetFunc)) {
            println("Reference already exists: " + callSite + " -> " + targetFunc);
            return;
        }
    }
    
    // Add the reference
    Reference ref = refMgr.addMemoryReference(
        callSite,           // from
        targetFunc,         // to
        RefType.COMPUTED_CALL,  // type (or RefType.CALL)
        SourceType.USER_DEFINED,
        0                   // operand index
    );
    
    println("Added reference: " + callSite + " -> " + targetFunc + 
            " (" + vtableName + "[" + index + "])");
}
```

---

## Step 8: Wrap It All Together

The full script structure:

```java
// AddVTableReferences.java
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.symbol.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.data.*;
import ghidra.program.model.pcode.*;
import ghidra.program.model.mem.*;
import java.util.*;

public class AddVTableReferences extends GhidraScript {

    private int refsAdded = 0;

    @Override
    protected void run() throws Exception {
        println("=== Add VTable References ===\n");
        
        // Step 2: Find vtable types
        List<Structure> vtableTypes = findVTableTypes();
        if (vtableTypes.isEmpty()) {
            println("No vtable types found. Name your vtable structs with 'vtable' or 'vftable'.");
            return;
        }
        
        // Step 3: Find vtable instances
        Map<Address, Structure> vtableInstances = findVTableInstances(vtableTypes);
        if (vtableInstances.isEmpty()) {
            println("No vtable instances found in data.");
            return;
        }
        
        // Step 4: Map entries to functions
        Map<Address, Map<Integer, Address>> vtableEntries = new HashMap<>();
        for (Map.Entry<Address, Structure> entry : vtableInstances.entrySet()) {
            println("\nVTable at " + entry.getKey() + " (" + entry.getValue().getName() + "):");
            vtableEntries.put(entry.getKey(), getVTableEntries(entry.getKey(), entry.getValue()));
        }
        
        // Step 5-7: Find indirect calls and add references
        processIndirectCalls(vtableInstances, vtableEntries);
        
        println("\n=== Complete ===");
        println("Added " + refsAdded + " vtable references");
    }
    
    // ... include all the helper methods from above ...
}
```

---

## The Hard Part: Resolving VTable Access Patterns

The trickiest part is step 6 - figuring out which vtable entry an indirect call uses.

**Pattern you're looking for in Pcode:**
```
LOAD vtable_ptr from [object + 0]      // Get vtable pointer
LOAD func_ptr from [vtable_ptr + N]    // Get function at index N
CALLIND func_ptr                        // Call it
```

You need to walk backward from the `CALLIND` to find:
1. The vtable base address (matches one of your known vtables)
2. The offset (which gives you the index)

**Simplified alternative:** If you know your vtable structs are well-defined, you can:
1. For each vtable instance, get all function addresses
2. For each function, find all callers (including indirect via decompiler)
3. Cross-reference to add synthetic refs

This avoids complex Pcode analysis.

---

## Testing

1. **Create a test vtable struct** in Data Type Manager:
   - Name: `vtable_TestClass`
   - Fields: `func1` (pointer), `func2` (pointer), etc.

2. **Apply it to a vtable in memory:**
   - Find a vtable in your binary
   - Right-click → Data → Choose Data Type → your struct

3. **Run the script** and verify:
   - It finds your vtable type
   - It finds the instance
   - It maps entries to functions

4. **Check references:**
   - Go to one of the target functions
   - Window → References To
   - You should see the new synthetic references

---

## Iteration Plan

| Phase | Goal | Complexity |
|-------|------|------------|
| 1 | Script runs, finds vtable types | Easy |
| 2 | Finds vtable instances in memory | Easy |
| 3 | Maps vtable entries to functions | Medium |
| 4 | Finds indirect calls | Medium |
| 5 | Resolves calls to vtable entries | Hard |
| 6 | Adds references | Easy |
| 7 | Polish, handle edge cases | Medium |

Start with phases 1-3. Even without automatic call resolution, a script that **lists all vtable entries** is useful.

---

## Alternative: Semi-Automatic Approach

If full automation is too complex, build a helper:

1. User selects an indirect call instruction
2. User specifies which vtable + index
3. Script adds the reference

```java
// Right-click script: "Add VTable Ref Here"
// Prompts user for vtable name and index, adds the reference

Address callSite = currentAddress;  // Where user clicked
String vtableName = askString("VTable", "Enter vtable struct name:");
int index = askInt("Index", "Enter vtable index:");

// Look up the vtable, find function at index, add reference
```

This is less magical but immediately useful.

---

## Resources

- **Ghidra API Docs:** https://ghidra.re/ghidra_docs/api/
- **ReferenceManager:** https://ghidra.re/ghidra_docs/api/ghidra/program/model/symbol/ReferenceManager.html
- **Decompiler API:** https://ghidra.re/ghidra_docs/api/ghidra/app/decompiler/package-summary.html
- **Example Scripts:** `$GHIDRA_HOME/Ghidra/Features/Base/ghidra_scripts/`
- **RecoverClassesFromRTTIScript.java:** In Ghidra's script collection - complex but shows vtable handling

---

## Future Enhancements

Once the basic script works:

1. **Auto-detect vtables** by pattern (consecutive code pointers)
2. **Handle inheritance** (child vtables extend parent)
3. **Add comments** at call sites with resolved target name
4. **Create UI panel** showing class hierarchy
5. **Export** class definitions to C++ header files

---

## Notes for Motor City Online

For your specific case:
- Windows x86-32 binary with MSVC RTTI
- Try `RecoverClassesFromRTTIScript.java` first - it might do a lot automatically
- If RTTI is stripped, you'll need the manual approach above
- COM interfaces (D3D8, etc.) are all vtable-based - this will help a lot

Good luck!
