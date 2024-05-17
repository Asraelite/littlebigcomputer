


# L2 data cache

Writeback scenarios:

1. Normal: write L1-0 to L2-0, L1-1 to L2-1
2. Swap: write L1-0 to L2-1, L1-1 to L2-0
3. Normal miss: write L1-0 to L2-1, L1-1 to L2-2
4. Swap miss: write L1-0 to L2-2, L1-1 to L2-1


On miss:

Check if requested line is in L2. If so, send a move signal to that position.


# L2 instruction cache

Same as data cache but with no writeback functionality

Must pre-emptively fetch the next line after the PC
