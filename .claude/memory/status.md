# Emulator Status

## Current State (2026-02-04 18:11)
- Chat Filter thread executing **d3d8.dll** at EIP=0x16001b96
- Steps: ~2.03M
- No crash - game progressing through Windows initialization

## Progression
1. ✓ CRT startup completes
2. ✓ mainCRTStartup -> main()
3. ✓ Thread 1 (Chat Filter) created and started
4. ✓ Sleep loop cooperative scheduling working
5. ✓ Thread 2 (d3d8.dll) executing
6. → Reaching game UI or main game loop?

## Next Goals
- Continue to see if game UI loads
- Check if d3d8.dll calls user32/gdi32 for rendering
- Investigate thread stacks and state

## Last Known State
| Register | Value |
|----------|-------|
| EIP | 0x16001b96 (d3d8.dll) |
| EAX | 0x0118f820 |
| ECX | 0x0118f820 |
| EDX | 0x00000003 |
| ESI | 0x00000010 |
| EDI | 0x00000003 |
| ESP | 0x01a1ffa8 |
| EBP | 0x7ffffdb8 |