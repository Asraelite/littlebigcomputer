# Registers

0000 | x0/zero | always 0
0001 | x1/ra | return address
0010 | x2/sp | stack pointer
0011 | x3/gp | global pointer
0100 | x4/tp | thread pointer
0101 | x5/t0 | temporary
0110 | x6/t1
0111 | x7/t2
1000 | x8/s0/fp | saved register, frame pointer
1001 | x9/s1
1010 | x10/a0 | function argument, return value
1011 | x11/a1
1100 | x12/a2
1101 | x13/a3
1110 | x14/a4
1111 | x15/a5

_idea_
A new syntax is needed for doubleword registers now that there can be two digits. Maybe only
allow the bottom 8 to represent doubleword registers, and shift s0/s1 to an earlier position to
compensate?

_idea_
Multiple calling conventions, one with many saved registers and another with few?


# ALU instructions (0)

000000 DDDD AAAA IIII IIIIII | addi xD, xA, I
000001 DDDD AAAA BBBB 000000 | add xD, xA, xB

010000 DDDD IIII IIII IIIIII | lui xD, I | load upper immediate (14 bits)

_idea_
011000 DDDD IIII IIII IIIIII | lli xD, I | load lower immediate (14 bits) (also change opcode of lui to match)

_idea_
Reserve two bits for specifying the immediate format, possibilities:
imm, imm << 12, (imm << 12) | (imm)
Maybe only allow this in a separate [opcode, d/a, format, imm] format where d and a are the same

_idea_
Fused mul/mulh and divu/remu (important now because of dedicated cores)

0XXXXR | X = operation, R = use register as second operand

0000 | add
0001 | sub/lui | sub if R=1, lui if R=0
0010 | sll
0011 | srl
0100 | sra
0101 | xor
0110 | or
0111 | and
1000 | mul
1001 | mulh
1010 | divu
1011 | remu
1100 | (unused)
1101 | (unused)
1110 | (unused)
1111 | (unused)

# Data instructions (10)

100000 AAAA DDDD IIIIIIIIII | lw xD, [xA + I] ; load word at [xA + I] into xD
100010 AAAA DDDD IIIIIIIIII | sw xD, [xA + I] ; store xD into address [xA + I]
100100 AAAA DDDD IIIIIIIIII | ld xDD, [xA + I] ; load double [xA + I] into xDD
100110 AAAA DDDD IIIIIIIIII | sd xDD, [xA + I] ; store xDD into address [xA + I]

100001 AAAA DDDD BBBB IIIIII | lw xD, [xA + xB + I] ; load word at [xA + xB + I] into xD
100011 AAAA DDDD BBBB IIIIII | sw xD, [xA + xB + I] ; store xD into address [xA + xB + I]
100101 AAAA DDDD BBBB IIIIII | ld xDD, [xA + xB + I] ; load double [xA + xB + I] into xDD
100111 AAAA DDDD BBBB IIIIII | sd xDD, [xA + xB + I] ; store xDD into address [xA + xB + I]

_pseudo-instructions_

lw/sw/ld/sd xD, I => lw/sw/ld/sd xD, I(zero)

_idea_
Data instructions relative to PC
Test if having dedicated instructions for this is worth it as opposed to auipc + add + lw

_idea_
Prefetch instruction. Set a cache line to load for the next frame, but do not stop execution.
Execution could maybe even be allowed to continue while fetching from main memory over multiple frames.

_idea_
Push/pop multiple, maybe using ld/sd, e.g. push s01, pop a01

_idea_
Push/pop aligned pseudo-instruction, e.g. `pusha x0, x1, x3, x5, x8` -> `pushd d0; push x3; push x5; push x8; addi sp, sp, -1`
Combines registers into doublewords when possible, and aligns `sp` to a multiple a of 2 if necessary.


# Branching instructions (11)

110CCC AAAA DDDD IIII IIIIII | bC xA, xD, I ; compare xA and xD for condition C and branch to [pc + I]
111000 AAAA IIII IIII IIIIII | j [xA + I] ; jump to [xA + I]
111110 AAAA DDDD BBBB IIIIII | jalr xD, [xA + xB + I] ; jump to [xA + xB + I] and set xD to pc + 1

_idea_
011CCC AAAA iiii iiII IIIIII | bC xA, i, I ; compare xA and immediate i for condition C and branch to [pc + I]

11CCC AAAA DDD IIIIII IIIIII | bC xA, xD, I ; compare xA and xD for condition C and branch to [pc + I]
11110 AAAA 000 IIIIII IIIIII | blt xA, zero, I
11111 AAAA 000 IIIIII IIIIII | bge xA, zero, I
11110 AAAA 100 IIIIII IIIIII | j I(xA) ; jump to [xA + I]
11111 AAAA 100 BBB000 000000 | j xB(xA) ; jump to [xA + xB]

; Conditions (C)

000 | beq, equals
010 | bltu, less than unsigned
100 | blt, less than
110 | (unused)
001 | bne, not equals
011 | bgeu, greater than or equal unsigned
101 | bge, greater than or equal
111 | (unused)

beq: Z==1
bne: Z==0
blt: N!=V
bltu: C==0
bge: N==V
bgeu: C==1

; Pseudo-instructions

b I => beq x0, x0, I
b xB => j xB(pc)
j xB => j xB(zero)
wfi => beq x0, x0, 0

bgt xD, xA, I => blt xA, xD, I
bgtu xD, xA, I => bltu xA, xD, I
ble xD, xA, I => bge xA, xD, I
bleu xD, xA, I => bgeu xA, xD, I

beqz xD, I => beq zero, xD, I
bltz xD, I => blt xD, zero, I
bnez xD, I => bne zero, xD, I
bgez xD, I => bge xD, zero, I
bgtz xD, I => blt zero, xD, I
blez xD, I => bge zero, xD, I


# Interrupts

Trigger interrupt input
Two (three?) input bits to select which interrupt vector to use.
Some maskable, some not maskable
Single line in memory holding all control values (interrupt vectors, interrupts enabled bit, pc, timers, cpuid)
Contains two value inputs, these can be read as special registers

Timer interrupts?


# I/O

Write to special memory line, send I/O out signal
