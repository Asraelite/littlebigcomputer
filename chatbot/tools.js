function encode(value, upper = false, address = false) {
	// const aBitCount = 7;
	// const bBitCount = 7;
	// const cBitCount = 7;
	// const dBitCount = 6;
	const aBitCount = 4;
	const bBitCount = 4;
	const cBitCount = 4;
	const dBitCount = 4;

	const valueBitString = value.toString(2).padStart(12, '0');
	const bitString = '10' + (address ? '0' : '1') + (upper ? '1' : '0') + valueBitString;

	let index = 0;
	const a = parseInt(bitString.slice(0, aBitCount), 2);
	index += aBitCount;
	const b = parseInt(bitString.slice(index, index + bBitCount), 2);
	index += bBitCount;
	const c = parseInt(bitString.slice(index, index + cBitCount), 2);
	index += cBitCount;
	const d = parseInt(bitString.slice(index, index + dBitCount), 2);
	index += dBitCount;

	const maxTotal = 2 ** aBitCount + 2 ** bBitCount + 2 ** cBitCount + 2 ** dBitCount;
	const e = maxTotal - (a + b + c + d);

	console.log(bitString);
	console.log(a, b, c, d, e);

	const values = [...Array(a).fill('a'), ...Array(b).fill('b'), ...Array(c).fill('c'), ...Array(d).fill('d'), ...Array(e).fill('e')];
	return values.join(' ');
}
