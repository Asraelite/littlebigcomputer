import type { OutputLine, AssemblyInput, ArchSpecification, AssemblyOutput, InputError, LineSource, Emulator } from '../assembly';
import { toBitString } from '../util.js';

export type Reference = {
	sourceAddress: number;
	addressRelative: boolean;
	bitCount: number;
	value: string;
};

type ParsedLabel = {
	tag: 'label';
	source: LineSource,
	name: string;
};

type ParsedInstruction = {
	tag: 'instruction';
	source: LineSource,
	parts: Array<ParsedLinePart>;
	address: number;
};

export type ParsedLinePart = string | Reference;
type ParsedLine = ParsedInstruction | ParsedLabel;

const REG_MAP = {
	'A': '000',
	'B': '001',
	'C': '010',
	'D': '011',
	'E': '100',
	'F': '101',
	'X': '110',
	'Y': '111',
};

function parseRegister(registerString: string): string {
	if (!(registerString in REG_MAP)) {
		throw new Error(`'${registerString}' is not a valid register`);
	}
	return REG_MAP[registerString];
}

function isNumber(value: string): boolean {
	return toNumber(value) !== null;
}

function toNumber(value: string): number {
	let result = null;
	if (value.startsWith('$')) {
		result = parseInt(value.slice(1), 16);
	} else if (value.startsWith('%')) {
		result = parseInt(value.slice(1), 2);
	} else if (value.startsWith('@')) {
		result = parseInt(value.slice(1), 8);
	} else {
		result = parseInt(value, 10);
	}
	if (isNaN(result)) {
		return null;
	}
	return result;
}

type Binding = { tag: 'binding', name: string };

const NUMBER_RE = String.raw`%-?[01][01_]*|\$-?[\da-f][\da-f_]*|@-?[0-7][0-7_]*|-?\d[\d_]*`;
const VALUE_ATOM_RE = String.raw`(?:${NUMBER_RE}|[a-z0-9_-]+)`;
const VALUE_PAIR_RE = String.raw`\((${VALUE_ATOM_RE})\s*([\+\-])\s*(${VALUE_ATOM_RE})\)`;
const VALUE_RE = String.raw`${VALUE_ATOM_RE}|${VALUE_PAIR_RE}`;
const REGISTER_RE = Object.keys(REG_MAP).join('|');

class Program {
	currentAddress: number;
	output: Array<ParsedLine>;
	labels: Map<string, number>;
	constants: Map<string, number>;
	outputEnabled: boolean | null;

	constructor() {
		this.currentAddress = 0;
		this.output = [];
		this.labels = new Map();
		this.constants = new Map();
		this.outputEnabled = null;
	}

	instruction(parts: Array<ParsedLinePart>, wordCount: number, source: LineSource, count: number) {
		if (this.outputEnabled === null || this.outputEnabled) {
			this.output.push({
				tag: 'instruction',
				source,
				address: this.currentAddress,
				parts,
			});
		}
		this.currentAddress += wordCount * count;
	}

	label(name: string, source: LineSource) {
		if (this.labels.has(name)) {
			throw new Error(`Label '${name}' already defined`);
		}
		this.labels.set(name, this.currentAddress);
		this.output.push({
			tag: 'label',
			source,
			name,
		});
	}

	address(value: number) {
		this.currentAddress = value;
	}

	align(value: number) {
		this.currentAddress = Math.ceil(this.currentAddress / value) * value;
	}

	enable() {
		if (this.outputEnabled === null) {
			this.output = [];
		}
		this.outputEnabled = true;
	}

	disable() {
		this.outputEnabled = false;
	}

	data(values: Array<string>, source: LineSource) {
		const numbers: Array<ParsedLinePart> = values.map(n => this.value(n, 8, false, false));
		for (const number of numbers) {
			this.instruction([number], 1, { ...source, realInstruction: '(data)' }, 1);
		}
		return this;
	}

	constant(name: string, value: number) {
		this.constants.set(name, value);
	}

	value(numberOrLabelText: string, bits: number, literalSigned: boolean, labelRelative: boolean): ParsedLinePart {
		if (isNumber(numberOrLabelText)) {
			return toBitString(toNumber(numberOrLabelText), bits, literalSigned);
		} else {
			return {
				addressRelative: labelRelative,
				sourceAddress: this.currentAddress,
				bitCount: bits,
				value: numberOrLabelText,
			};
		}
	}

