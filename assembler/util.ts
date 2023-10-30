export function toBitString(n: number, bits: number, signed: boolean = false): string {
	const minimum = -(2 ** (bits - 1));
	const maximum = signed ? (2 ** (bits - 1)) - 1 : 2 ** bits - 1;

	if (n < minimum || n > maximum) {
		throw new Error(`Value ${n} out of range for ${bits}-bit ${signed ? 'signed' : 'unsigned'} integer`);
	}

	if (n < 0) {
		n = (2 ** bits) + n;
	}

	let result = '';
	for (let i = 0; i < bits; i++) {
		result = (n & 1) + result;
		n >>= 1;
	}
	if (n !== 0) {
		throw new Error(`Internal error: ${n} not zero after conversion to ${bits}-bit ${signed ? 'signed' : 'unsigned'} integer`);
	}
	return result;
}

export function toNote(n: number, bits: number): string {
	if (bits <= 19) {
		return `${n}`;
	} else {
		const scaling = 2 ** (bits - 19);
		return `${(n / scaling).toFixed(5)} x${scaling}`
	}
}

export function toNote24(n: number): string {
	return toNote(n, 24);
}

export function toNote8(n: number): string {
	return toNote(n, 8);
}

