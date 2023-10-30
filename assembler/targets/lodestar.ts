import type { OutputLine, AssemblyInput, ArchSpecification, AssemblyOutput, InputError } from '../assembly';
import { toBitString } from '../util.js';

export type Resolvable = {
	sourceAddress: number;
	value: string;
};

export type InstructionPart = string | Resolvable;

const REGISTER_MAP = {
	'a': '000',
	'b': '001',
	'c': '010',
	'd': '011',
	'e': '100',
	'f': '101',
	'x': '110',
	'y': '111',
};

function reg(register: string): string {
	const bits = REGISTER_MAP[register];
	if (bits === undefined) {
		throw new Error(`Unknown register: ${register}`);
	}
	return bits;
}

function immediate(n: string | number): string {
	if (isNaN(Number(n))) {
		throw new Error(`Literal value '${n}' is not a number`);
	}
	const value = Number(n);
	if (value < -128 || value > 255) {
		throw new Error(`Literal value '${n}' is out of range`);
	}
	return toBitString(value, 8);
}

function tryParseInt(value: string): number | null {
	let result = null;
	if (value.startsWith('$')) {
		result = parseInt(value.slice(1), 16);
	} else if (value.startsWith('%')) {
		result = parseInt(value.slice(1), 2);
	} else {
		result = parseInt(value, 10);
	}
	if (isNaN(result)) {
		return null;
	}
	return result;
}

type ParsedLabel = {
	tag: 'label';
	name: string;
	sourceLine: number;
};

type ParsedInstruction = {
	tag: 'instruction';
	fullSource: string;
	instructionSource: string;
	sourceLine: number;
	parts: Array<InstructionPart>;
	address: number;
};

type ParsedLine = ParsedInstruction | ParsedLabel;

class Program {
	currentAddress: number;
	currentSource: string;
	output: Array<ParsedLine>;
	labels: Map<string, number>;

	constructor() {
		this.currentAddress = 0;
		this.output = [];
		this.labels = new Map();
	}

	instruction(fullSource: string, instructionSource: string, sourceLineNumber: number, parts: Array<InstructionPart>, byteCount: number) {
		this.output.push({
			tag: 'instruction',
			fullSource: fullSource,
			instructionSource: instructionSource,
			sourceLine: sourceLineNumber,
			address: this.currentAddress,
			parts,
		});
		this.currentAddress += byteCount;
	}

	label(name: string, sourceLineNumber: number) {
		if (this.labels.has(name)) {
			throw new Error(`Label '${name}' already defined`);
		}
		this.labels.set(name, this.currentAddress);
		this.output.push({
			tag: 'label',
			name,
			sourceLine: sourceLineNumber,
		});
	}

