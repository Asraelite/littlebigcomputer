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
const REGISTER_RE = 'x|y|z|X|Y|Z|YX|yx';

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
		const numbers: Array<ParsedLinePart> = values.map(n => this.value(n, 8, true));
		for (const number of numbers) {
			this.instruction([number], 1, { ...source, realInstruction: '(data)' }, 1);
		}
		return this;
	}

	constant(name: string, value: number) {
		this.constants.set(name, value);
	}

	value(numberOrLabelText: string, bits: number, dynamic: boolean = false): ParsedLinePart {
		if (isNumber(numberOrLabelText)) {
			return toBitString(toNumber(numberOrLabelText), bits, false, 8);
		} else {
			return {
				addressRelative: false,
				sourceAddress: this.currentAddress,
				bitCount: dynamic ? 16 : bits,
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
		const i3 = (...parts: Array<ParsedLinePart>) => {
			this.instruction(parts, 1, source, 3);
		};
		const i4 = (...parts: Array<ParsedLinePart>) => {
			this.instruction(parts, 1, source, 4);
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

		const addr = bindablePattern(VALUE_RE);
		const registerAndA = bindablePattern(REGISTER_RE, '', `${so},${so}A`);
		const valueAndA = bindablePattern(VALUE_RE, '', `${so},${so}A`);
		const x = '[xX]';
		const y = '[yY]';
		const z = '[zZ]';
		const yx = '[yY][xX]';

		match('hlt', () => i('00000000'));
		match('rti', () => i('00000010'));
		match('eni', () => i('00000011'));
		match('dsi', () => i('00000100'));
		match('nop', () => i('00000101'));

		match('rem', s, x, () => i('00001000'));
		match('rem', s, y, () => i('00001001'));
		match('rem', s, z, () => i('00001010'));
		match('clr', () => i('00001011'));

		match('jmp', s, addr(a), ({ a }) => { i3('00010000', this.value(a, 16)) });
		match('jmp', s, addr(a), sep, x, ({ a }) => { i3('00010001', this.value(a, 16)) });
		match('jmp', s, addr(a), sep, y, ({ a }) => { i3('00010010', this.value(a, 16)) });
		match('jmp', s, addr(a), sep, z, ({ a }) => { i3('00010011', this.value(a, 16)) });

		match('jsr', s, addr(a), ({ a }) => { i3('00010100', this.value(a, 16)) });
		match('jsr', s, addr(a), sep, x, ({ a }) => { i3('00010101', this.value(a, 16)) });
		match('jsr', s, addr(a), sep, y, ({ a }) => { i3('00010110', this.value(a, 16)) });
		match('jsr', s, addr(a), sep, z, ({ a }) => { i3('00010111', this.value(a, 16)) });

		match('swp', s, x, sep, y, () => { i('00011000') });
		match('swp', s, y, sep, x, () => pseudo('SWP X, Y'));
		match('swp', s, x, sep, z, () => { i('00011001') });
		match('swp', s, z, sep, x, () => pseudo('SWP X, Z'));
		match('swp', s, y, sep, z, () => { i('00011011') });
		match('swp', s, z, sep, y, () => pseudo('SWP Y, Z'));

		match('jmpez', s, x, sep, addr(a), ({ a }) => { i3('00100000', this.value(a, 16)) });
		match('jmpez', s, z, sep, addr(a), ({ a }) => { i3('00100001', this.value(a, 16)) });
		match('jmpez', s, register(r), sep, addr(a), () => { throw new Error('JMPEZ can only be used with registers X and Z') });
		match('jmpgt', s, x, sep, y, sep, addr(a), ({ a }) => { i3('00100010', this.value(a, 16)) });
		match('jmpgt', s, register(a), sep, register(b), sep, addr(r), () => { throw new Error('JMPGT can only be used with registers X and Y') });
		match('jmpeq', s, x, sep, y, sep, addr(a), ({ a }) => { i3('00100011', this.value(a, 16)) });
		match('jmpeq', s, y, sep, x, sep, addr(a), ({ a }) => pseudo(`JMPEQ X, Y, ${a}`));
		match('jmpeq', s, x, sep, z, sep, addr(a), ({ a }) => { i3('11110010', this.value(a, 16)) });
		match('jmpeq', s, z, sep, x, sep, addr(a), ({ a }) => pseudo(`JMPEQ X, Z, ${a}`));
		match('jmpeq', s, y, sep, z, sep, addr(a), ({ a }) => { i3('11110011', this.value(a, 16)) });
		match('jmpeq', s, z, sep, y, sep, addr(a), ({ a }) => pseudo(`JMPEQ Y, Z, ${a}`));
		match('jmprez', s, addr(a), ({ a }) => { i3('11110000', this.value(a, 16)) });
		match('jmprnz', s, addr(a), ({ a }) => { i3('11110001', this.value(a, 16)) });

		match('jsrez', s, x, sep, addr(a), ({ a }) => { i3('00100100', this.value(a, 16)) });
		match('jsrez', s, z, sep, addr(a), ({ a }) => { i3('00100101', this.value(a, 16)) });
		match('jsrez', s, register(r), sep, addr(a), () => { throw new Error('JSREZ can only be used with registers X and Z') });
		match('jsrgt', s, x, sep, y, sep, addr(a), ({ a }) => { i3('00100110', this.value(a, 16)) });
		match('jsrgt', s, register(a), sep, register(b), sep, () => { throw new Error('JSRGT can only be used with registers X and Y') });
		match('jsreq', s, x, sep, y, sep, addr(a),
			({ a }) => { i3('00100111', this.value(a, 16)) });
		match('jsreq', s, y, sep, x, sep, addr(a), ({ a }) => pseudo(`JSREQ X, Y, ${a}`));
		match('jsreq', s, register(a), sep, register(b), sep, addr(r), () => { throw new Error('JSREQ can only be used with registers X and Y') });

		match('ret', () => i('00000001'));
		match('retrez', () => i('11110100'));
		match('retrnz', () => i('11110101'));

		match('djnz', s, x, sep, addr(a), ({ a }) => i3('11100000', this.value(a, 16)));
		match('djnz', s, y, sep, addr(a), ({ a }) => i3('11100001', this.value(a, 16)));
		match('djnz', s, z, sep, addr(a), ({ a }) => i3('11100010', this.value(a, 16)));

		match('lod', s, x, sep, immediate(a), ({ a }) => i2('01111100', this.value(a, 8)));
		match('lod', s, y, sep, immediate(a), ({ a }) => i2('01111101', this.value(a, 8)));
		match('lod', s, z, sep, immediate(a), ({ a }) => i2('01111110', this.value(a, 8)));
		match('lod', s, y, sep, x, () => i('00101000'));
		match('lod', s, z, sep, x, () => i('00101001'));
		match('lod', s, x, sep, y, () => i('00101010'));
		match('lod', s, z, sep, y, () => i('00101011'));
		match('lod', s, x, sep, z, () => i('00101100'));
		match('lod', s, y, sep, z, () => i('00101101'));

		match('lod', s, x, sep, addr(a), ({ a }) => { i3('10100000', this.value(a, 16)) });
		match('lod', s, y, sep, addr(a), ({ a }) => { i3('10110000', this.value(a, 16)) });
		match('lod', s, z, sep, addr(a), ({ a }) => { i3('11000000', this.value(a, 16)) });
		match('lod', s, x, sep, addr(a), sep, y,
			({ a }) => { i3('10100001', this.value(a, 16)) });
		match('lod', s, x, sep, addr(a), sep, z,
			({ a }) => { i3('10100010', this.value(a, 16)) });
		match('lod', s, y, sep, addr(a), sep, x,
			({ a }) => { i3('10110001', this.value(a, 16)) });
		match('lod', s, y, sep, addr(a), sep, z,
			({ a }) => { i3('10110010', this.value(a, 16)) });
		match('lod', s, z, sep, addr(a), sep, x,
			({ a }) => { i3('11000001', this.value(a, 16)) });
		match('lod', s, z, sep, addr(a), sep, y,
			({ a }) => { i3('11000010', this.value(a, 16)) });

		match('str', s, x, sep, addr(a), ({ a }) => { i3('10100100', this.value(a, 16)) });
		match('str', s, y, sep, addr(a), ({ a }) => { i3('10110100', this.value(a, 16)) });
		match('str', s, z, sep, addr(a), ({ a }) => { i3('11000100', this.value(a, 16)) });
		match('str', s, x, sep, addr(a), sep, y,
			({ a }) => { i3('10100101', this.value(a, 16)) });
		match('str', s, x, sep, addr(a), sep, z,
			({ a }) => { i3('10100110', this.value(a, 16)) });
		match('str', s, y, sep, addr(a), sep, x,
			({ a }) => { i3('10110101', this.value(a, 16)) });
		match('str', s, y, sep, addr(a), sep, z,
			({ a }) => { i3('10110110', this.value(a, 16)) });
		match('str', s, z, sep, addr(a), sep, x,
			({ a }) => { i3('11000101', this.value(a, 16)) });
		match('str', s, z, sep, addr(a), sep, y,
			({ a }) => { i3('11000110', this.value(a, 16)) });

		match('str', s, immediate(a), sep, addr(b), sep, x,
			({ a, b }) => { i4('11010000', this.value(b, 16), this.value(a, 8)) });
		match('str', s, immediate(a), sep, addr(b), sep, y,
			({ a, b }) => { i4('11010001', this.value(b, 16), this.value(a, 8)) });
		match('str', s, immediate(a), sep, addr(b), sep, z,
			({ a, b }) => { i4('11010010', this.value(b, 16), this.value(a, 8)) });
		match('str', s, immediate(a), sep, addr(b),
			({ a, b }) => { i4('11010011', this.value(b, 16), this.value(a, 8)) });
		match('str', s, immediate(a), sep, addr(b), sep, yx,
			({ a, b }) => { i4('11010100', this.value(b, 16), this.value(a, 8)) });

		match('lod', s, z, sep, addr(a), sep, yx,
			({ a }) => { i3('11000011', this.value(a, 16)) });
		match('str', s, z, sep, addr(a), sep, yx,
			({ a }) => { i3('11000111', this.value(a, 16)) });

		match('jmp', s, addr(a), ({ a }) => { i3('00010000', this.value(a, 16)) });

		match('inc', s, x, () => i('00110000'));
		match('inc', s, y, () => i('00110001'));
		match('inc', s, z, () => i('00110010'));
		match('inc', s, addr(a), ({ a }) => i3('00110011', this.value(a, 16)));

		match('dec', s, x, () => i('00110100'));
		match('dec', s, y, () => i('00110101'));
		match('dec', s, z, () => i('00110110'));
		match('dec', s, addr(a), ({ a }) => i3('00110111', this.value(a, 16)));

		match('add', s, x, sep, immediate(a), ({ a }) => i2('01000000', this.value(a, 8)));
		match('add', s, y, sep, immediate(a), ({ a }) => i2('01010000', this.value(a, 8)));
		match('add', s, z, sep, immediate(a), ({ a }) => i2('01100000', this.value(a, 8)));
		// TODO: Check where result is stored and maybe remove the duplicate encodings if needed
		match('add', s, x, sep, y, () => i('01000100'));
		match('add', s, y, sep, x, () => i('01000100'));
		match('add', s, x, sep, z, () => i('01000101'));
		match('add', s, z, sep, x, () => i('01000101'));
		match('add', s, y, sep, z, () => i('01010101'));
		match('add', s, z, sep, y, () => i('01010101'));

		match('sub', s, x, sep, immediate(a), ({ a }) => i2('01000001', this.value(a, 8)));
		match('sub', s, y, sep, immediate(a), ({ a }) => i2('01010001', this.value(a, 8)));
		match('sub', s, z, sep, immediate(a), ({ a }) => i2('01100001', this.value(a, 8)));
		match('sub', s, x, sep, y, () => i('01000110'));
		match('sub', s, x, sep, z, () => i('01000111'));
		match('sub', s, y, sep, x, () => i('01010110'));
		match('sub', s, y, sep, z, () => i('01010111'));
		match('sub', s, z, sep, x, () => i('01100110'));
		match('sub', s, z, sep, y, () => i('01100111'));

		match('mul', s, x, sep, immediate(a), ({ a }) => i2('01000010', this.value(a, 8)));
		match('mul', s, y, sep, immediate(a), ({ a }) => i2('01010010', this.value(a, 8)));
		match('mul', s, z, sep, immediate(a), ({ a }) => i2('01100010', this.value(a, 8)));
		match('mul', s, x, sep, y, () => i('01001000'));
		match('mul', s, y, sep, x, () => i('01001000'));
		match('mul', s, x, sep, z, () => i('01001001'));
		match('mul', s, z, sep, x, () => i('01001001'));
		match('mul', s, y, sep, z, () => i('01011001'));
		match('mul', s, z, sep, y, () => i('01011001'));

		match('div', s, x, sep, immediate(a), ({ a }) => i2('01000011', this.value(a, 8)));
		match('div', s, y, sep, immediate(a), ({ a }) => i2('01010011', this.value(a, 8)));
		match('div', s, z, sep, immediate(a), ({ a }) => i2('01100011', this.value(a, 8)));
		match('div', s, x, sep, y, () => i('01001010'));
		match('div', s, x, sep, z, () => i('01001011'));
		match('div', s, y, sep, x, () => i('01011010'));
		match('div', s, y, sep, z, () => i('01011011'));
		match('div', s, z, sep, x, () => i('01101010'));
		match('div', s, z, sep, y, () => i('01101011'));

		match('mod', s, x, sep, immediate(a), ({ a }) => i2('10011100', this.value(a, 8)));
		match('mod', s, y, sep, immediate(a), ({ a }) => i2('10011101', this.value(a, 8)));
		match('mod', s, z, sep, immediate(a), ({ a }) => i2('10011110', this.value(a, 8)));
		match('mod', s, x, sep, y, () => i('01001100'));
		match('mod', s, x, sep, z, () => i('01001101'));
		match('mod', s, y, sep, x, () => i('01011100'));
		match('mod', s, y, sep, z, () => i('01011101'));
		match('mod', s, z, sep, x, () => i('01101100'));
		match('mod', s, z, sep, y, () => i('01101101'));

		match('lsl', s, x, () => i('01110000'));
		match('lsl', s, y, () => i('01110001'));
		match('lsl', s, z, () => i('01110010'));

		match('lsr', s, x, () => i('01110100'));
		match('lsr', s, y, () => i('01110101'));
		match('lsr', s, z, () => i('01110110'));

		match('not', s, x, () => i('01111000'));
		match('not', s, y, () => i('01111001'));
		match('not', s, z, () => i('01111010'));

		match('and', s, x, sep, immediate(a), ({ a }) => i2('10010000', this.value(a, 8)));
		match('and', s, y, sep, immediate(a), ({ a }) => i2('10010001', this.value(a, 8)));
		match('and', s, z, sep, immediate(a), ({ a }) => i2('10010010', this.value(a, 8)));
		match('and', s, x, sep, y, () => i('10000000'));
		match('and', s, y, sep, x, () => i('10000000'));
		match('and', s, x, sep, z, () => i('10000001'));
		match('and', s, z, sep, x, () => i('10000001'));
		match('and', s, y, sep, z, () => i('10000010'));
		match('and', s, z, sep, y, () => i('10000010'));

		match('xor', s, x, sep, immediate(a), ({ a }) => i2('10011000', this.value(a, 8)));
		match('xor', s, y, sep, immediate(a), ({ a }) => i2('10011001', this.value(a, 8)));
		match('xor', s, z, sep, immediate(a), ({ a }) => i2('10011010', this.value(a, 8)));
		match('xor', s, x, sep, y, () => i('10000100'));
		match('xor', s, y, sep, x, () => i('10000100'));
		match('xor', s, x, sep, z, () => i('10000101'));
		match('xor', s, z, sep, x, () => i('10000101'));
		match('xor', s, y, sep, z, () => i('10000110'));
		match('xor', s, z, sep, y, () => i('10000110'));

		match('or', s, x, sep, immediate(a), ({ a }) => i2('10010100', this.value(a, 8)));
		match('or', s, y, sep, immediate(a), ({ a }) => i2('10010101', this.value(a, 8)));
		match('or', s, z, sep, immediate(a), ({ a }) => i2('10010110', this.value(a, 8)));
		match('or', s, x, sep, y, () => i('10001000'));
		match('or', s, y, sep, x, () => i('10001000'));
		match('or', s, x, sep, z, () => i('10001001'));
		match('or', s, z, sep, x, () => i('10001001'));
		match('or', s, y, sep, z, () => i('10001010'));
		match('or', s, z, sep, y, () => i('10001010'));

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

	resolveParsedLinePart(part: ParsedLinePart, littleEndian: boolean = true): string {
		if (typeof part === 'string') {
			return part;
		} else if (isNumber(part.value)) {
			return toBitString(toNumber(part.value), part.bitCount, part.addressRelative, littleEndian ? 8 : null);
		} else if (this.labels.has(part.value)) {
			const targetLabelAddress = this.labels.get(part.value);
			const value = part.addressRelative ? targetLabelAddress - part.sourceAddress : targetLabelAddress;
			return toBitString(value, part.bitCount, part.addressRelative, littleEndian ? 8 : null);
		}

		const offsetMatch = part.value.match(new RegExp(VALUE_PAIR_RE, 'i'));
		if (offsetMatch) {
			const [base, operator, offset] = offsetMatch.slice(1);

			const baseValue = parseInt(this.resolveParsedLinePart({
				...part,
				value: base,
			}, false), 2,);
			const offsetValue = parseInt(this.resolveParsedLinePart({
				...part,
				addressRelative: false,
				value: offset,
			}, false), 2) * (operator === '+' ? 1 : -1);
			return toBitString(baseValue + offsetValue, part.bitCount, part.addressRelative, littleEndian ? 8 : null);
		}

		if (this.constants.has(part.value)) {
			const value = this.constants.get(part.value);
			return toBitString(value, part.bitCount, false, littleEndian ? 8 : null);
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

	}

	printState(): string {
		return 'Emulator not implemented';
	}
}

const syntaxHighlighting = new window['Parser']({
	whitespace: /\s+/,
	number: /#?(\$-?[\dA-Fa-f_]+|-?(\d+)|%-?[01_]+|@-?[0-7_]+)/,
	comment: /\/\/[^\r\n]*|;[^\r\n]*/,
	directive: /\.[a-zA-Z0-9_]+/,
	label: /[a-zA-Z0-9_]+:/,
	string: /"(\\.|[^"\r\n])*"|'(\\.|[^'\r\n])*'/,
	register: /\b([xyz]|yx)\b/i,
	instruction: /^[a-zA-Z0-9\.]+/,
	other: /\S/,
});

const archSpecification: ArchSpecification = {
	documentation: '',
	syntaxHighlighting,
	assemble,
	maxWordsPerInstruction: 4,
	wordSize: 8,
	emulator: new V8Emulator(),
};
export default archSpecification;

archSpecification.documentation = `
# Bitzzy

An 8-bit CPU by Mazzetip with 16-bit addressing.


## Registers

There are three registers: X, Y, and Z. Z is the accumulator.


## Assembler syntax

Instructions and registers are case-insensitive. For example, \`INC X\` and \`inc x\` are both valid.

Labels and constants are case-sensitive. For example, \`myLabel:\` and \`mylabel:\` are different labels.

Comments begin with a semicolon. For example, \`; this is a comment\`.

Labels can be offset by a value by placing them in parentheses. For example, \`(myLabel + 2)\` is two bytes after \`myLabel\`.

&lt;reg&gt; indicates a register, i.e. X, Y, or Z. For example, the instruction \`INC <reg>\` can be used as \`INC X\`, \`INC Y\`, or \`INC Z\`.

When an instruction takes two registers, they must not be the same. E.g. \`SWP x, y\` is okay but \`SWP x, x\` is illegal.

&lt;imm&gt; indicates an 8-bit immediate value. This must be prefixed with '#' and can be signed or unsigned. For example, \`LOD X, #\$ff\` loads the value -1 into register X.

&lt;addr&gt; indicates a 16-bit address. For example, \`JMP \$fa08\` jumps to address 0xfa08.

When registers X and Y are used together to form a 16-bit address, they are written as YX. Y forms the upper 8 bits while X forms the lower 8 bits.


## Instructions

HLT: Halt the CPU.

RTI: Return from interrupt.

ENI: Enable interrupts.

DSI: Disable interrupts.

NOP: No operation.

REM &lt;reg&gt;: Set register &lt;reg&gt; to the remainder (the carry/borrow flag).

CLR: Clear remainder.

JMP &lt;addr&gt;: Jump to the address &lt;addr&gt;.

JMP &lt;addr&gt;, &lt;reg&gt;: Jump to the address &lt;addr&gt; + register &lt;reg&gt;.

JMPEZ X, &lt;addr&gt;: Jump to the address &lt;addr&gt; if register X is zero.

JMPEZ Z, &lt;addr&gt;: Jump to the address &lt;addr&gt; if register Z is zero.

JMPGT X, Z, &lt;addr&gt;: Jump to the address &lt;addr&gt; if X is greater than Y.

JMPEQ &lt;reg-a&gt;, &lt;reg-b&gt;, &lt;addr&gt;: Jump to the address &lt;addr&gt; if register &lt;reg-a&gt; is equal to register &lt;reg-b&gt;.

JMPRNZ &lt;addr&gt;: Jump to the address &lt;addr&gt; if the remainder is not zero.

JMPREZ &lt;addr&gt;: Jump to the address &lt;addr&gt; if the remainder is zero.

JSR &lt;addr&gt;: Jump to the address &lt;addr&gt; and push the return address onto the stack.

JSR &lt;addr&gt;, &lt;reg&gt;: Jump to the address &lt;addr&gt; + register &lt;reg&gt; and push the return address onto the stack.

JSREZ X, &lt;addr&gt;: Jump to the address &lt;addr&gt; if register X is zero and push the return address onto the stack.

JSREZ Z, &lt;addr&gt;: Jump to the address &lt;addr&gt; if register Z is zero and push the return address onto the stack.

JSRGT X, Z, &lt;addr&gt;: Jump to the address &lt;addr&gt; if X is greater than Y and push the return address onto the stack.

JSREQ &lt;reg-a&gt;, &lt;reg-b&gt;, &lt;addr&gt;: Jump to the address &lt;addr&gt; if register &lt;reg-a&gt; is equal to register &lt;reg-b&gt; and push the return address onto the stack.

DJNZ &lt;reg&gt;, &lt;addr&gt;: Decrement register &lt;reg&gt; and jump to the address &lt;addr&gt; if it is now not zero.

RET: Return from subroutine.

RETRNZ: Return from subroutine if the remainder is not zero.

RETREZ: Jump to the address &lt;addr&gt; if the remainder is zero.

INC &lt;reg&gt;: Increment register &lt;reg&gt;.

INC &lt;addr&gt;: Increment value at address &lt;addr&gt;.

DEC &lt;reg&gt;: Decrement register &lt;reg&gt;.

DEC &lt;addr&gt;: Decrement value at address &lt;addr&gt;.

ADD &lt;reg-a&gt;, &lt;reg-b&gt;: Add register &lt;reg-b&gt; to register &lt;reg-a&gt; and store the result in Z.

ADD &lt;reg&gt;, &lt;imm&gt;: Add the immediate value &lt;imm&gt; to register &lt;reg&gt; and store the result in register &lt;reg&gt;.

SUB &lt;reg-a&gt;, &lt;reg-b&gt;: Subtract register &lt;reg-b&gt; from register &lt;reg-a&gt; and store the result in Z.

SUB &lt;reg&gt;, &lt;imm&gt;: Subtract the immediate value &lt;imm&gt; from register &lt;reg&gt; and store the result in register &lt;reg&gt;.

LSL &lt;reg&gt;: Logical shift left register &lt;reg&gt; by one bit.

LSR &lt;reg&gt;: Logical shift right register &lt;reg&gt; by one bit.

AND &lt;reg-a&gt;, &lt;reg-b&gt;: Bitwise AND register &lt;reg-a&gt; with register &lt;reg-b&gt; and store the result in Z.

AND &lt;reg&gt;, &lt;imm&gt;: Bitwise AND register &lt;reg&gt; with the immediate value &lt;imm&gt; and store the result in register &lt;reg&gt;.

OR &lt;reg-a&gt;, &lt;reg-b&gt;: Bitwise OR register &lt;reg-a&gt; with register &lt;reg-b&gt; and store the result in Z.

OR &lt;reg&gt;, &lt;imm&gt;: Bitwise OR register &lt;reg&gt; with the immediate value &lt;imm&gt; and store the result in register &lt;reg&gt;.

XOR &lt;reg-a&gt;, &lt;reg-b&gt;: Bitwise XOR register &lt;reg-a&gt; with register &lt;reg-b&gt; and store the result in Z.

XOR &lt;reg&gt;, &lt;imm&gt;: Bitwise XOR register &lt;reg&gt; with the immediate value &lt;imm&gt; and store the result in register &lt;reg&gt;.

LOD &lt;reg&gt;, &lt;imm&gt;: Load the immediate value &lt;imm&gt; into register &lt;reg&gt;.

LOD &lt;reg-a&gt;, &lt;reg-b&gt;: Load the value in register &lt;reg-b&gt; into register &lt;reg-a&gt;.

LOD &lt;reg&gt;, &lt;addr&gt;: Load the value at address &lt;addr&gt; into register &lt;reg&gt;.

LOD &lt;reg-a&gt;, &lt;addr&gt;, &lt;reg-b&gt;: Load the value at address &lt;addr&gt; + register &lt;reg-b&gt; into register &lt;reg-a&gt;.

LOD Z, &lt;addr&gt;, YX: Load the value at address &lt;addr&gt; + the combined value of registers X and Y ($YYXX) into register Z.

SWP &lt;reg-a&gt;, &lt;reg-b&gt;: Swap the values in registers &lt;reg-a&gt; and &lt;reg-b&gt;.

STR &lt;reg&gt;, &lt;addr&gt;: Store the value in register &lt;reg&gt; at address &lt;addr&gt;.

STR &lt;reg-a&gt;, &lt;addr&gt;, &lt;reg-b&gt;: Store the value in register &lt;reg-a&gt; at address &lt;addr&gt; + register &lt;reg-b&gt;.

STR &lt;imm&gt;, &lt;addr&gt;: Store the immediate value &lt;imm&gt; to address &lt;addr&gt;.

STR &lt;imm&gt;, &lt;addr&gt;, &lt;reg&gt;: Store the immediate value &lt;imm&gt; to address &lt;addr&gt; + register &lt;reg&gt;.

STR Z, &lt;addr&gt;, YX: Store the value in register Z at address &lt;addr&gt; + the combined value of registers X and Y ($YYXX).

MUL &lt;reg-a&gt;, &lt;reg-b&gt;: Multiply register &lt;reg-a&gt; by register &lt;reg-b&gt; and store the result in in Z.

MUL &lt;reg&gt;, &lt;imm&gt;: Multiply register &lt;reg&gt; by the immediate value &lt;imm&gt; and store the result in register &lt;reg&gt;.

DIV &lt;reg-a&gt;, &lt;reg-b&gt;: Divide register &lt;reg-a&gt; by register &lt;reg-b&gt; and store the result in in Z.

DIV &lt;reg&gt;, &lt;imm&gt;: Divide register &lt;reg&gt; by the immediate value &lt;imm&gt; and store the result in register &lt;reg&gt;.

MOD &lt;reg-a&gt;, &lt;reg-b&gt;: Divide register &lt;reg-a&gt; by register &lt;reg-b&gt; and store the remainder in in Z.

MOD &lt;reg&gt;, &lt;imm&gt;: Divide register &lt;reg&gt; by the immediate value &lt;imm&gt; and store the remainder in register &lt;reg&gt;.


## Assembler directives

\`<name>:\` : Define a label.

\`.data <imm>, <imm>, <imm>, ...\`: Store 8-bit values in memory. You can also use labels, in which case the 16-bit address of the label will be stored.

\`.repeat <imm>, <repetitions>\`: Repeat <imm> in memory multiple times.

\`.address <addr>\`: Set the current address to <addr>.

\`.align <imm>\`: Align the current address to the next multiple of <imm>.

\`.end\`: Ignore all following instructions.

\`.start\`: Resume assembling instructions.

\`.eq\ <name>, <imm>\`: Define a constant.


`;
