type Span = {
	start: [number, number];
	end: [number, number];
	text: string;
};

type Context = {

};

type Token = {
	tag: 'opcode' | 'label' | 'string' | 'number' | 'register' | 'comment' | 'whitespace' | 'newline' | ''
	source: Span
};

type Parser = (s: string, context: Context) => [Array<Token>, string] | null;

const literal = (stringLiteral) => (s, context) => s.startsWith(stringLiteral) ? [{
	tag: 'literal',
	source: {
		start: context.position,
		end: [context.position[0], context.position[1] + stringLiteral.length],
		text: stringLiteral
	}
}, s.slice(stringLiteral.length)] : null;
const wordBoundary = (s, context) => s.startsWith(' ') ? [{tag: 'whitespace', source: {start: context.position, end: [context.position[0], context.position[1] + 1], text: ' '}}, s.slice(1)] : null;

// const add: Parser = (s, context) => {
// 	seq(reg4, reg3, reg).then((d, a, b) => {
// 		return [{
// 			tag: 'aluInstruction',

// 		}];
// 	});


// 	return null;
// };

export function parse(text: string) {

}