	parse(line: string, lineNumber: number) {
		// Remove comments beginning with ; and //
		let commentIndex = line.length;
		if (line.indexOf(';') !== -1) {
			commentIndex = Math.min(commentIndex, line.indexOf(';'));
		}
		if (line.indexOf('//') !== -1) {
			commentIndex = Math.min(commentIndex, line.indexOf('//'));
		}
		const fullSource = line;
		line = line.slice(0, commentIndex);
		line = line.trim();
		const instructionSource = line;

		line = line.toLowerCase();

		if (line === '') {
			return;
		}

		const value = (s: string): Resolvable => ({
			sourceAddress: this.currentAddress,
			value: s,
		});

		let matchFound = false;

		const match = (...args) => {
			if (matchFound) {
				return;
			}
			const fn = args.pop();
			const expression = new RegExp('^' + args.join('') + '$');
			const result = line.match(expression);
			if (result === null) {
				return;
			}
			fn(...result.slice(1));
			matchFound = true;
		}
		const i = (...parts: Array<InstructionPart>) => this.instruction(fullSource, instructionSource, lineNumber, parts, 1);
		const i2 = (...parts: Array<InstructionPart>) => this.instruction(fullSource, instructionSource, lineNumber, parts, 2);

		const r = '([a-fxy])';
		const s = '\\s+';
		const so = '\\s*?';
		const label = '([a-z_][a-z0-9_]+)';
		const number = '([%$]?-?[0-9a-f_]+)';
		const imm = '#?((?:(?<=#)[%$]?-?[0-9a-f_]+)|(?:(?<!#)[a-z_][a-z0-9_]+))';
		const abs = '((?:[%$]?-?[0-9a-f_]+)|(?:[a-z_][a-z0-9_]+))';
		const aai = number + so + ',' + so + 'a';
		const ind = '\\(' + abs + '\\)';
		const opa = r + so + ',' + so + 'a';

		match('hlt', () => i('00000000'));
		match('nop', () => i('00000001'));
		match('jmp', s, abs, (a) => { i2('00000011', value(a)) });
		match('jmp', s, imm, (a) => { i2('00000010', value(a)) });
		match('jz', s, imm, (a) => { i2('00000100', value(a)) });
		match('jnz', s, imm, (a) => { i2('00000101', value(a)) });
		match('jc', s, imm, (a) => { i2('00000110', value(a)) });
		match('jnc', s, imm, (a) => { i2('00000111', value(a)) });
		match('jsr', s, imm, (a) => { i2('00001000', value(a)) });
		match('jsr', s, imm, (a) => { i2('00001000', value(a)) });
		match('ret', () => i('00001010'));
		match('rti', () => i('00001011'));
		match('sec', () => i('00001100'));
		match('clc', () => i('00001101'));
		match('eni', () => i('00001110'));
		match('dsi', () => i('00001111'));
		match('adc', s, opa, (a) => i('00010', reg(a)));
		match('inc', s, r, (a) => i('00011', reg(a)));
		match('sbc', s, opa, (a) => i('00100', reg(a)));
		match('dec', s, r, (a) => i('00101', reg(a)));
		match('not', s, r, (a) => i('00110', reg(a)));
		match('xor', s, opa, (a) => i('00111', reg(a)));
		match('and', s, opa, (a) => i('01000', reg(a)));
		match('or', s, opa, (a) => i('01001', reg(a)));
		match('slc', s, r, (a) => i('01010', reg(a)));
		match('src', s, r, (a) => i('01011', reg(a)));
		match('rol', s, r, (a) => i('01100', reg(a)));
		match('ror', s, r, (a) => i('01101', reg(a)));
		match('cmp', s, opa, (a) => i('01110', reg(a)));
		match('ld', r, s, r, (a, b) => i('11', reg(a), reg(b)));
		match('ld', r, s, abs, (a, b) => { i2('10001', reg(a), value(b)) });
		match('ld', r, s, ind, (a, b) => { i2('10101', reg(a), value(b)) });
		match('ld', r, s, imm, (a, b) => { i2('01111', reg(a), value(b)) });
		match('ld', r, s, aai, (a, b) => { i2('10011', reg(a), value(b)) });
		match('st', r, s, aai, (a, b) => { i2('10010', reg(a), value(b)) });
		match('st', r, s, ind, (a, b) => { i2('10100', reg(a), value(b)) });
		match('st', r, s, abs, (a, b) => { i2('10000', reg(a), value(b)) });
		match('push', s, r, (a) => i('10110', reg(a)));
		match('pull', s, r, (a) => i('10111', reg(a)));
		match('push', s, r, (a) => i('10110', reg(a)));
		match('\\.data', s, '(.*)', (a) => this.data(a.split(/\s*,\s*/), fullSource, lineNumber));
		match('\\.address', s, number, (a) => this.address(tryParseInt(a)));
		match(label, ':', (a) => this.label(a, lineNumber));

		if (!matchFound) {
			throw new Error(`Unknown instruction: ${instructionSource}`);
		}
	}

	address(value) {
		this.currentAddress = value;
	}

	data(values: Array<string>, source: string, sourceLineNumber: number) {
		const numbers: Array<Resolvable> = values.map(n => ({ sourceAddress: 0, value: n }));
		for (const number of numbers) {
			this.instruction(source, ".data", sourceLineNumber, [number], 1);
		}
		return this;
	}

	resolveParsedLine(instruction: ParsedLine): OutputLine {
		if (instruction.tag === 'label') {
			return {
				tag: 'label',
				name: instruction.name,
			};
		}

		let bits = '';
		for (const part of instruction.parts) {
			bits += this.resolve(part);
		}
		if (bits.length % 8 !== 0) {
			throw new Error(`Instruction ${instruction.instructionSource} is ${bits.length} bits long, but should be a multiple of 8`);
		}
		return {
			tag: 'instruction',
			bits,
			address: instruction.address,
			source: {
				sourceInstructionCommented: instruction.fullSource,
				realInstruction: instruction.instructionSource.toUpperCase(),
				lineNumber: instruction.sourceLine,
				sourceInstruction: instruction.instructionSource,
			}
		};
	}

