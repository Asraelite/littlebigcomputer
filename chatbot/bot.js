import tmi from 'tmi.js';
import { WebSocketServer } from 'ws';

import * as secrets from './secret.js';

const CHECKSUM_SEND_INTERVAL = 8;

// Define configuration options
const opts = {
	options: { debug: false },
	identity: {
		username: secrets.USERNAME,
		password: secrets.ACCESS_TOKEN,
	},
	channels: [secrets.CHANNEL_NAME]
};

// Create a client with our options
const client = new tmi.Client(opts);

client.connect().catch(console.error);

client.on('connected', onConnectedHandler);

function onConnectedHandler(addr, port) {
	console.log(`* Connected to ${addr}:${port}`);

	listen();
}

function listen() {
	const wss = new WebSocketServer({ port: 8090 });

	wss.on('connection', (ws) => {
		let cancelRequested = false;

		ws.on('message', (message) => {
			const payload = JSON.parse(message);
			if (payload.type === 'data') {
				const data = JSON.parse(payload.data);
				console.log(`sending ${data.length} values with inveral ${payload.speed}ms...`);
				write(data, (update) => {
					ws.send(update);
				}, () => cancelRequested, payload.speed);
			} else if (payload.type === 'cancel') {
				cancelRequested = true;
				console.log('cancel requested');
			}
		});
	});
}

// Commands:
// 0: reset checksum
// 1: address low
// 2: address high
// 3: value low; write; increment address
// 4: value high
// 5: checksum low; compare
// 6: checksum high
// 7: unlock address
async function write(data, progressCallback, isCancelRequested, waitIntervalMs) {
	let previousAddress = null;
	let previousVhValue = null;
	let checksum = 0;

	// Reset checksum
	send(0, 0);
	await wait(waitIntervalMs);

	for (const i in data) {
		const remaining = (data.length - i) + (data.length / CHECKSUM_SEND_INTERVAL);
		const eta = remaining * (waitIntervalMs * 2) / 1000;
		progressCallback(JSON.stringify({
			status: 'sending',
			message: `${i}/${data.length} (${(i / data.length * 100).toFixed(1)}%) ETA: ${formatDuration(eta)}`,
			checksum,
		}));

		if (i % CHECKSUM_SEND_INTERVAL === 0 && i != 0) {
			await sendChecksum(checksum, waitIntervalMs);
		}

		const [address, value] = data[i];
		checksum += address + value;
		checksum &= 0xffffff;
		const [al, ah] = [address & 0xfff, address >> 12];
		const [vl, vh] = [value & 0xfff, value >> 12];

		if (address !== previousAddress + 1) {
			send(0, 7); // unlock address
			await wait(waitIntervalMs);
			send(al, 1);
			await wait(waitIntervalMs);
			send(ah, 2);
			await wait(waitIntervalMs);
		}
		previousAddress = address;

		if (vh !== previousVhValue) {
			send(vh, 4);
			await wait(waitIntervalMs);
		}
		previousVhValue = vh;
		send(vl, 3);
		await wait(waitIntervalMs);

		if (isCancelRequested()) {
			console.log('cancelled');
			progressCallback(JSON.stringify({
				status: 'cancelled',
				message: `Cancelled`,
				checksum,
			}));
			return;
		}
	}

	await sendChecksum(checksum, waitIntervalMs);

	progressCallback(JSON.stringify({
		status: 'complete',
		message: `Sent ${data.length} values`,
		checksum,
	}));
}

async function wait(timeMs = 1500) {
	await new Promise(resolve => setTimeout(resolve, timeMs));
}

function send(value, command) {
	// console.log(`sending ${command}: ${value} `);
	say(encode(value, command));
}

async function sendChecksum(checksum, waitIntervalMs) {
	const [cl, ch] = [checksum & 0xfff, checksum >> 12];
	send(ch, 6);
	await wait(waitIntervalMs);
	send(cl, 5);
	await wait(waitIntervalMs);
}

function say(message) {
	client.say(secrets.CHANNEL_NAME, message);
}

function formatDuration(seconds) {
	seconds = Math.ceil(seconds);
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes === 0) {
		return `${remainingSeconds}s`;
	} else {
		return `${minutes}m${remainingSeconds}s`;
	}
}


// 1000: al
// 1001: ah
// 1010: vl
// 1011: vh

function encode(value, command) {
	const aBitCount = 4;
	const bBitCount = 4;
	const cBitCount = 4;
	const dBitCount = 4;

	const valueBitString = value.toString(2).padStart(12, '0');
	const commandBitString = command.toString(2).padStart(4, '0');
	const bitString = commandBitString + valueBitString;

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

	const values = [...Array(a).fill('a'), ...Array(b).fill('b'), ...Array(c).fill('c'), ...Array(d).fill('d'), ...Array(e).fill('e')];
	return values.join(' ');
}
