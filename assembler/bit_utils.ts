const EPSILON = 2 ** (-24);

class Analog {
	value: Float32Array;
	private constructor(value: number) {
		this.value = new Float32Array(1);
		this.value[0] = Math.max(Math.min(value, 1), -1);
	}

	static fromRaw(value: number): Analog {
		return new Analog(value);
	}

	static fromEpsilon(value: number): Analog {
		return new Analog(EPSILON * value);
	}

	asInternal(): string {
		const view = new DataView(this.value.buffer);
		const int = view.getUint32(0, true);
		const bits = int.toString(2).padStart(32, '0');
		const sign = bits[0];
		const exponent = bits.slice(1, 9);
		const mantissa = bits.slice(9);
		return `${sign} ${exponent} ${mantissa}`;
	}

	rawValue(): number {
		return this.value[0];
	}

	asBinary(sectionSize: number = 24, showFraction = true): string {
		if (this.value[0] >= 1) {
			return '>=1';
		}
		const sign = this.value[0] < 0 ? '-' : ' ';
		const number = Math.abs(this.value[0]) * (2 ** 24);
		const bits = (number | 0).toString(2).padStart(24, '0');
		const fraction = (number - (number | 0));
		const fractionBits = (fraction * (2 ** 24) | 0).toString(2).padStart(24, '0');
		const parts = bits.match(new RegExp(`.{1,${sectionSize}}`, 'g'))!;
		if (showFraction) {
			parts.push('.', ...fractionBits.match(/.{1,6}/g)!);
		}
		return `${sign}${parts.join(' ')}`;
	}

	asHex(): string {
		const number = Math.abs(this.value[0]) * (2 ** 24);
		const hex = (number | 0).toString(16).padStart(6, '0');
		return `0x${hex}`;
	}

	asNote(): string {
		const max = (2 ** 19);
		const result = this.value[0] * max;
		return `${result.toFixed(5)} x32`;
	}

	asEpsilon(): number {
		return this.value[0] / EPSILON;
	}

	get v() {
		return this.rawValue();
	}

	get i() {
		return this.asInternal();
	}

	get b() {
		return this.asBinary();
	}

	get bs() {
		return this.asBinary(6);
	}

	get b8() {
		return this.asBinary(8);
	}

	get bh() {
		return this.asBinary(6, false);
	}

	get h() {
		return this.asHex();
	}

	get n() {
		return this.asNote();
	}

	get e() {
		return this.asEpsilon();
	}
}

function int24(value: number): Analog {
	return Analog.fromEpsilon(value);
}

function raw(value: number): Analog {
	return Analog.fromRaw(value);
}

function rand(): Analog {
	return Analog.fromEpsilon((Math.random() * (2 ** 24)) | 0);
}

function battery(percentage: number): Analog {
	return Analog.fromRaw(percentage / 100);
}

function add(...values: Array<Analog>): Analog {
	if (values.length === 1) return values[0];
	const result = values[0].value[0] + values[1].value[0];
	return add(Analog.fromRaw(result), ...values.slice(2));
}

function addOverflowing(a: Analog, b: Analog): [Analog, Analog] {
	let result = a.v + b.v;
	let carry = 0;
	if (result > 1) {
		carry = 1;
		result -= 1;
	}
	return [Analog.fromRaw(result), Analog.fromRaw(carry)];
}

function sub(first: Analog, ...values: Array<Analog>): Analog {
	if (values.length === 0) return first;
	const result = first.value[0] - values[0].value[0];
	return sub(Analog.fromRaw(result), ...values.slice(1));
}

function compare(first: Analog, second: Analog): Analog {
	if (Math.abs(first.value[0]) >= Math.abs(second.value[0])) {
		return first;
	} else {
		return second;
	}
}

function mul(first: Analog, ...values: Array<Analog>): Analog {
	if (values.length === 0) return first;
	const result = first.value[0] * values[0].value[0];
	return mul(Analog.fromRaw(result), ...values.slice(1));
}

function mulRaw(first: Analog, ...values: Array<Analog>): Analog {
	if (values.length === 0) return first;
	const result = first.value[0] * values[0].value[0];
	return mul(Analog.fromRaw(result), ...values.slice(1));
}

function recip(x: number): Analog {
	const value = ((2 ** 25) / x + 1) & 0xffffff;
	return int24(value);
}

