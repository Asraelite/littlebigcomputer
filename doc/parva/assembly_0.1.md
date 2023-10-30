; LBP 24-bit CPU assembly version 0.1

# Registers

0000 | x0/ra | caller
0001 | x1/sp | callee
0010 | x2/bp | caller
0011 | x3/s0 | callee
0100 | x4/t0 | caller
0101 | x5/t1 | caller
0110 | x6/a0 | caller
0111 | x7/a1 | caller

; Read-only registers

1000 | zero
1001 | pc
1010 | cycle
1011 | upper (0xFFF000)
1100 | (unused, may trigger different instruction)
1101 | (unused, may trigger different instruction)
1110 | (unused, may trigger different instruction)
1111 | (unused, may trigger different instruction)

; Double aliases

000 | x01 | x0 + x1
010 | x23 | x2 + x3
100 | x45 | x4 + x5
110 | x67 | x6 + x7


# Encoding

Instructions are fixed-width and 24 bits long. The following layouts are used:

[ 5, opcode ] [ 4, source register A ] [ 3, dest register ] [ 3, source register B ] [ 9, padding ]
[ 5, opcode ] [ 4, source register A ] [ 3, dest register ] [ 12, unsigned immediate ]
[ 5, opcode ] [ 4, source register A ] [ 3, dest register ] [ 12, signed immediate ]
[ 4, opcode ] [ 1, source register A ] [ 2, ones ] [ 2, source register A ] [ 3, dest register ] [ 12, signed immediate ]

Depending on the instruction, the role of the registers may be swapped around.


# ALU instructions (0)

; addi/subi/mulu/mulhu immediate values are signed and will be sign-extended, others are unsigned
; TODO: Don't sign-extend certain immediates
; AAAA must be between 0000 and 1011, higher values may change the instruction

00000 AAAA DDD IIIIII IIIIII | addi xA, xD, I
00001 AAAA DDD BBB000 000000 | add xA, xD, xB
00010 1000 DDD IIIIII IIIIII | lui xD, I ; load I into the upper 12 bits of xD
00011 AAAA DDD BBB000 000000 | sub xA, xD, xB
00100 AAAA DDD IIIIII IIIIII | slli xA, xD, I
00101 AAAA DDD BBB000 000000 | sll xA, xD, xB
00110 AAAA DDD IIIIII IIIIII | srli xA, xD, I
00111 AAAA DDD BBB000 000000 | srl xA, xD, xB
01000 AAAA DDD IIIIII IIIIII | srai xA, xD, I
01001 AAAA DDD BBB000 000000 | sra xA, xD, xB
01010 AAAA DDD IIIIII IIIIII | xori xA, xD, I
01011 AAAA DDD BBB000 000000 | xor xA, xD, xB
01010 AAAA DDD IIIIII IIIIII | ori xA, xD, I
01011 AAAA DDD BBB000 000000 | or xA, xD, xB
01110 AAAA DDD IIIIII IIIIII | andi xA, xD, I
01111 AAAA DDD BBB000 000000 | and xA, xD, xB

000A0 11AA DDD IIIIII IIIIII | mului xA, xD, I  ; unsigned multiply, lower 24 bits of result
000A1 11AA DDD BBB000 000000 | mulu xA, xD, xB
001A0 11AA DDD IIIIII IIIIII | mulhu xA, xD, I ; unsigned multiply, upper 24 bits of result
001A1 11AA DDD BBB000 000000 | mulhui xA, xD, xB
010A0 11AA DDD IIIIII IIIIII | divui xA, xD, I ; unsigned integer divide, quotient
010A1 11AA DDD BBB000 000000 | divu xA, xD, xB
011A0 11AA DDD IIIIII IIIIII | remui xA, xD, I ; unsigned integer divide, remainder
011A1 11AA DDD BBB000 000000 | remu xA, xD, xB


; Pseudo-instructions

nop => addi x0, x0, 0
li xD, I => addi zero, xD, I
lli xD, I => or xD, zero, I
la xD, I => addi pc, xD, I
li xD, imm24 =>
	lui xD, imm24[23:12]
	ori xD, xD, imm24[11:0]
rdcycle xD => addi xD, cycle, 0
mv xD, xA => addi xD, xA, 0
not xD, xA =>
	xor xD, upper, xA
	xori xD, xA, -1


# Data instructions (10)

; lli and lui immediates are unsigned, other instruction immediates are signed
; When loading/storing doubles, addresses must be a multiple of 2

10000 AAAA DDD IIIIII IIIIII | lw xD, I(xA) ; load word at [xA + I] into xD
10010 AAAA DDD IIIIII IIIIII | sw xD, I(xA) ; store xD into address [xA + I]
10100 AAAA DDD IIIIII IIIIII | ld xDD, I(xA) ; load double [xA + I] into xDD
10110 AAAA DDD IIIIII IIIIII | sd xDD, I(xA) ; store xDD into address [xA + I]

; Not implemented