	literal(numberText: string, bits: number, signed: boolean): number {
		if (!isNumber(numberText)) {
			throw new Error(`Expected number, got ${numberText}`);
		} else {
			return toNumber(numberText);
		}
	}

	parseSourceLine(sourceLine: string, lineNumber: number) {
		// Remove comments beginning with ; and #
		let commentIndex = sourceLine.length;
		if (sourceLine.indexOf(';') !== -1) {
			commentIndex = Math.min(commentIndex, sourceLine.indexOf(';'));
		}
		if (sourceLine.indexOf('//') !== -1) {
			commentIndex = Math.min(commentIndex, sourceLine.indexOf('//'));
		}
		const uncommented = sourceLine.slice(0, commentIndex).trim();
		this.parse({
			lineNumber,
			realInstruction: uncommented,
			sourceInstruction: uncommented,
			sourceInstructionCommented: sourceLine,
		});
	}

	parse(source: LineSource) {
		const line = source.realInstruction;

		if (line === '') {
			return;
		}

		let matchFound = false;

		const match = (...args: Array<string | ((bindings: { [key: string]: string }) => void)>) => {
			if (matchFound) {
				return;
			}
			const fn = args.pop() as any;
			const expression = new RegExp('^' + args.join('') + '$', 'i');
			const result = line.match(expression);
			if (result === null) {
				return;
			}
			fn(result.groups);
			matchFound = true;
		}
		const i = (...parts: Array<ParsedLinePart>) => {
			this.instruction(parts, 1, source, 1);
		};
		const i2 = (...parts: Array<ParsedLinePart>) => {
			this.instruction(parts, 1, source, 2);
		};
		const pseudo = (realInstruction: string) => this.parse({ ...source, realInstruction });
		const binding = (name: string): Binding => ({ tag: 'binding', name });
		const r = binding('r');
		const a = binding('a');
		const b = binding('b');

		const bindablePattern = (regex: string, prefix: string = '', suffix: string = '') => (binding: Binding) =>
			`${prefix}(?<${binding.name}>${regex})${suffix}`;
		const token = bindablePattern(VALUE_RE);
		const register = bindablePattern(REGISTER_RE);
		const immediate = bindablePattern(VALUE_RE, '#');
		const remainder = bindablePattern('.*');

		window['numberRegex'] = NUMBER_RE;

		const s = String.raw`\s+`;
		const so = String.raw`\s*`;
		const sep = String.raw`\s*[,\s]\s*`;
		const hardSep = String.raw`\s*,\s*`;

		const indirect = bindablePattern(VALUE_RE, '\\(', '\\)');
		const registerAndA = bindablePattern(REGISTER_RE, '', `${so},${so}A`);
		const valueAndA = bindablePattern(VALUE_RE, '', `${so},${so}A`);

		match('hlt', () => i('00000000'));
		match('nop', () => i('00000001'));
		match('ret', () => i('00001010'));
		match('rti', () => i('00001011'));
		match('sec', () => i('00001100'));
		match('clc', () => i('00001101'));
		match('eni', () => i('00001110'));
		match('dsi', () => i('00001111'));

		match('jmp', s, indirect(a), ({ a }) => { i2('00000011', this.value(a, 8, false, false)) });
		match('jsr', s, indirect(a), ({ a }) => { i2('00001001', this.value(a, 8, false, false)) });

		match('jmp', s, token(a), ({ a }) => { i2('00000010', this.value(a, 8, false, false)) });
		match('jz', s, token(a), ({ a }) => { i2('00000100', this.value(a, 8, false, false)) });
		match('jnz', s, token(a), ({ a }) => { i2('00000101', this.value(a, 8, false, false)) });
		match('jc', s, token(a), ({ a }) => { i2('00000110', this.value(a, 8, false, false)) });
		match('jnc', s, token(a), ({ a }) => { i2('00000111', this.value(a, 8, false, false)) });
		match('jsr', s, token(a), ({ a }) => { i2('00001000', this.value(a, 8, false, false)) });

		match('adc', s, registerAndA(r), ({ r }) => i('00010', parseRegister(r)));
		match('sbc', s, registerAndA(r), ({ r }) => i('00100', parseRegister(r)));
		match('xor', s, registerAndA(r), ({ r }) => i('00111', parseRegister(r)));
		match('and', s, registerAndA(r), ({ r }) => i('01000', parseRegister(r)));
		match('or', s, registerAndA(r), ({ r }) => i('01001', parseRegister(r)));
		match('cmp', s, registerAndA(r), ({ r }) => i('01110', parseRegister(r)));

		match('inc', s, register(r), ({ r }) => i('00011', parseRegister(r)));
		match('dec', s, register(r), ({ r }) => i('00101', parseRegister(r)));
		match('not', s, register(r), ({ r }) => i('00110', parseRegister(r)));
		match('slc', s, register(r), ({ r }) => i('01010', parseRegister(r)));
		match('src', s, register(r), ({ r }) => i('01011', parseRegister(r)));
		match('rol', s, register(r), ({ r }) => i('01100', parseRegister(r)));
		match('ror', s, register(r), ({ r }) => i('01101', parseRegister(r)));

		match('ld', register(a), sep, register(b), ({ a, b }) => i('11', parseRegister(a), parseRegister(b)));
		match('ld', register(a), sep, valueAndA(b), ({ a, b }) => { i2('10011', parseRegister(a), this.value(b, 8, false, false)); });
		match('st', register(a), sep, valueAndA(b), ({ a, b }) => { i2('10010', parseRegister(a), this.value(b, 8, false, false)); });
		match('ld', register(a), sep, indirect(b), ({ a, b }) => { i2('10101', parseRegister(a), this.value(b, 8, false, false)); });
		match('st', register(a), sep, indirect(b), ({ a, b }) => { i2('10100', parseRegister(a), this.value(b, 8, false, false)); });
		match('ld', register(a), sep, immediate(b), ({ a, b }) => { i2('01111', parseRegister(a), this.value(b, 8, false, false)); });
		match('ld', register(a), sep, token(b), ({ a, b }) => { i2('10001', parseRegister(a), this.value(b, 8, false, false)); });
		match('st', register(a), sep, token(b), ({ a, b }) => { i2('10000', parseRegister(a), this.value(b, 8, false, false)); });

		match('push', s, token(r), ({ r }) => i('10110', parseRegister(r)));
		match('pull', s, token(r), ({ r }) => i('10111', parseRegister(r)));

		// Directives

		match(token(a), ':', ({ a }) => this.label(a, source));
		match('.data', s, remainder(a),
			({ a }) => this.data(a.split(new RegExp(hardSep)), { ...source, sourceInstruction: '.data' }));
		match('.repeat', s, token(a), sep, token(b),
			({ a, b }) => this.data(new Array(this.literal(b, 8, false)).fill(a), { ...source, sourceInstruction: '.repeat' }));
		match('.eq', s, token(a), sep, token(b), ({ a, b }) => this.constant(a, this.literal(b, 8, false)));
		match('.address', s, token(a), ({ a }) => this.address(this.literal(a, 8, false)));
		match('.align', s, token(a), ({ a }) => this.align(this.literal(a, 8, false)));
		match('.start', () => this.enable());
		match('.end', () => this.disable());

		if (!matchFound) {
			throw new Error(`Unknown instruction: ${line}`);
		}
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
			bits += this.resolveParsedLinePart(part);
		}
		if (bits.length % 8 !== 0) {
			throw new Error(`Instruction ${instruction.source.realInstruction} is ${bits.length} bits long, but should be a multiple of 8`);
		}
		return {
			tag: 'instruction',
			bits,
			address: instruction.address,
			source: instruction.source,
		};
	}

	resolveParsedLinePart(part: ParsedLinePart): string {
		if (typeof part === 'string') {
			return part;
		} else if (isNumber(part.value)) {
			return toBitString(toNumber(part.value), part.bitCount, part.addressRelative);
		} else if (this.labels.has(part.value)) {
			const targetLabelAddress = this.labels.get(part.value);
			const value = part.addressRelative ? targetLabelAddress - part.sourceAddress : targetLabelAddress;
			return toBitString(value, part.bitCount, part.addressRelative);
		}

		const offsetMatch = part.value.match(new RegExp(VALUE_PAIR_RE, 'i'));
		if (offsetMatch) {
			const [base, operator, offset] = offsetMatch.slice(1);

			const baseValue = parseInt(this.resolveParsedLinePart({
				...part,
				bitCount: 8,
				value: base,
			}), 2);
			const offsetValue = parseInt(this.resolveParsedLinePart({
				...part,
				bitCount: 8,
				addressRelative: false,
				value: offset,
			}), 2) * (operator === '+' ? 1 : -1);
			return toBitString(baseValue + offsetValue, part.bitCount, part.addressRelative);
		}

		if (this.constants.has(part.value)) {
			const value = this.constants.get(part.value);
			return toBitString(value, part.bitCount, false);
		} else {
			throw new Error(`Unknown label: ${part.value}`);
		}
	}
}