function not(first: Analog): Analog {
	const result = 1.0 - first.value[0];
	return Analog.fromRaw(result);
}

function raise(value: Analog, inputs: number, repetitions: number): Analog {
	let result = value;
	for (let i = 0; i < repetitions; i++) {
		result = add(...Array(inputs).fill(result));
	}
	return result;
}

function lower(value: Analog, repetitions: number): Analog {
	let result = value;
	for (let i = 0; i < repetitions; i++) {
		result = mul(result, battery(50));
	}
	return result;
}

function exactlyEquals(first: Analog, second: Analog): boolean {
	return first.value[0] === second.value[0];
}

function topBit(value: Analog): boolean {
	return value.value[0] >= 0.5;
}

function truncate(value: Analog, keepBits: number): Analog {
	const truncated = value.asEpsilon() & (((2 ** keepBits) - 1) << (24 - keepBits));
	return Analog.fromEpsilon(truncated);
}

function negate(value: Analog): Analog {
	return mul(value, battery(-100));
}

function split(value: Analog, raise = true): [Analog, Analog] {
	let bottom = value.asEpsilon() & ((2 ** 12) - 1);
	if (raise) bottom *= (2 ** 12)
	return [truncate(value, 12), Analog.fromEpsilon(bottom)];
}

function rshift(value: Analog, shift: number): Analog {
	return lower(value, shift);
}

function lshift(value: Analog, shift: number): Analog {
	return raise(value, 2, shift);
}

export function expose() {
	window['int24'] = int24;
	window['i'] = int24;
	window['raw'] = raw;
	window['rand'] = rand;
	window['battery'] = battery;
	window['b'] = battery;
	window['add'] = add;
	window['addOverflowing'] = addOverflowing;
	window['sub'] = sub;
	window['compare'] = compare;
	window['mul'] = mul;
	window['mulRaw'] = mulRaw;
	window['recip'] = recip;
	window['not'] = not;
	window['raise'] = raise;
	window['lower'] = lower;
	window['exactlyEquals'] = exactlyEquals;
	window['topBit'] = topBit;
	window['truncate'] = truncate;
	window['negate'] = negate;
	window['split'] = split;
	window['rshift'] = rshift;
	window['lshift'] = lshift;
}

export function run() {
	// setTimeout(() => location.reload(), 2000);

	for (let i = 0; i < 1; i++) {
		const a = int24(0xffffff);
		const b = int24(0xffffff);
		// const a = rand();
		// const b = rand();
		if (!calc(a, b)) {
			console.log('failed', a.e, b.e);
		}
	}
}

function calc(a: Analog, b: Analog): boolean {
	const aVal = a.e;
	const bVal = b.e;
	const productBigInt = BigInt(aVal) * BigInt(bVal);
	const expectedHigh = int24(Number((productBigInt >> 24n) & 0xffffffn));
	const expectedLow = int24(Number(productBigInt & 0xffffffn));

	print('multiply', a.bs, b.bs, expectedHigh.asBinary(6, false) + ' /' + expectedLow.asBinary(6, false), `${a.e} * ${b.e} = ${a.e * b.e}`);

	const [ah, al] = split(a);
	const [bh, bl] = split(b);

	print('split', ah.bh, al.bh, bh.bh, bl.bh);

	const high = mul(ah, bh);
	const middle1 = mul(ah, bl);
	const middle2 = mul(al, bh);
	const low = mul(al, bl);
	let [middle, middleCarry] = addOverflowing(middle1, middle2);
	let [middleHigh, middleLow] = split(middle);
	middleHigh = rshift(middleHigh, 12);
	middleCarry = rshift(middleCarry, 12);

	print('middle1', middle1.bh);
	print('middle2', middle2.bh);

	print('high', high.bh);
	print('middle', middleHigh.bh, middleLow.bh, middleCarry.bh);
	print('low', high.bh);

	const [lowSum, lowCarry] = addOverflowing(low, middleLow);
	print('lowCarry', lowCarry.bh);
	const highSum = add(high, middleHigh, middleCarry, rshift(lowCarry, 24));

	const resultValue = (BigInt(highSum.e) * (2n ** 24n)) + BigInt(lowSum.e);

	print('result', highSum.bs, lowSum.bs, highSum.bh + ' /' + lowSum.bh, resultValue, productBigInt);
	return resultValue === productBigInt;
}

function print(...values: Array<any>) {
	console.log(values.join('\n') + '\n');
}
