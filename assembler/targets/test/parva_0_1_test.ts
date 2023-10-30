import { ArchSpecification, InstructionOutputLine } from "../../assembly.js";

import targetParva_0_1 from "../parva_0_1.js";

const target: ArchSpecification = targetParva_0_1;

const tests = [
	{
		name: 'binary_to_decimal_1',
		input: String.raw`
lw x0, value
li x1, 0

dec_to_bin_loop:
	lw x4, ten_powers(x1)
	beqz x4, end_dec_to_bin_loop
	lw x3, ten_divisors(x1)
	mulhu x3, x0, x3
	srli x3, x3, 1 # x3 = digit of result
	sw x3, result_string(x1)
	mulu x3, x3, x4
	sub x0, x0, x3
	addi x1, x1, 1
	b dec_to_bin_loop
end_dec_to_bin_loop:

sw x0, result_string(x1)
li x0, -1
li x6, 1 # cursor x
li x7, 1 # cursor y
sw x0, 0b01_0100_000000(upper) # gpu clear screen

skip_zeroes:
	addi x0, x0, 1
	lw x1, result_string(x0)
	beqz x1, skip_zeroes
print_loop:
	sd x67, 0b01_0000_000000(upper) # gpu move cursor
	lw x1, result_string(x0)
	bltz x1, end_print_loop
	slli x1, x1, 1
	lw x2, char_pixels_upper(x1)
	lw x3, char_pixels_lower(x1)
	sd x23, 0b01_0010_000000(upper) # gpu print char
	addi x6, x6, 4
	addi x0, x0, 1
	b print_loop
end_print_loop:

sd x01, 0b01_0011_000000(upper) # gpu show buffer
wfi

ten_powers:
.data 10000000
.data 1000000
.data 100000
.data 10000
.data 1000
.data 100
.data 10
.data 0

ten_divisors:
.data 0x000004 # 10000000
.data 0x000022 # 1000000
.data 0x000150 # 100000
.data 0x000d1c # 10000
.data 0x008313 # 1000
.data 0x051eb9 # 100
.data 0x333334 # 10

char_pixels_upper:
.data 0b111000_101000_101000_101000 # 0
char_pixels_lower:
.data 0b111000_000000_000000_000000

.data 0b001000_001000_001000_001000 # 1
.data 0b001000_000000_000000_000000

.data 0b111000_001000_111000_100000 # 2
.data 0b111000_000000_000000_000000

.data 0b111000_001000_111000_001000 # 3
.data 0b111000_000000_000000_000000

.data 0b101000_101000_111000_001000 # 4
.data 0b001000_000000_000000_000000

.data 0b111000_100000_111000_001000 # 5
.data 0b111000_000000_000000_000000

.data 0b111000_100000_111000_101000 # 6
.data 0b111000_000000_000000_000000

.data 0b111000_001000_001000_010000 # 7
.data 0b010000_000000_000000_000000

.data 0b111000_101000_111000_101000 # 8
.data 0b111000_000000_000000_000000

.data 0b111000_101000_111000_001000 # 9
.data 0b001000_000000_000000_000000
result_string:
.repeat 0 8
.data -1

value:
.data 69420
`,
		expected: [0x84004c, 0x041000, 0x80c020, 0xc44009, 0x80b028, 0x2e3600, 0x31b001, 0x90b043, 0x0fb800, 0x180600, 0x009001, 0xc00ff7, 0x908043, 0x040fff, 0x046001, 0x047001, 0x958500, 0x000001, 0x801043, 0xc41ffe, 0xb5e400, 0x801043, 0xf08008, 0x209001, 0x80a02f, 0x80b030, 0xb5a480, 0x036004, 0x000001, 0xc00ff7, 0xb584c0, 0xc00000, 0x989680, 0x0f4240, 0x0186a0, 0x002710, 0x0003e8, 0x000064, 0x00000a, 0x000000, 0x000004, 0x000022, 0x000150, 0x000d1c, 0x008313, 0x051eb9, 0x333334, 0xe28a28, 0xe00000, 0x208208, 0x200000, 0xe08e20, 0xe00000, 0xe08e08, 0xe00000, 0xa28e08, 0x200000, 0xe20e08, 0xe00000, 0xe20e28, 0xe00000, 0xe08210, 0x400000, 0xe28e28, 0xe00000, 0xe28e08, 0x200000, 0x000000, 0x000000, 0x000000, 0x000000, 0x000000, 0x000000, 0x000000, 0x000000, 0xffffff, 0x010f2c],
	}
];

export function runTests() {
	testLoop: for (const { input, expected, name } of tests) {
		const actualOutputLines = target.assemble({
			source: input,
		}).lines.filter((line): line is InstructionOutputLine => line.tag === 'instruction');
		const actualOutputValues = actualOutputLines
			.map(line => parseInt(line.bits, 2));
		for (let i = 0; i < expected.length; i++) {
			const sourceLine = actualOutputLines[i];
			const actualValue = actualOutputValues[i];
			const expectedValue = expected[i];

			if (actualValue !== expectedValue) {
				const actualValueHex = actualValue.toString(16).padStart(6, '0');
				const expectedValueHex = expectedValue.toString(16).padStart(6, '0');
				console.error(`Test '${name}' failed on line ${i}: '${sourceLine.source.sourceInstructionCommented.trim()}'`);
				console.error(`Expected 0x${expectedValueHex}, got 0x${actualValueHex}`);
				continue testLoop;
			}
		}
	}
}