function assemble(input: AssemblyInput): AssemblyOutput {
	const program = new Program();
	const errors: Array<InputError> = [];

	for (const [lineNumber, line] of input.source.split('\n').entries()) {
		try {
			program.parseSourceLine(line, lineNumber);
		} catch (e) {
			errors.push({
				line: lineNumber,
				message: e.message,
			});
		}
	}

	const outputLines: Array<OutputLine> = [];
	for (const instruction of program.output) {
		let resolved: OutputLine;
		try {
			resolved = program.resolveParsedLine(instruction);
			outputLines.push(resolved);
		} catch (e) {
			errors.push({
				line: instruction.source.lineNumber,
				message: e.message,
			});
		}
	}

	return {
		lines: outputLines,
		errors,
		message: '',
	};
}

const STACK_POINTER_ADDRESS = 0x7f;
const INTERRUPT_VECTOR_ADDRESS = 0xfe;
const RESET_VECTOR_ADDRESS = 0xff;

class V8Emulator implements Emulator {
	memory: Array<number> = [];
	registers: Array<number> = [];
	pc: number;
	cycle: number;
	carryFlag: boolean;
	zeroFlag: boolean;
	interruptsEnabled: boolean;

	constructor() {
		this.init([]);
	}

	init(memory: Array<number>) {
		this.memory = memory;
		this.memory[STACK_POINTER_ADDRESS] = STACK_POINTER_ADDRESS - 1;
		this.registers = new Array(8).fill(0);
		this.pc = this.memory[RESET_VECTOR_ADDRESS] ?? 0;
		this.cycle = 0;
		this.carryFlag = false;
		this.zeroFlag = false;
		this.interruptsEnabled = true;
	}