	resolve(part: InstructionPart): string {
		if (typeof part === 'string') {
			return part;
		}

		const parsedInt = tryParseInt(part.value);
		if (parsedInt !== null) {
			return immediate(parsedInt);
		}

		const targetLabelAddress = this.labels.get(part.value);
		if (targetLabelAddress === undefined) {
			throw new Error(`Unknown label: ${part.value}`);
		}

		return immediate(targetLabelAddress);
	}
}

function assemble(input: AssemblyInput): AssemblyOutput {
	const program = new Program();
	const errors: Array<InputError> = [];

	return {
		lines: [],
		errors: [{ line: -1, message: 'This target architecture is not yet implemented' }],
		message: '',
	};

	for (const [lineNumber, line] of input.source.split('\n').entries()) {
		try {
			program.parse(line, lineNumber);
		} catch (e) {
			errors.push({
				line: lineNumber,
				message: e.message,
			});
		}
	}

	const lines: Array<OutputLine> = [];
	for (const instruction of program.output) {
		let resolved;
		try {
			resolved = program.resolveParsedLine(instruction);
			lines.push(resolved);
		} catch (e) {
			if (instruction.tag === 'instruction') {
				errors.push({
					line: instruction.sourceLine,
					message: e.message,
				});
			} else {
				errors.push({
					line: instruction.sourceLine,
					message: e.message,
				});
			}
		}
	}

	return {
		lines,
		errors,
		message: '',
	};
}

const syntaxHighlighting = new window['Parser']({
	whitespace: /\s+/,
	number: /#?(\$-?[\dA-Fa-f_]+|-?(\d+)|%-?[01_]+)/,
	comment: /\/\/[^\r\n]*|;[^\r\n]*/,
	directive: /\.[a-zA-Z0-9_]+/,
	label: /[a-zA-Z0-9_]+:/,
	string: /"(\\.|[^"\r\n])*"|'(\\.|[^'\r\n])*'/,
	register: /\b[a-fA-FxXyY]\b/,
	instruction: /^[a-zA-Z0-9\.]+/,
	other: /\S/,
});

const archSpecification: ArchSpecification = {
	documentation: '',
	syntaxHighlighting,
	assemble,
	maxWordsPerInstruction: 2,
	wordSize: 8,
	emulator: null,
};
export default archSpecification;

