import type { OutputLine, AssemblyInput, ArchSpecification, AssemblyOutput, InputError, LineSource, Emulator } from '../assembly';
import { toBitString, toNote24 } from '../util.js';

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

const REG_3_MAP = {
	'x0': '0000',
	'ra': '0000',
	'x1': '0001',
	'sp': '0001',
	'x2': '0010',
	'bp': '0010',
	'x3': '0011',
	's0': '0011',
	'x4': '0100',
	't0': '0100',
	'x5': '0101',
	't1': '0101',
	'x6': '0110',
	'a0': '0110',
	'x7': '0111',
	'a1': '0111',
};

const REG_4_MAP = {
	...REG_3_MAP,
	'zero': '1000',
	'pc': '1001',
	'cycle': '1010',
	'upper': '1011',
};

const REG_DOUBLE_MAP = {
	'x01': '0000',
	'x23': '0010',
	'x45': '0100',
	'x67': '0110',
};

const REG_MAP = {
	...REG_4_MAP,
	...REG_DOUBLE_MAP,
};

interface StringEncoding {
	name: string;
	bitsPerCharacter: number;
	pack: boolean;
	values: Array<string | null>;
};

const STRING_ENCODING: { [key: string]: StringEncoding } = {
	ascii: {
		name: 'ASCII',
		bitsPerCharacter: 8,
		pack: false,
		values: ['\\0', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, ' ', '!', '\"', '#', '$', '%', '&', '\'', '(', ')', '*', '+', ',', '-', '.', '/', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ':', ';', '<', '=', '>', '?', '@', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '[', '\\', ']', '^', '_', '`', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', '{', '|', '}', '~', null],
	},
	terminal: {
		name: 'Terminal',
		bitsPerCharacter: 7,
		pack: false,
		values: ['\\0', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '-', '*', '/', '(', ')'],
	},
};

function reg3(register: string): string {
	if (!(register in REG_3_MAP)) {
		if (register in REG_4_MAP) {
			throw new Error(`Expected basic register, got special register '${register}'`);
		} else if (register in REG_DOUBLE_MAP) {
			throw new Error(`Expected word register, got double register '${register}'`);
		} else {
			throw new Error(`'${register}' is not a valid register`);
		}
	}
	return REG_3_MAP[register].slice(1);
}

function reg4(register: string): string {
	if (!(register in REG_4_MAP)) {
		if (register in REG_DOUBLE_MAP) {
			throw new Error(`Expected word register, got double register '${register}'`);
		} else {
			throw new Error(`'${register}' is not a valid register`);
		}
	}
	return REG_4_MAP[register];
}

function reg3d(register: string): string {
	if (!(register in REG_DOUBLE_MAP)) {
		if (register in REG_4_MAP) {
			throw new Error(`Expected double register, got word register '${register}'`);
		} else {
			throw new Error(`'${register}' is not a valid register`);
		}
	}
	return REG_DOUBLE_MAP[register].slice(1);
}

function isNumber(value: string): boolean {
	return toNumber(value) !== null;
}

function isChar(value: string): boolean {
	return value.match(/^-?'\\?.'$/) !== null;
}

function isRegister(value: string): boolean {
	return value in REG_MAP;
}

function toNumber(value: string): number {
	let match;
	const negative = value.startsWith('-') ? -1 : 1;
	if (match = value.match(/^-?0x([0-9a-f][0-9a-f_]*$)/)) {
		return parseInt(match[1].replace(/_/g, ''), 16) * negative;
	} else if (match = value.match(/^-?0b([01][01_]*$)/)) {
		return parseInt(match[1].replace(/_/g, ''), 2) * negative;
	} else if (match = value.match(/^-?0o([0-7][0-7_]*$)/)) {
		return parseInt(match[1].replace(/_/g, ''), 8) * negative;
	} else if (match = value.match(/^-?([0-9][0-9_]*$)/)) {
		return parseInt(match[1].replace(/_/g, ''), 10) * negative;
	} else {
		return null;
	}
}

type Binding = { tag: 'binding', name: string };

class Program {
	currentAddress: number;
	output: Array<ParsedLine>;
	labels: Map<string, number>;
	constants: Map<string, number>;
	outputEnabled: boolean | null;
	stringEncoding: StringEncoding;

	constructor() {
		this.currentAddress = 0;
		this.output = [];
		this.labels = new Map();
		this.constants = new Map();
		this.outputEnabled = null;
		this.stringEncoding = STRING_ENCODING.ascii;
	}

	instruction(parts: Array<ParsedLinePart>, wordCount: number, source: LineSource) {
		if (this.outputEnabled === null || this.outputEnabled) {
			this.output.push({
				tag: 'instruction',
				source,
				address: this.currentAddress,
				parts,
			});
		}
		this.currentAddress += wordCount;
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

	align(value: number, source: LineSource) {
		while (this.currentAddress < Math.ceil(this.currentAddress / value) * value) {
			this.instruction(['0'.repeat(24)], 1, { ...source, realInstruction: '(align)' });
		}
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

	setStringEncoding(name: string) {
		const encoding = STRING_ENCODING[name];
		if (encoding === undefined) {
			throw new Error(`Unknown string encoding '${name}'`);
		}
		this.stringEncoding = encoding;
	}

	data(values: Array<string>, source: LineSource) {
		const numbers: Array<ParsedLinePart> = values.map(n => this.value(n, 24, false, false));
		for (const number of numbers) {
			this.instruction([number], 1, { ...source, realInstruction: '(data)' });
		}
		return this;
	}

	string(value: string, source: LineSource) {
		const words = [];
		const encoding = this.stringEncoding;
		const charactersPerWord = 24 / encoding.bitsPerCharacter | 0;
		let currentWordBits = '';
		let currentWordCharacterCount = 0;

		const characters = Array.from(value.slice(1, value.length - 1).matchAll(/\\.|./g)).map(x => x[0]);

		// TODO: Support different endianness
		for (let i = 0; i < characters.length; i++) {
			const characterValue = this.getCharValue(characters[i]);
			const bits = toBitString(characterValue, encoding.bitsPerCharacter, false);
			currentWordBits = bits + currentWordBits;
			currentWordCharacterCount += 1;
			if (encoding.pack === false || currentWordCharacterCount >= charactersPerWord || i == characters.length - 1) {
				this.instruction([currentWordBits.padStart(24, '0')], 1, { ...source, realInstruction: '(string)' });
				currentWordBits = '';
				currentWordCharacterCount = 0;
			}
		}
	}

	getCharValue(character: string) {
		let negative = false;
		if (character.startsWith('-') && character.length != 1) {
			negative = true;
			character = character.slice(1);
		}
		if (character.startsWith('\'') && character.endsWith('\'')) {
			character = character.slice(1, character.length - 1);
		}
		const value = this.stringEncoding.values.indexOf(character);
		if (value === -1) {
			throw new Error(`The character '${character}' does not exist in the encoding '${this.stringEncoding.name}'`);
		}
		return value * (negative ? -1 : 1);
	}

	constant(name: string, value: number) {
		this.constants.set(name, value);
	}

	value(numberOrLabelText: string, bits: number, literalSigned: boolean, labelRelative: boolean): ParsedLinePart {
		if (isNumber(numberOrLabelText)) {
			return toBitString(toNumber(numberOrLabelText), bits, literalSigned);
		} else if (isChar(numberOrLabelText)) {
			return toBitString(this.getCharValue(numberOrLabelText), bits, false);
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
		if (isNumber(numberText)) {
			return toNumber(numberText);
		} else if (isChar(numberText)) {
			return this.getCharValue(numberText);
		} else {
			throw new Error(`Expected number, got ${numberText}`);
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
		if (sourceLine.indexOf('#') !== -1) {
			commentIndex = Math.min(commentIndex, sourceLine.indexOf('#'));
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
			this.instruction(parts, 1, source);
		};
		const pseudo = (realInstruction: string) => this.parse({ ...source, realInstruction });
		const binding = (name: string): Binding => ({ tag: 'binding', name });
		const a = binding('a');
		const b = binding('b');
		const d = binding('d');

		const bindablePattern = (regex: string) => (binding: Binding) => `(?<${binding.name}>${regex})`;
		const token = bindablePattern(String.raw`[a-z0-9_-]+|\([a-z0-9_-]+\s*[\+\-]\s*[a-z0-9_-]+\)|-?'\\?.'`);
		const register = bindablePattern(Object.keys(REG_MAP).join('|'));
		const string = bindablePattern('".*"');
		const remainder = bindablePattern('.*');

		const s = String.raw`\s+`;
		const so = String.raw`\s*`;
		const sep = String.raw`\s*[,\s]\s*`;

		const matchAluOp = (opcode: string, bits: string, isImmediateSigned: boolean) => {
			match(opcode, s, token(d), sep, token(a), sep, token(b),
				({ a, d, b }) => i('0', bits, '1', reg4(a), reg3(d), reg3(b), '000000000'));
			match(opcode + 'i', s, token(d), sep, token(a), sep, token(b),
				({ a, d, b }) => i('0', bits, '0', reg4(a), reg3(d), this.value(b, 12, isImmediateSigned, false)));
		};

		const matchSpecialAluOp = (opcode: string, bits: string) => {
			match(opcode, s, token(d), sep, token(a), sep, token(b), ({ a, d, b }) =>
				i('0', bits, reg3(a)[0], '111', reg3(a).slice(1), reg3(d), reg3(b), '000000000'));
			match(opcode + 'i', s, token(d), sep, token(a), sep, token(b), ({ a, d, b }) =>
				i('0', bits, reg3(a)[0], '011', reg3(a).slice(1), reg3(d), this.value(b, 12, false, false)));
		};

		// ALU

		matchAluOp('add', '000', true);
		match('sub', s, token(d), sep, token(a), sep, token(b),
			({ a, d, b }) => i('00011', reg4(a), reg3(d), reg3(b), '000000000'));
		match('lui', s, token(d), sep, token(a), ({ a, d }) =>
			i('00010', '1000', reg3(d), this.value(a, 12, false, false)));
		matchAluOp('sll', '010', false);
		matchAluOp('srl', '011', false);
		matchAluOp('sra', '100', false);
		matchAluOp('xor', '101', false);
		matchAluOp('or', '110', false);
		matchAluOp('and', '111', false);

		matchSpecialAluOp('mulu', '00');
		matchSpecialAluOp('mulhu', '01');
		matchSpecialAluOp('divu', '10');
		matchSpecialAluOp('remu', '11');

		// match('mulu', s, token(d), sep, token(a), sep, token(b), ({ a, d, b }) =>
		// 	i('000', reg3(a)[0], '111', reg3(a).slice(1), reg3(d), reg3(b), '000000000'));
		// match('mului', s, token(d), sep, token(a), sep, token(b), ({ a, d, b }) =>
		// 	i('000', reg3(a)[0], '111', reg3(a).slice(1), reg3(d), reg3(b), '000000000'));

		match('nop', () => pseudo(`addi x0, x0, 0`));
		match('mv', s, token(d), sep, token(a), ({ a, d }) => pseudo(`add ${d}, zero, ${a}`));
		match('li', s, token(d), sep, token(a), ({ a, d }) => {
			if (isNumber(a)) {
				const value = toNumber(a);
				toBitString(value, 24, false); // Throw error if out of range
				if (value < -(2 ** 11) || value >= 2 ** 12) {
					pseudo(`lui ${d}, ${(value >> 12) & 0xfff}`);
					pseudo(`ori ${d}, ${d}, ${value & 0xfff}`);
				} else {
					pseudo(`addi ${d}, zero, ${a}`);
				}
			} else {
				pseudo(`addi ${d}, zero, ${a}`);
			}
		});

		// Data

		const matchDataOp = (opcode: string, bits: string, useDouble: boolean) => {
			match(opcode, s, token(d), sep, register(b), so, '\\(', so, token(a), so, '\\)',
				({ a, b, d }) => i('10' + bits + '1', reg4(a), useDouble ? reg3d(d) : reg3(d), reg3(b), '000000000'));
			match(opcode, s, token(d), sep, token(b), so, '\\(', so, token(a), so, '\\)',
				({ a, b, d }) => i('10' + bits + '0', reg4(a), useDouble ? reg3d(d) : reg3(d), this.value(b, 12, true, false)));
		};

		matchDataOp('lw', '00', false);
		matchDataOp('sw', '01', false);
		matchDataOp('ld', '10', true);
		matchDataOp('sd', '11', true);

		match('lw', s, token(d), sep, token(b), ({ b, d }) => pseudo(`lw ${d}, ${b}(zero)`));
		match('sw', s, token(d), sep, token(b), ({ b, d }) => pseudo(`sw ${d}, ${b}(zero)`));
		match('ld', s, token(d), sep, token(b), ({ b, d }) => pseudo(`ld ${d}, ${b}(zero)`));
		match('sd', s, token(d), sep, token(b), ({ b, d }) => pseudo(`sd ${d}, ${b}(zero)`));

		match('push', s, token(a), ({ a }) => {
			pseudo(`sw ${a}, 0(sp)`);
			pseudo(`addi sp, sp, 1`);
		});
		match('pop', s, token(a), ({ a }) => {
			pseudo(`addi sp, sp, -1`);
			pseudo(`lw ${a}, 0(sp)`);
		});

		// Branching

		const matchBranch = (opcode: string, bits: string, swapOperands: boolean) => {
			match(opcode, s, token(a), sep, token(d), sep, token(b),
				({ a, d, b }) => i('11', bits, reg4(swapOperands ? d : a), reg3(swapOperands ? a : d), this.value(b, 12, true, true)));
		};

		matchBranch('beq', '000', false);
		matchBranch('bltu', '010', false);
		matchBranch('blt', '100', false);
		matchBranch('bne', '001', false);
		matchBranch('bgeu', '011', false);
		matchBranch('bge', '101', false);

		matchBranch('bgt', '100', true);
		matchBranch('bgtu', '010', true);
		matchBranch('ble', '101', true);
		matchBranch('bleu', '011', true);

		match('beqz', s, token(a), sep, token(b), ({ a, b }) => pseudo(`beq zero, ${a}, ${b}`));
		match('bnez', s, token(a), sep, token(b), ({ a, b }) => pseudo(`bne zero, ${a}, ${b}`));
		match('bgtz', s, token(a), sep, token(b), ({ a, b }) => pseudo(`blt zero, ${a}, ${b}`));
		match('blez', s, token(a), sep, token(b), ({ a, b }) => pseudo(`bge zero, ${a}, ${b}`));

		match('bltz', s, token(a), sep, token(b), ({ a, b }) => i('11', '110', reg4(a), '000', this.value(b, 12, true, true)));
		match('bgez', s, token(a), sep, token(b), ({ a, b }) => i('11', '111', reg4(a), '000', this.value(b, 12, true, true)));

		match('j', s, token(b), so, '\\(', so, token(a), so, '\\)',
			({ a, b }) => {
				const useRegister = isRegister(b);
				i('11', '11', useRegister ? '1' : '0', reg4(a), '100', useRegister ? reg3(b) + '000000000' : this.value(b, 12, false, false));
			});
		match('j', s, token(b), ({ b }) => pseudo(`j ${b}(zero)`));

		match('b', s, token(a), ({ a }) => {
			if (isRegister(a)) {
				pseudo(`j ${a}(pc)`);
			} else {
				pseudo(`beq x0, x0, ${a}`);
			}
		});
		match('wfi', () => pseudo(`b 0`));
		match('call', s, token(a), ({ a }) => {
			pseudo(`addi ra, pc, 2`);
			pseudo(`j ${a}`);
		});
		match('ret', () => pseudo(`j ra`));

		// Directives

		match(token(a), ':', ({ a }) => this.label(a, source));
		match('.data', s, remainder(a),
			({ a }) => this.data(a.split(new RegExp(sep)), { ...source, sourceInstruction: '.data' }));
		match('.string', s, string(a),
			({ a }) => this.string(a, source));
		match('.repeat', s, token(a), sep, token(b),
			({ a, b }) => this.data(new Array(this.literal(b, 24, false)).fill(a), { ...source, sourceInstruction: '.repeat' }));
		match('.eq', s, token(a), sep, token(b), ({ a, b }) => this.constant(a, this.literal(b, 12, false)));
		match('.address', s, token(a), ({ a }) => this.address(this.literal(a, 24, false)));
		match('.align', s, token(a), ({ a }) => this.align(this.literal(a, 24, false), source));
		match('.string_encoding', s, token(a), ({ a }) => this.setStringEncoding(a));
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
		if (bits.length !== 24) {
			throw new Error(`Instruction ${instruction.source.realInstruction} is ${bits.length} bits long, but should be 24`);
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

		const offsetMatch = part.value.match(/\(([a-z0-9_-]+)\s*([\+\-])\s*([a-z0-9_-]+)\)/);
		if (offsetMatch) {
			const [base, operator, offset] = offsetMatch.slice(1);

			const baseValue = parseInt(this.resolveParsedLinePart({
				...part,
				bitCount: 24,
				value: base,
			}), 2);
			const offsetValue = parseInt(this.resolveParsedLinePart({
				...part,
				bitCount: 24,
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

class ParvaEmulator implements Emulator {
	memory: Array<number> = [];
	registers: Array<number> = [];
	pc: number;
	cycle: number;
	gpu = {
		cursorX: 0,
		cursorY: 0,
		screen: [] as Array<Array<number>>,
		screenBuffer: [] as Array<Array<number>>,
	};

	constructor() { }

	init(memory: Array<number>) {
		this.memory = memory;
		this.registers = new Array(8).fill(0);
		this.pc = 0;
		this.cycle = 0;

		this.gpu.screen = new Array(48).fill(0).map(() => new Array(64).fill(false));
		this.gpu.screenBuffer = new Array(48).fill(0).map(() => new Array(64).fill(false));
	}

	step() {
		const instruction = this.memory[this.pc] ?? 0;
		const bits = instruction.toString(2).padStart(24, '0');

		// General
		const operationType = bits.slice(0, 2);
		const unsignedImmediate = bits.slice(12, 24);
		const signedImmediate = unsignedImmediate[0] === '1' ? '111111111111' + unsignedImmediate : unsignedImmediate;
		const registerA = bits.slice(5, 9);
		const registerD = bits.slice(9, 12);
		const registerB = bits.slice(12, 15);
		const useImmediate = bits.slice(4, 5) === '0';
		// ALU
		const aluOp = bits.slice(1, 4);
		const specialAluOp = aluOp.slice(0, 2);
		const registerASpecial = bits.slice(3, 4).concat(bits.slice(7, 9));
		// Data
		const useDouble = bits.slice(2, 3);
		const store = bits.slice(3, 4);
		// Branching
		const condition = bits.slice(2, 5);

		if (operationType[0] === '0' && registerA.startsWith('11')) {
			// special ALU
			const valueA = this.getRegister(registerASpecial);
			const valueB = useImmediate ? parseInt(unsignedImmediate, 2) : this.getRegister(registerB);
			let result: number;
			switch (specialAluOp) {
				case '00': result = valueA * valueB; break;
				case '01': result = ((valueA * valueB) / (2 ** 24) | 0); break;
				case '10': result = (valueB === 0 ? -1 : valueA / valueB) | 0; break;
				case '11': result = (valueA % valueB) | 0; break;
			}
			result &= 0xFFFFFF;
			this.registers[parseInt(registerD, 2)] = result;
		} else if (operationType[0] === '0') {
			// normal ALU
			const valueA = this.getRegister(registerA);
			const unsignedValueB = useImmediate ? parseInt(unsignedImmediate, 2) : this.getRegister(registerB);
			const signedValueB = useImmediate ? parseInt(signedImmediate, 2) : this.getRegister(registerB);
			let result: number;
			switch (aluOp) {
				case '000': result = valueA + signedValueB; break;
				case '001': result = signedValueB << 12; break;
				case '010': result = valueA << unsignedValueB; break;
				case '011': result = valueA >>> unsignedValueB; break;
				case '100': result = valueA >> unsignedValueB; break;
				case '101': result = valueA ^ unsignedValueB; break;
				case '110': result = valueA | unsignedValueB; break;
				case '111': result = valueA & unsignedValueB; break;
			}
			result &= 0xFFFFFF;
			this.registers[parseInt(registerD, 2)] = result;
		} else if (operationType === '10') {
			// data
			const valueA = this.getRegister(registerA);
			const valueD0 = this.getRegister(registerD);
			const valueD1 = this.getRegister(registerD.slice(0, 2) + '1');
			const valueB = useImmediate ? parseInt(signedImmediate, 2) : this.getRegister(registerB);
			const address = (valueA + valueB) & 0xffffff;

			if (address >= 512 && address < 0xfff000) {
				console.log(`Memory access out of bounds: instruction ${this.pc.toString(16)}, address ${address.toString(16)}`);
			}

			if (address >= 0xfff000) {
				const device = (address & 0x000c00) >> 10;
				const command = address & 0x0003ff;
				this.ioOut(device, command, valueD0, valueD1);
			} else if (useDouble === '0') {
				if (store === '0') {
					this.registers[parseInt(registerD, 2)] = this.memory[address] ?? 0;
				} else {
					this.memory[address] = valueD0;
				}
			} else {
				if (store === '0') {
					this.registers[parseInt(registerD, 2)] = this.memory[address] ?? 0;
					this.registers[parseInt(registerD, 2) + 1] = this.memory[address + 1] ?? 0;
				} else {
					this.memory[address] = valueD0;
					this.memory[address + 1] = valueD1;
				}
			}
		} else if (operationType === '11') {
			// branching
			const special = condition.startsWith('11');
			const valueA = this.getRegister(registerA);
			const valueB = this.getRegister(registerD);
			const signedA = valueA & 0x800000 ? valueA - 0x1000000 : valueA;
			const signedB = valueB & 0x800000 ? valueB - 0x1000000 : valueB;
			let invertCondition = condition.slice(2, 3) === '1';
			let result: boolean;
			let targetAddress: number = this.pc + parseInt(signedImmediate, 2);

			if (condition.startsWith('11') && registerD === '000') {
				result = signedA < 0;
			} else if (condition === '110' && registerD === '100') {
				result = true;
				targetAddress = valueA + parseInt(signedImmediate, 2);
			} else if (condition === '111' && registerD === '100') {
				// j xB(xA)
				result = true;
				targetAddress = valueA + this.getRegister(registerB);
				invertCondition = false;
			} else if (condition.startsWith('00')) {
				result = valueA === valueB;
			} else if (condition.startsWith('01')) {
				result = valueA < valueB;
			} else if (condition.startsWith('10')) {
				result = signedA < signedB;
			}
			if (invertCondition) {
				result = !result;
			}
			if (result) {
				this.pc = targetAddress - 1;
			}
		}

		this.pc += 1;
		this.pc &= 0xffffff;
		this.cycle += 1;
		this.cycle &= 0xffffff;
	}

	ioOut(device: number, command: number, valueA: number, valueB: number) {
		if (device === 1) {
			// gpu
			const gpuCommand = (command & 0x3c0) >> 6;
			if (gpuCommand === 0) {
				// move cursor
				this.gpu.cursorX = valueA;
				this.gpu.cursorY = valueB;
			} else if (gpuCommand === 2) {
				// draw 6x8 pixels
				const startX = this.gpu.cursorX;
				const startY = this.gpu.cursorY;
				const pixelsTop = valueA;
				const pixelsBottom = valueB;
				for (let yi = 0; yi < 4; yi++) {
					for (let xi = 0; xi < 6; xi++) {
						const x = startX + xi;
						const yTop = startY + yi;
						const yBottom = startY + yi + 4;
						const i = xi + yi * 6;
						const top = (pixelsTop >> (23 - i)) & 1;
						const bottom = (pixelsBottom >> (23 - i)) & 1;
						this.gpu.screenBuffer[yTop][x] = top;
						this.gpu.screenBuffer[yBottom][x] = bottom;
					}
				}
			} else if (gpuCommand === 3) {
				// show buffer
				for (let y = 0; y < 48; y++) {
					for (let x = 0; x < 64; x++) {
						this.gpu.screen[y][x] |= this.gpu.screenBuffer[y][x];
					}
				}
				this.gpu.screenBuffer = new Array(48).fill(0).map(() => new Array(64).fill(0));
			} else if (gpuCommand === 4) {
				// clear screen
				this.gpu.screen = new Array(48).fill(0).map(() => new Array(64).fill(0));
			}
		}
	}

	getRegister(register: string): number {
		const index = parseInt(register, 2);
		return [...this.registers, 0, this.pc, this.cycle, 0xfff000][index] ?? 0;
	}

	printState(): string {
		const registersString = this.registers.map((value, index) => `x${index}: ${value.toString(10).padStart(0, '0')}`).join(', ');
		const registersNote = this.registers.map((value, index) => `x${index}: ${toNote24(value)}`);
		const registersStringNote = registersNote.slice(0, 4).join(', ') + '\n' + registersNote.slice(4).join(', ');
		const screenString = this.gpu.screen.map(row => row.map(value => value ? '█' : ' ').join('')).join('\n');
		return `
			<pre>pc: ${this.pc}, cycle: ${this.cycle}\n${registersString}\n${registersStringNote}</pre>
			<pre style='font-size: 4px; line-height: 1;'>${screenString}</pre>
		`;
	}
}

const syntaxHighlighting = new window['Parser']({
	register: new RegExp(`\\b(?:${Object.keys(REG_MAP).join('|')})\\b`),
	number: /-?0x[\dA-Fa-f_]+|-?\d([\d_]*\.?[\d_]*)|-?0b[01_]+|-?0o[0-7_]+/,
	comment: /#[^\r\n]*|;[^\r\n]*/,
	directive: /\s*\.[a-zA-Z0-9_]+/,
	label: /\s*[a-zA-Z0-9_]+:/,
	string: /'(\\.|[^'\r\n])*'?|"(\\.|[^'\r\n])*"?/,
	instruction: /^\s*[a-zA-Z0-9\.]+/,
	keyword: /(and|as|case|catch|class|const|def|delete|die|do|else|elseif|esac|exit|extends|false|fi|finally|for|foreach|function|global|if|new|null|or|private|protected|public|published|resource|return|self|static|struct|switch|then|this|throw|true|try|var|void|while|xor)(?!\w|=)/,
	variable: /[\$\%\@](\->|\w)+(?!\w)|\${\w*}?/,
	define: /[$A-Z_a-z0-9]+/,
	op: /[\+\-\*\/=<>!]=?|[\(\)\{\}\[\]\.\|]/,
	whitespace: /\s+/,
	other: /\S/,
});

const archSpecification: ArchSpecification = {
	documentation: '',
	syntaxHighlighting,
	assemble,
	maxWordsPerInstruction: 1,
	wordSize: 24,
	emulator: new ParvaEmulator(),
};
export default archSpecification;

archSpecification.documentation = `
# Parva version 0.1

A LittleBigPlanet 3 computer
24-bit CPU @ 30Hz
64x48 pixel display
4 I/O device ports

Search 'Parva' in-game to find the published level

---

# Assembly handbook

The syntax is based on RISC-V

## Registers

Following RISC-V notation, registers may be referred to either by their number or by their name.

Instruction operands named \\\`xA\\\`, \\\`xB\\\`, and \\\`Dx\\\` are always basic registers.
Instruction operands named \\\`xS\\\` may be either basic or special registers.
Instruction operands named \\\`xAA\\\`, \\\`AB\\\`, and \\\`xDD\\\` are always double registers.

### Basic registers

x0/ra | return address
x1/sp | stack pointer
x2/bp | base pointer
x3/s0 | saved register
x4/t0, x5/t1 | temporary registers
x6/a0, x7/a1 | argument registers

### Special registers

zero | always 0
pc | program counter
cycle | cycle counter (increases by 1 every instruction)
upper | always 0xFFF000 (useful for I/O)

### Double registers

x01 | x0 + x1
x23 | x2 + x3
x45 | x4 + x5
x67 | x6 + x7

## Immediates

Instruction operands named \\\`I\\\` must be number literals, labels, or constants.
Literals can be writen in decimal (123), hexadecimal (0x7b), binary (0b1111011), or octal (0o173).
Labels may optionally be enclosed in parentheses and given a relative offset (label, (label + 5), (label - 5)).
Immediate values may be sign-extended or not depending on the instruction.


## ALU instructions

All ALU instructions except \\\`mulu\\\` and \\\`mulhu\\\` also have an immediate variant.
E.g. \\\addi xD, xS, I\\\ | add xS and I, store result in xD
li/addi/subi immediate values are signed and will be sign-extended, others are unsigned

nop | no operation
li xD, I | load I into xD
mv xD, xS | move xS into xD
add xD, xS, xB | add xS and xB, store result in xD
sub xD, xS, xB | subtract xB from xS, store result in xD
sll xD, xS, xB | shift xS left by xB bits, store result in xD
srl xD, xS, xB | shift xS right by xB bits, store result in xD
sra xD, xS, xB | shift xS right by xB bits, sign-extend, store result in xD
xor xD, xS, xB | bitwise XOR xS and xB, store result in xD
or xD, xS, xB | bitwise OR xS and xB, store result in xD
and xD, xS, xB | bitwise AND xS and xB, store result in xD
mulu xD, xA, xB | unsigned multiply xA and xB, store lower 24 bits of result in xD
mulhu xD, xA, xB | unsigned multiply xA and xB, store upper 24 bits of result in xD

## Data instructions

Immediates are signed
When reading/writing double registers, the address MUST be aligned to a multiple of 2

lw xD, I | load word at [I] into xD
lw xD, I(xS) | load word at [xS + I] into xD
sw xD, I | store word in xD at [I]
sw xD, I(xS) | store word in xD at [xS + I]
ld xDD, I | load double at [I] into xDD
ld xDD, I(xS) | load double at [xS + I] into xDD
sd xDD, I | store double in xDD at [I]
sd xDD, I(xS) | store double in xDD at [xS + I]

## Branching instructions

Branch (b) immediates are signed, jump (j) immediates are unsigned

All conditional branching instructions except \\\`bltu\\\` and \\\`bgeu\\\` also have a zero variant.
E.g. beqz xA, I | branch to [pc + I] if xA == 0

beq xA, xB, I | branch to [pc + I] if xA == xB
bne xA, xB, I | branch to [pc + I] if xA != xB
blt xA, xB, I | branch to [pc + I] if xA < xB (signed)
bltu xA, xB, I | branch to [pc + I] if xA < xB (unsigned)
ble xA, xB, I | branch to [pc + I] if xA <= xB (signed)
bleu xA, xB, I | branch to [pc + I] if xA <= xB (unsigned)
bgt xA, xB, I | branch to [pc + I] if xA > xB (signed)
bgtu xA, xB, I | branch to [pc + I] if xA > xB (unsigned)
bge xA, xB, I | branch to [pc + I] if xA >= xB (signed)
bgeu xA, xB, I | branch to [pc + I] if xA >= xB (unsigned)
b I | branch to [pc + I]
j I | jump to [I]
j I(xS) | jump to [xS + I]
j xB(xS) | jump to [xS + xB]
wfi | wait for interrupt (loop forever)


## Assembler directives

&lt;name&gt;: | define a label
.data I I I ... | store data in memory
.repeat I &lt;repetitions&gt; | repeat I in memory multiple times
.address I | set the current address to I
.align I | align the current address to the next multiple of I
.eq &lt;name&gt; I | define a constant
.end | ignore all following instructions
.start | resume assembling instructions

## Memory-mapped I/O

Memory addresses after 0xFFF000 represent I/O. The next bit after 0xFFF is always 0, and the following 2 bits specify the device.
E.g. the memory range 0xFFF400 to 0xFFF5FF accesses I/O device 2
To execute commands or set I/O device memory, write to a device address.
The special register 'upper' (1011) can be used to generate I/O addresses easily.
E.g. sw x0, 0x205(upper) will send the command 0x5 with the argument of x0 to I/O device 1
Commands with one argument can be executed by writing a word.
Commands with two arguments can be executed by writing a double.

### GPU

The GPU is conventionally connected to I/O port 2

sd xAB, 0b010000_000000(upper) | move cursor to X position A and Y position B
sw xAB, 0b010010_000000(upper) | print 6x8 pixels AB to buffer
sw zero, 0b010011_000000(upper) | print buffer to screen
sw zero, 0b010100_000000(upper) | clear screen

### Sound card

The Sound card is conventionally connected to I/O port 3

sd xAB, 0b011000_000000(upper) | play beep with pitch A and length B

---

# Instruction encoding

Instructions are fixed-width and 24 bits long. The following layouts are used:

[ 5, opcode ] [ 4, source register A ] [ 3, dest register ] [ 3, source register B ] [ 9, padding ]
[ 5, opcode ] [ 4, source register A ] [ 3, dest register ] [ 12, unsigned immediate ]
[ 5, opcode ] [ 4, source register A ] [ 3, dest register ] [ 12, signed immediate ]
[ 4, opcode ] [ 1, source register A ] [ 2, ones ] [ 2, source register A ] [ 3, dest register ] [ 12, signed immediate ]

Depending on the instruction, the role of the registers may be swapped around.
All real (non-pseudo) instructions take exactly 1 cycle to execute.


## Registers

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

## ALU instructions (0)

; addi/subi/mulu/mulhu immediate values are signed and will be sign-extended, others are unsigned
; AAAA must be between 0000 and 1011, higher values may change the instruction

00000 AAAA DDD IIIIII IIIIII | addi xD, xA, I
00001 AAAA DDD BBB000 000000 | add xD, xA, xB
00010 AAAA DDD IIIIII IIIIII | subi xD, xA, I
00011 AAAA DDD BBB000 000000 | sub xD, xA, xB
00100 AAAA DDD IIIIII IIIIII | slli xD, xA, I
00101 AAAA DDD BBB000 000000 | sll xD, xA, xB
00110 AAAA DDD IIIIII IIIIII | srli xD, xA, I
00111 AAAA DDD BBB000 000000 | srl xD, xA, xB
01000 AAAA DDD IIIIII IIIIII | srai xD, xA, I
01001 AAAA DDD BBB000 000000 | sra xD, xA, xB
01010 AAAA DDD IIIIII IIIIII | xori xD, xA, I
01011 AAAA DDD BBB000 000000 | xor xD, xA, xB
01010 AAAA DDD IIIIII IIIIII | ori xD, xA, I
01011 AAAA DDD BBB000 000000 | or xD, xA, xB
01110 AAAA DDD IIIIII IIIIII | andi xD, xA, I
01111 AAAA DDD BBB000 000000 | and xD, xA, xB

0001A 11AA DDD BBB000 000000 | mulu xD, xA, xB
0010A 11AA DDD BBB000 000000 | mulhu xD, xA, xB


; Pseudo-instructions

nop => addi x0, x0, 0
li xD, I => addi zero, xD, I
mv xD, xA => addi xD, xA, 0
not xD, xA =>
	xor xD, upper, xA
	xori xD, xA, -1


## Data instructions (10)

; Immediates are signed
; When loading/storing doubles, addresses must be a multiple of 2

10000 AAAA DDD IIIIII IIIIII | lw xD, I(xA)
10010 AAAA DDD IIIIII IIIIII | sw xD, I(xA)
10100 AAAA DDD IIIIII IIIIII | ld xDD, I(xA)
10110 AAAA DDD IIIIII IIIIII | sd xDD, I(xA)

; Pseudo-instructions

lw/sw/ld/sd xD, I => lw/sw/ld/sd xD, I(zero)


## Branching instructions (11)

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

---

# Future

Parva 0.2's instruction set is currently being drafted. It may include the following:

* Variable-length instructions (12-bit, 24-bit, 36-bit, (maaaaybe 48-bit?))
* Removal of subi
* Division
* 24-bit immediate values
* I/O input
* Interrupts

`;
