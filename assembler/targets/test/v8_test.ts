import { InstructionOutputLine } from "../../assembly.js";
import targetV8 from "../v8.js";
const target = targetV8;
const tests = [
	{
		name: 'pixels_1',
		input: String.raw`
		.address $80
		reset:
		LDB #$80
		LDX #$00
		JMP idle
		
		int:
		LDD $00
		LDC #$08
		drawLoop:
		LDA D
		AND B,A
		JZ noPixel
		STX $00
		noPixel:
		ROR B
		INC X
		DEC C
		JNZ drawLoop
		RTI
		
		idle:
		HLT
		JMP idle
		
		.address $FE
		.data int
		.data reset
		`,
		expected: [0x7980, 0x7e00, 0x0296, 0x8b00, 0x7a08, 0xc3, 0x41, 0x0490, 0x8600, 0x69, 0x1e, 0x2a, 0x058a, 0x0b, 0x00, 0x0296, 0x86, 0x80],
	},
	{
		name: 'memory_copy_1',
		input: String.raw`
		; Bank switch: destroys A, B
		; ROM: bank number is stored in D's high nibble, push return address, clear carry, use jmp instead of jsr
		; RAM: bank number is stored in D's low nibble, set carry

		LDB #$F0
		JNC bankNoCarry
		NOT B
		bankNoCarry:
		LDA $00
		AND B,A
		OR D,A
		STA $00
		RET

		; Memory copy: A=start, B=offset, length=C, destroys D
		copyLoop:
		LDD $00,A
		ADC B,A
		STD $00,A
		DEC C
		JNZ copyLoop
		RET

		; Memory copy to screen: A=start, destroys C, D, screen address register
		LDD #$80
		LDC D
		STD $03
		screenCopyLoop:

		LDD $00,A
		STD $02
		DEC C
		JNZ screenCopyLoop
		RET
		`,
		expected: [0x79f0, 0x0705, 0x31, 0x8800, 0x41, 0x4b, 0x8000, 0x0a, 0x9b00, 0x11, 0x9300, 0x2a, 0x050c, 0x0a, 0x7b80, 0xd3, 0x8303, 0x9b00, 0x8302, 0x2a, 0x051a, 0x0a]
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
				const actualValueHex = actualValue.toString(16).padStart(4, '0');
				const expectedValueHex = expectedValue.toString(16).padStart(4, '0');
				console.error(`Test '${name}' failed on line ${i}: '${sourceLine.source.sourceInstructionCommented.trim()}'`);
				console.error(`Expected 0x${expectedValueHex}, got 0x${actualValueHex}`);
				continue testLoop;
			}
		}
	}
}