archSpecification.documentation = `
# Lodestar

Lodestar, a.k.a. the computer that's not as good as the V8.

https://github.com/Fawaox/Lodestar

https://www.littlebigforum.net/index.php?t=1277

Over the last couple of months I've developed an 8-bit CPU and 256-byte RAM chip. Together I believe they represent the fastest and most versatile computer made in LBP to date. I call this system the Lodestar.

http://i.imgur.com/iOpsaVv.jpg

A Lodestar system drawing a bunny. Why? Because bunnies.

1 INTRODUCTION
1.1 SPECIFICATION
1.2 DESIGN AND INTERFACE
1.3 INSTRUCTION SET
2 PROGRAMMING
2.1 YOUR FIRST PROGRAM
2.2 ADDITION
2.3 MULTIPLICATION
2.4 INPUT AND OUTPUT
2.5 GRAPHICS
2.6 SOUND
3 WHERE TO GET IT

1 INTRODUCTION

The Lodestar is an 8-bit microcomputer that supports arithmetic, logic, conditional jumps, a stack, subroutines, serial I/O and interrupts. It can also generate music.

The most challenging part of developing the CPU were signal timing issues. To make the best use of each frame the system runs unclocked at 30 Hz, resulting in speeds of around 3 instructions per second.

One of the problems with past computers in LBP is how poorly documented they were by their authors. With this post I hope to provide a comprehensive guide to the system.

1.1 SPECIFICATION

- Accumulator architecture
- 256 bytes of memory
- 2 addressing modes
- Serial I/O ports
- 3 bars of thermo

Internally the system is split into 2 chips: the CPU and RAM. Together they use 4000 components total.

http://i.imgur.com/eBHmNTj.jpg

These chips are mounted on a board above the switch assembly.

1.2 DESIGN AND INTERFACE

The Lodestar's front panel has 20 lights and 12 flip switches. Since I'm a fan of vintage computers the front panel is inspired by machines like the PDP-8 and Altair 8800.

http://i.imgur.com/N2rwbME.jpg

There are 4 control switches: RUN starts and stops a program, EXA examines a memory address, DEP deposits a value into memory, DAT toggles display of the accumulator or data bus.

The address lights show the current memory address. The data lights show either the contents of memory or the accumulator depending on the position of the DAT switch. The status lights indicate the internal state of the machine, such as overflow and I/O port activity.

On the right side of the machine are the serial input and output ports.

1.3 INSTRUCTION SET

The Lodestar instruction set features 36 documented instructions.

http://fs1.directupload.net/images/150419/4beky8gk.png

There are two addressing modes for the LDA, STA, ADD, SUB and bitwise instructions: immediate and absolute. This is determined by the 1th bit of the instruction as demonstrated below.

http://fs1.directupload.net/images/150419/8q92abea.png

These addressing modes allow the use of variables in programs.

2 PROGRAMMING

A Lodestar program is a series of instructions. When you flip the RUN switch the program will begin executing from the current memory address.

Programs are entered byte by byte. To input a byte into memory:


1. Set input switches to desired address and examine
2. Set input switches to desired value and deposit

To input the value 44 at address 08 for instance you would first examine 08 and then deposit 44.

What follows is a tutorial that introduces the instruction set through 6 programs. All the programs begin from address 0.

2.1 YOUR FIRST PROGRAM

A program can be as simple as a single instruction.

http://fs2.directupload.net/images/150419/orqdp4nm.png

This program uses the jump instruction to jump to itself, creating an infinite loop.

2.2 ADDITION

Performing arithmetic is just as simple.

http://fs2.directupload.net/images/150419/whjqdvgg.png

This program loads 5 into the accumulator, then adds 3 to it.

As the name implies the accumulator accumulates the result of all operations. To see the result of this program displayed on the data lights flip the DAT switch up.

2.3 MULTIPLICATION

There's no multiply instruction. Instead, repeated addition can be used.

http://fs2.directupload.net/images/150419/t53dixve.png

This program performs 5 x 4. There are two variables used: x and i. The variable x is initially set to zero and accumulates the result with each iteration of the loop. The variable i is decremented once per iteration and acts as a counter, when it reaches zero the program halts.

2.4 INPUT AND OUTPUT

Located on the right side of the Lodestar are both the serial input port and serial output port. These can be used to connect peripherals or to create networks of Lodestar systems.

On receiving a byte via the input port an interrupt is triggered. An interrupt pushes the current memory address to the stack and the CPU jumps to address 0. After an interrupt has been handled a RTI instruction can be used to return the CPU to the prior address.

http://fs2.directupload.net/images/150419/3u6yenl7.png

This is a powerful program that listens to the input port, copying whatever it receives to memory. This means we can hook up a keyboard to the system, so programs can be entered easier and

faster. In fact, all the programs in this tutorial were written using this program and a keyboard.

Although not necessary, this program uses the stack to temporarily store the interrupt. The stack starts at address FF and decrements down. This is a handy way to pass data around without using lots of LDA and STA instructions.

2.5 GRAPHICS

Using the serial output port it's possible to communicate with peripherals such as a monitor.

http://fs2.directupload.net/images/150419/wgkt3ojh.png

This program sends a region of memory to the serial output port, byte by byte. The monitor treats these bytes as pixel coordinates and updates the screen. In this case, the pixel data is 3 bytes long and draws a triangle.

https://i.imgur.com/LKKAIFa.jpg

By combining this program with the program in the previous section it's possible to copy programs and data from one Lodestar system to another.

2.6 SOUND

Lastly, the Lodestar is also capable of generating music. The lowest 4 bits of the accumulator determine the pitch when the SPK instruction is used.

http://fs2.directupload.net/images/150419/bv2yhvin.png

This program plays a spooky song.

3 WHERE TO GET IT

The level, which features a running system, can be found here:

https://lbp.me/v/qvz2ch0

Simply complete the level to collect the Lodestar, monitor and keyboard as shareable prizes.
`;