	step() {
		const instruction = this.memory[this.pc] ?? 0;
		const immediate = this.memory[this.pc + 1] ?? 0;
		const bits = instruction.toString(2).padStart(8, '0');
		const operand = bits.slice(5, 8);

		if (bits === '00000000') {
			// hlt
		} else if (bits === '00000001') {
			// nop
			this.pc += 1;
		} else if (bits === '00000010') {
			// jmp imm
			this.pc = immediate;
		} else if (bits === '00000011') {
			// jmp abs
			this.pc = this.memory[immediate] ?? 0;
		} else if (bits === '00000100') {
			// jz imm
			this.pc = this.registers[0] === 0 ? immediate : this.pc + 1;
		} else if (bits === '00000101') {
			// jnz imm
			this.pc = this.registers[0] !== 0 ? immediate : this.pc + 1;
		} else if (bits === '00000110') {
			// jc imm
			this.pc = this.carryFlag ? immediate : this.pc + 1;
		} else if (bits === '00000111') {
			// jnc imm
			this.pc = !this.carryFlag ? immediate : this.pc + 1;
		} else if (bits === '00001000') {
			// jsr imm
			this.push(this.pc + 2);
			this.pc = immediate;
		} else if (bits === '00001001') {
			// jsr abs
			this.push(this.pc + 2);
			this.pc = this.memory[immediate] ?? 0;
		} else if (bits === '00001010') {
			// ret
			this.pc = this.pop();
		} else if (bits === '00001011') {
			// rti
			this.pc = this.pop();
			this.interruptsEnabled = true;
		} else if (bits === '00001100') {
			// sec
			this.carryFlag = true;
			this.pc += 1;
		} else if (bits === '00001101') {
			// clc
			this.carryFlag = false;
			this.pc += 1;
		} else if (bits === '00001110') {
			// eni
			this.interruptsEnabled = true;
			this.pc += 1;
		} else if (bits === '00001111') {
			// dsi
			this.interruptsEnabled = false;
			this.pc += 1;
		} else if (bits.startsWith('00010')) {
			// adc
			this.aluOp(operand, (x, a) => x + a + (this.carryFlag ? 1 : 0));
		} else if (bits.startsWith('00011')) {
			// inc
			this.aluOp(operand, (x, a) => x + 1);
		} else if (bits.startsWith('00100')) {
			// sbc
			this.aluOp(operand, (x, a) => x - a - (this.carryFlag ? 1 : 0));
		} else if (bits.startsWith('00101')) {
			// dec
			this.aluOp(operand, (x, a) => x - 1);
		} else if (bits.startsWith('00110')) {
			// not
			this.aluOp(operand, (x, a) => (~x) & 0xff);
		} else if (bits.startsWith('00111')) {
			// xor
			this.aluOp(operand, (x, a) => x ^ a);
		} else if (bits.startsWith('01000')) {
			// and
			this.aluOp(operand, (x, a) => x & a);
		} else if (bits.startsWith('01001')) {
			// or
			this.aluOp(operand, (x, a) => x | a);
		} else if (bits.startsWith('01010')) {
			// slc
			this.aluOp(operand, (x, a) => (x << 1) + (this.carryFlag ? 1 : 0));
		} else if (bits.startsWith('01011')) {
			// src
			const operandValue = this.getRegister(operand);
			const aValue = this.registers[0];
			const result = operandValue >>> 1 + (this.carryFlag ? 0x80 : 0);
			this.zeroFlag = result === 0;
			this.carryFlag = (operandValue & 0x01) === 1;
			this.registers[0] = result & 0xff;
			this.pc += 1;
		} else if (bits.startsWith('01100')) {
			// rol
			this.aluOp(operand, (x, a) => (x << 1) + (x >>> 7));
		} else if (bits.startsWith('01101')) {
			// ror
			const initialValue = this.getRegister(operand);
			this.aluOp(operand, (x, a) => (x >>> 1) + ((x & 1) << 7));
			this.carryFlag = (initialValue & 1) === 1;
		} else if (bits.startsWith('01110')) {
			// cmp
			const operandValue = this.getRegister(operand);
			const aValue = this.registers[0];
			const result = aValue - operandValue;
			this.zeroFlag = result === 0;
			this.carryFlag = result > 0;
			this.pc += 1;
		} else if (bits.startsWith('01111')) {
			// ldR imm
			this.setRegister(operand, immediate);
			this.pc += 2;
		} else if (bits.startsWith('10000')) {
			// stR abs
			this.memory[immediate] = this.getRegister(operand);
			this.pc += 2;
		} else if (bits.startsWith('10001')) {
			// ldR abs
			this.setRegister(operand, this.memory[immediate] ?? 0);
			this.pc += 2;
		} else if (bits.startsWith('10010')) {
			// stR aai
			this.memory[immediate + this.registers[0]] = this.getRegister(operand);
			this.pc += 2;
		} else if (bits.startsWith('10011')) {
			// ldR aai
			this.setRegister(operand, this.memory[immediate + this.registers[0]] ?? 0);
			this.pc += 2;
		} else if (bits.startsWith('10100')) {
			// stR ind
			this.memory[this.memory[immediate] ?? 0] = this.getRegister(operand);
			this.pc += 2;
		} else if (bits.startsWith('10101')) {
			this.setRegister(operand, this.memory[this.memory[immediate] ?? 0] ?? 0);
			this.pc += 2;
		} else if (bits.startsWith('10110')) {
			// push
			this.push(this.getRegister(operand));
			this.pc += 1;
		} else if (bits.startsWith('10111')) {
			// pull
			this.setRegister(operand, this.pop());
			this.pc += 1;
		} else if (bits.startsWith('11')) {
			// ldR R
			this.setRegister(bits.slice(2, 5), this.getRegister(operand));
			this.pc += 1;
		}
	}