10001 AAAA DDD BBB000 000000 | lw xD, xB(xA) ; load word at [xA + xB] into xD
10011 AAAA DDD BBB000 000000 | sw xD, xB(xA) ; store xD into address [xA + xB]
10101 AAAA DDD BBB000 000000 | ld xDD, xB(xA) ; load double [xA + xB] into xDD
10111 AAAA DDD BBB000 000000 | sd xDD, xB(xA) ; store xDD into address [xA + xB]

; Pseudo-instructions

lw/sw/ld/sd xD, I => lw/sw/ld/sd xD, I(zero)


# Memory-mapped I/O

; Memory addresses after 0xFFF000 represent I/O and special registers. The next bit after 0xFFF is always 0, and the following 2 bits specify the device.
; E.g. the memory range 0xFFF400 to 0xFFF5FF accesses I/O device 2
; The read-only register "upper" (1011) can be used to generate I/O addresses easily.
; E.g. sw x0, 0x205(upper)
; To execute commands or set I/O device memory, write to a device address.
; Commands with no arguments can be executed by writing `zero`.
; Commands with one argument can be executed by writing a word.
; Commands with two arguments can be executed by writing a doubleword.
; Each I/O device has an associated input buffer which it can write to.
; To pull data from this buffer, read from address 0 for the device.

; Standard device memory ranges and immediate aliases

111111 111111 000XXX XXXXXX | csr | special registers
111111 111111 001XXX XXXXXX | kb | keyboard
111111 111111 010XXX XXXXXX | gpu | GPU
111111 111111 011XXX XXXXXX | snd | sound card


; Special registers

write | 0xFFF 000000 000000 | | request current clock time
write | 0xFFF 000001 000000 | | request current clock time
read | get requested value


; Keyboard commands

read | get keycode (bottom 12 bits) and modifiers (upper 12 bits), 0 if nothing pressed


; GPU commands (TODO)

write | 0xFFF 0111II IIIIII | A, B | write doubleword AB to VRAM address I
write | 0xFFF 010001 000000 | A, B | move cursor to X position A and Y position B
write | 0xFFF 010010 IIIIII | A | set character shape to A (0=6x8, 1=6x1)
write | 0xFFF 010011 IIIIII | A | set current group to A
write | 0xFFF 010100 000000 | A, B | print character to buffer with pixel values AB
write | 0xFFF 010101 000000 | A | print character to buffer with pixel values at VRAM address [A]
write | 0xFFF 010110 000000 | A, B | print character to screen with pixel values AB
write | 0xFFF 010111 000000 | A | print character to screen with pixel values at VRAM address [A]
write | 0xFFF 010000 000000 | | clear buffer of current group
write | 0xFFF 010001 000000 | | clear current group on screen
write | 0xFFF 010010 000000 | | print buffer of current group to screen
write | 0xFFF 010011 000000 | | clear current group on screen and print its buffer
write | 0xFFF 010100 000000 | | clear buffer of all groups
write | 0xFFF 010101 000000 | | clear screen
write | 0xFFF 010110 000000 | | print buffer of all groups to screen
write | 0xFFF 010111 000000 | | clear screen and print buffer of all groups
read | (not used)

; Temporary simplified GPU commands

010000 000000 | A, B | move cursor to X position A and Y position B
010001 000000 | A | print 6x1 pixels A to buffer
010010 000000 | A, B | print 6x8 pixels AB to buffer
010011 000000 | | print buffer to screen
010100 000000 | | clear screen
010101 000000 | | clear screen and print buffer to screen


; Sound card commands

write | 0xFFF 011000 000000 | A | play beep with pitch A


; Pseudo-instructions

iolw xD, V => lw xD, (V << 9)(upper) ; read from input buffer for I/O device V into xD
iosw xD, V, I => sw xD, (V << 9 + I)(upper) ; execute command I of device V with word argument xD
iosd xDD, V, I => sd xDD, (V << 9 + I)(upper) ; execute command I of device V with double argument xDD


# Branching instructions (11)

; Branch (b) immediates are signed, jump (j) immediates are unsigned
; Branching is relative, jumping is absolute
; AAAA must be between 0000 and 1011

11CCC AAAA DDD IIIIII IIIIII | bC xA, xD, I ; compare xA and xD for condition C and branch to [pc + I]
11110 AAAA 000 IIIIII IIIIII | blt xA, zero, I
11111 AAAA 000 IIIIII IIIIII | bge xA, zero, I
11110 AAAA 100 IIIIII IIIIII | j I(xA) ; jump to [xA + I]
11111 AAAA 100 BBB000 000000 | j xB(xA) ; jump to [xA + xB]

; Conditions (C)

000 | beq, equals
010 | bltu, less than unsigned
100 | blt, less than
110 | blt, less than (with special operand)
001 | bne, not equals
011 | bgeu, greater than or equal unsigned
101 | bge, greater than or equal
111 | bge, greater than or equal (with special operand)

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


# Microcode

; Channels

i24 | alu_a: ALU input value A
i24 | alu_b: ALU input value B
b4 | ins_a: instruction operand A
b3 | ins_d: instruction operand D
b3 | ins_b: instruction operand B
i12 | imm: instruction immediate value
i24 | mout_a: memory write value a
i24 | mout_b: memory write value b
i24 | b_offset: branching offset
