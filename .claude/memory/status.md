# Emulator Status

## Current State (2026-02-15)
- Branch: `feature/file-io`
- Game runs stably: 40+ Sleep cycles, no crashes
- Main thread in game loop (Sleep → thread 1001 cycles → repeat)
- Thread 1001 (Chat Filter @ 0x9f58f0) cycles continuously (1M steps/Sleep)
- Thread 1002 now created after `CreateDialogParamA` returns valid HWND
- File I/O infrastructure fully implemented

## Progression
1. ✓ CRT startup completes
2. ✓ mainCRTStartup → main()
3. ✓ Thread 1001 (Chat Filter) created and running
4. ✓ Sleep loop cooperative scheduling working
5. ✓ DialogBoxParamA("#114") → IDOK (login dialog passed)
6. ✓ CreateDialogParamA → 0xABCE (main game dialog fake HWND)
7. ✓ Thread 1002 created after dialog
8. → What does thread 1002 do? Is it D3D init? Network?

## Key Fixes This Session
- File handle table: CreateFileA/W opens real files (C:\MCity\ → /home/drazisil/mco-source/MCity/)
- ReadFile reads real data, SetFilePointer tracks position
- GetFileSize/GetFileSizeEx return actual sizes
- CloseHandle cleans up file handles
- Fixed CreateDialogParamA: NULL → 0xABCE (causes thread 1002 creation!)
- Fixed CRITICAL stub valid-range bug: was [0x200000, 0x202000), extended to [0x200000, 0x220000)
  - 274+ stubs × 32 bytes/stub = 0x2240+ bytes; stubs 256+ were at 0x202000+ outside old range
  - Game hitting stub 256+ caused RUNAWAY detection → false termination
- Added 20+ USER32 windowing stubs

## Next Goals
- Investigate what thread 1002 is doing
- Check if game is trying to read any asset files
- See what stubs thread 1002 calls (D3D? Network?)
- Check if D3D init stubs needed (Direct3DCreate8, IDirect3D8::CreateDevice)