	aluOp(register: string, fn: (x: number, a: number) => number) {
		const operandValue = this.getRegister(register);
		const aValue = this.registers[0];
		const result = fn(operandValue, aValue);
		this.zeroFlag = result === 0;
		this.carryFlag = result > 0xff;
		this.registers[0] = result & 0xff;
		this.pc += 1;
	}

	push(value: number) {
		this.memory[this.memory[STACK_POINTER_ADDRESS]--] = value;
	}

	pop(): number {
		return this.memory[++this.memory[STACK_POINTER_ADDRESS]];
	}

	getRegisterA(): number {
		return this.registers[0];
	}

	getRegister(register: string): number {
		const index = parseInt(register, 2);
		return this.registers[index];
	}

	setRegister(register: string, value: number) {
		const index = parseInt(register, 2);
		this.registers[index] = value;
	}

	printState(): string {
		const registerNames = ['A', 'B', 'C', 'D', 'E', 'F', 'X', 'Y'];
		const registersString = this.registers.map((value, index) => `${registerNames[index]}=${value.toString(16).padStart(2, '0')}`).join(' ');
		let memoryString = '   ';

		for (let i = 0; i < 16; i++) {
			memoryString += `<span style="color: gray">x${i.toString(16)} </span>`;
		}

		for (let i = 0; i < 16; i++) {
			memoryString += `\n<span style="color: gray">${i.toString(16)}x </span>`;
			for (let j = 0; j < 16; j++) {
				const address = i * 16 + j;
				const value = this.memory[address] ?? 0;
				let style = '';
				if (address === this.memory[STACK_POINTER_ADDRESS]) {
					style += 'background-color: cyan;';
				}
				if (address === this.pc) {
					style += 'background-color: #fcb55b;';
				}
				memoryString += `<span style="${style}">`;
				memoryString += `${value.toString(16).padStart(2, '0')}`;
				memoryString += '</span>';
				memoryString += ' ';
			}
		}
		return `
			<pre><span style="background-color: #fcb55b">pc: ${this.pc.toString(16).padStart(2, '0')}</span>,<span style="background-color: cyan"> stack pointer: ${this.memory[STACK_POINTER_ADDRESS].toString(16).padStart(2, '0')}</span></pre>
			<pre>${registersString}</pre>
			<pre>memory:\n${memoryString}</pre>
		`;
	}
}

