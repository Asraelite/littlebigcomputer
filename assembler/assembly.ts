export type Offset = string | number;
export type Value = string | number;
export type Resolvable = string | LabelReference;
export type LabelReference = {
	tag: 'label';
	type: 'relative' | 'absolute';
	address: number;
	name: string;
};

export type ArchSpecification = {
	syntaxHighlighting: any; // : Parser,  TODO
	assemble: Assemble;
	wordSize: number;
	maxWordsPerInstruction: number;
	documentation: string;
	emulator: null | Emulator;
};

export interface Emulator {
	pc: number;
	init: (memory: Array<number>) => void;
	step: () => void;
	printState: () => string;
}

export type LineSource = {
	lineNumber: number;
	realInstruction: string;
	sourceInstruction: string;
	sourceInstructionCommented: string;
};

export type AssemblyInput = {
	source: string;
};

export type InputError = {
	line: number;
	message: string;
}

export type AssemblyOutput = {
	lines: Array<OutputLine>;
	errors: Array<InputError>;
	message: string;
};

export type OutputLine = InstructionOutputLine | LabelOutputLine;

export type InstructionOutputLine = {
	tag: 'instruction';
	address: number;
	bits: string;
	source: LineSource;
};
export type LabelOutputLine = { tag: 'label', name: string };

export type Assemble = (program: AssemblyInput) => AssemblyOutput;

export const Parser = window['Parser']; // TODO

export type ArchName = 'v8' | 'parva_0_1';
