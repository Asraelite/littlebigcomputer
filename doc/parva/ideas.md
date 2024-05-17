# Instruction set

Load relative address: rd <- pc + imm

Load immediate with 14-bit value

Splat/merge: 24-bit value into two registers, 12 bits each, or four registers, 6 bits each.

Branch if least significant bit is set.

Branch, comparing to immediate. Can either be two immediates in the instruction, or make it a 48-bit instruction.

Branch if equal / not equal to zero for doubleword registers, e.g. `beqz x01, target`.

Multiply 12-bits

Single-frame binary to decimal by chaining together the multiply/divide parts of different ALUs.

String manipulation instructions:
Truncate after first null character, e.g. doubleword "abcde\0fg" -> "abcde\0\0\0"
Length of doubleword up to first null character, e.g. "abcde\0fg" -> 5
Left-align / right-align strings.

All cores can do 12-bit bitwise operations. 24-bit operations are done by two cores in sequence.


# Registers

Some registers can be read by any core, but only written to by a single core.
This could be a separate `mv` instruction, so generally the desination operand is only three bits.


# Memory

No direct write ability, writes are only performed by the CPU core.

3-tier memory: looping memory, L2 cache of several lines, L1 cache of e.g. two lines passed through the CPU pipeline.

If a loop memory writeback is still in progress and the eviction of another line is requested, the memory controller can select the least recently used line which isn't dirty and evict that instead.


# Branch prediction

Split instructions into groups of 3/4.

When a branch is taken, store the instruction group that is branched to along with the target address.
E.g. a branch to address 15, where at address 15 there are instructions A, B, C, will store [15, A, B, C] into the branch prediction part of the instruction pipeline.

Only every third core (or some other number) can perform branching. The branch prediction values only need to be passed to these cores.
Other cores can still check for branching, but not actually execute it.

Two predicted paths could be stored with prioritization. When the most recently taken one is taken, nothing happens. When the less recently taken one is taken, the two swap positions. When a new branch is taken, the less recently taken one is overwritten.


# Specialization

Only certain cores can perform certain actions, e.g. division, bitwise operations.

Some registers are fast-read, slow-write. They only implement writing logic in an instruction that can be executed by certain cores, maybe once per frame. All other cores can read from them.

B core: take branches
A core: bitwise arithmetic
M core: 24-bit multiplcation / division