const syntaxHighlighting = new window['Parser']({
	whitespace: /\s+/,
	number: /#?(\$-?[\dA-Fa-f_]+|-?(\d+)|%-?[01_]+|@-?[0-7_]+)/,
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
	emulator: new V8Emulator(),
};
export default archSpecification;

archSpecification.documentation = `
\`\`\`
V     V  888
V     V 8   8
 V   V  8   8
 V   V   888
  V V   8   8
  V V   8   8
   V     888
\`\`\`

The V8 is an 8-bit RISC processor with an 8-bit address bus, 8 registers and 2 flags
developed in LBP2 by Neon. It was optimized for efficiency rather than speed (WHAT
DOES THAT MEAN???!?!? (this means that efficiency (component count) was favoured
over speed in the past (keyword: was))) and can be clocked up to 7.5 Hz.

## OPCODE SHEET
\`\`\`
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
|OPCODES|   0   |   1   |   2   |   3   |   4   |   5   |   6   |   7   |   8   |   9   |   A   |   B   |   C   |   D   |   E   |   F   |
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
|   0   |  HLT  |  NOP  |JMP imm|JMP abs|JZ imm |JNZ imm|JC imm |JNC imm|JSR imm|JSR abs|  RET  |  RTI  |  SEC  |  CLC  |  ENI  |  DSI  |
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
|   1   |ADC A,A|ADC B,A|ADC C,A|ADC D,A|ADC E,A|ADC F,A|ADC X,A|ADC Y,A| INC A | INC B | INC C | INC D | INC E | INC F | INC X | INC Y |
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
|   2   |SBC A,A|SBC B,A|SBC C,A|SBC D,A|SBC E,A|SBC F,A|SBC X,A|SBC Y,A| DEC A | DEC B | DEC C | DEC D | DEC E | DEC F | DEC X | DEC Y |
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
|   3   | NOT A | NOT B | NOT C | NOT D | NOT E | NOT F | NOT X | NOT Y |XOR A,A|XOR B,A|XOR C,A|XOR D,A|XOR E,A|XOR F,A|XOR X,A|XOR Y,A|
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
|   4   |AND A,A|AND B,A|AND C,A|AND D,A|AND E,A|AND F,A|AND X,A|AND Y,A|OR A,A |OR B,A |OR C,A |OR D,A |OR E,A |OR F,A |OR X,A |OR Y,A |
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
|   5   | SLC A | SLC B | SLC C | SLC D | SLC E | SLC F | SLC X | SRC Y | SRC A | SRC B | SRC C | SRC D | SRC E | SRC F | SRC X | SRC Y |
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
|   6   | ROL A | ROL B | ROL C | ROL D | ROL E | ROL F | ROL X | ROL Y | ROR A | ROR B | ROR C | ROR D | ROR E | ROR F | ROR X | ROR Y |
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
|   7   |CMP A,A|CMP B,A|CMP C,A|CMP D,A|CMP E,A|CMP F,A|CMP X,A|CMP Y,A|LDA imm|LDB imm|LDC imm|LDD imm|LDE imm|LDF imm|LDX imm|LDY imm|
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
|   8   |STA abs|STB abs|STC abs|STD abs|STE abs|STF abs|STX abs|STY abs|LDA abs|LDB abs|LDC abs|LDD abs|LDE abs|LDF abs|LDX abs|LDY abs|
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
|   9   |STA aai|STB aai|STC aai|STD aai|STE aai|STF aai|STX aai|STY aai|LDA aai|LDB aai|LDC aai|LDD aai|LDE aai|LDF aai|LDX aai|LDY aai|
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
|   A   |STA ind|STB ind|STC ind|STD ind|STE ind|STF ind|STX ind|STY ind|LDA ind|LDB ind|LDC ind|LDD ind|LDE ind|LDF ind|LDX ind|LDY ind|
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
|   B   |PUSH A |PUSH B |PUSH C |PUSH D |PUSH E |PUSH F |PUSH X |PUSH Y |PULL A |PULL B |PULL C |PULL D |PULL E |PULL F |PULL X |PULL Y |
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
|   C   | LDA A | LDA B | LDA C | LDA D | LDA E | LDA F | LDA X | LDA Y | LDB A | LDB B | LDB C | LDB D | LDB E | LDB F | LDB X | LDB Y |
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
|   D   | LDC A | LDC B | LDC C | LDC D | LDC E | LDC F | LDC X | LDC Y | LDD A | LDD B | LDD C | LDD D | LDD E | LDD F | LDD X | LDD Y |
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
|   E   | LDE A | LDE B | LDE C | LDE D | LDE E | LDE F | LDE X | LDE Y | LDF A | LDF B | LDF C | LDF D | LDF E | LDF F | LDF X | LDF Y |
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
|   F   | LDX A | LDX B | LDX C | LDX D | LDX E | LDX F | LDX X | LDX Y | LDY A | LDY B | LDY C | LDY D | LDY E | LDY F | LDY X | LDY Y |
+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+-------+
\`\`\`

## REGISTERS
A (Accumulator): acts like a normal register, but certain operations will overwrite it's contents
B,C,D,E,F,X,Y: general purpose registers



## ADDRESSING MODES
Here is an overview of the addressing modes used in the opcode sheet and in the instruction summary, as well as how they would look in an
assembler using LDA as an example. "*" represents the byte immediately after the instruction.

 (R) (Register): (R) is used as a placeholder and represents any of the 8 registers.
  assembler: LDA r

 imm (IMMediate): the data used is * itself.
  assembler: LDA #*

 abs (ABSolute): * points to the memory address to interact with.
  assembler: LDA *
 
 aai (Absolute, A Indexed): *+A points to the memory address to interact with.
  assembler: LDA *,A

 ind (INDirect): * points to a memory address, and the byte at that address points to the address to interact with.
  assembler: LDA (*)



  ## FLAGS
The V8 has 2 flags: Zero (Z) and Carry (C). zero is set whenever the last read data=$00 and Carry is naturally set whenever the ALU
outputs a carry-out of sorts, but can also be manually set or reset.



## INTERRUPTS
interrupts are triggered by hardware and cause the processor to stop what it's doing and jump to the address pointed to by the interrupt
vector located at memory address $FE, saving a return address to the stack. Once an interrupt occurs, no further interrupts can occur
until interrupts are re-enabled. Interrupts can only be handled while CLK is high, interrupts are enabled and the processor isn't already
executing an instruction. If an interrupt is triggered while these conditions aren't met, it will be handled once the conditions for an
interrupt to occur are met. Furthermore, the interrupt input must be brought low and then high again for another interrupt to occur.
Once triggered, it takes 4 clock cycles for the processor to jump to where the interrupt vector points.



## RESETS
Bringing the reset input high will cause the processor to initialize itself. Resets take priority over interrupts and are handled when
CLK is high, but can be triggered at any time, similar to interrupts. Resets take 2 clock cycles to be handled, during which all 8
registers are set to $00, the stack pointer is set to $7E, interrupts are disabled and the processor jumps to where the reset vector,
located at memory address $FF, points to.



## THE STACK
The stack is a region of memory used as a large LIFO (Last In First Out) buffer. The stack pointer is located at memory address $7F and
points to the next free layer. The stack pointer initially points to memory address $7E by default, but can be relocated elsewhere if
needed. The stack cascades downwards, meaning pushing something onto the stack will decrement the stack pointer and pulling something
from it will increment the pointer.



## INSTRUCTIONS
This is a basic overview of the V8's 31 instructions along with how many clock cycles (CCs) they take and which flags they affect.


-ADC (R),A: ADd A to (R) with Carry input, sum is written to A
 CCs: 1
 flags affected: C,Z

-AND r,A: bitwise AND between (R) and A, result is written to A
 CCs: 1
 flags affected: Z

-CLC: CLears the Carry flag
 CCs: 1
 flags affected: C

-CMP (R),A: CoMPare (R) to A and set the flags accordingly, functionally the same as subtracting (R) from A and discarding the difference
 CCs: 1
 flags affected: C,Z

-DEC (R): DECrement (R) by 1
 CCs: 1
 flags affected: C,Z

-DSI: DiSable Interrupts
 CCs: 1
 flags affected: none

-ENI: ENable Interrupts
 CCs: 1
 flags affected: none

-HLT: enable interrupts and HaLT the processor until an interrupt or reset occurs
 CCs: N/A
 flags affected: none

-INC (R): INCrement (R) by 1
 CCs: 1
 flags affected: C,Z

-JC: Jump if the Carry flag is set
 CCs: 1 or 2*
 flags affected: none

-JMP: JuMP to a new address
 CCs:
  JMP imm: 2
  JMP abs: 3
 flags affected: none

-JNC (Jump on No Carry) jump if the carry flag is Not set
 CCs: 1 or 2*
 flags affected: none

-JNZ (jump on No Zero) jump if the zero flag isn't set
 CCs: 1 or 2*
 flags affected: none

-JSR (Jump to SubRoutine): push a return address onto the stack and jump to a new address
 CCs: 
  JSR imm: 4
  JSR abs: 5
 flags affected: none

-JZ: jump if the zero flag is set
 CCs: 1 or 2*
 flags affected: none

-LDr: LoaD data into r
 CCs:
  LD(R) (R): 1
  LD(R) imm: 2
  LD(R) abs: 3
  LD(R) aii: 3
  LD(R) ind: 4
 flags affected: Z

-NOP: NO OPeration is performed
 CCs: 1
 flags affected: none

-NOT r: bitwise NOT on r
 CCs: 1
 flags affected: Z

-OR (R),A: bitwise OR between (R) and A, result is written to A
 CCs: 1
 flags affected: Z

-PULL (R): PULL the last stack entry into (R) 
 CCs: 3
 flags affected: none

-PUSH (R): PUSH (R) onto the stack
 CCs: 3
 flags affected: none

-RET (RETurn from subroutine): pull the last saved return address from the stack and jump to it
 CCs: 3
 flags affected: none

-ROL (R): ROtate (R) one bit to the Left
 CCs: 1
 flags affected: C,Z

-ROR (R): ROtate (R) one bit to the Right
 CCs: 1
 flags affected: C,Z

-RTI (ReTurn from Interrupt): pull the last saved return address from the stack and jump to it and enable interrupts
 CCs: 3
 flags affected: none

-SEC: SEt the Carry flag
 CCs: 1
 flags affected: C

-SLC (R): Shifts (R) one bit to the Left with Carry input
 CCs: 1
 flags affected: C,Z

-SRC (R): Shifts (R) one bit to the Right with Carry input
 CCs: 1
 flags affected: C,Z

-ST(R): STore (R) into memory
 CCs:
  ST(R)  abs: 3
  ST(R)  aii: 3
  ST(R)  ind: 4
 flags affected: none

-SBC (R),A: SuBtract A from (R) with Carry input, difference is written to A
 CCs: 1
 flags affected: C,Z

-XOR (R),A: bitwise XOR between (R) and A, result is written to A
 CCs: 1
 flags affected: Z

*: Conditional jumps take 1 clock cycle if the condition is false and 2 if it's true



## PINOUT
Here is a description of what each input/output does and where they are located on the processor:
\`\`\`
      __   __
     |  \\_/  |- AD7
     |       |- AD6
     |       |- AD5
CLK -|       |- AD4
INT -|       |- AD3
RST -|       |- AD2
DI7 -|       |- AD1
DI6 -|       |- AD0
DI5 -|       |- DO7
DI4 -|       |- DO6
DI3 -|       |- DO5
DI2 -|       |- DO4
DI1 -|       |- DO3
DI0 -|       |- DO2
     |       |- DO1
     |       |- DO0
     |       |- R
     |_______|- W

CLK: CLocK input
INT: INTerrupt
RST: ReSeT
DI7-DI0: Data Input bus
AD7-AD0: ADdress bus
DO7-DO0: Data Output bus
R: Read
W: Write
\`\`\`
`;
