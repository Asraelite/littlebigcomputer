import * as bitUtils from './bit_utils.js';

import targetV8 from './targets/v8.js';
import targetParva_0_1 from './targets/parva_0_1.js';
import targetBitzzy from './targets/bitzzy.js';
import targetLodestar from './targets/lodestar.js';
import * as targetTest from './targets/test/test.js';
import { ArchName, ArchSpecification, AssemblyInput, AssemblyOutput, InstructionOutputLine } from './assembly.js';
import { toNote } from './util.js';

const CONFIG_VERSION: string = '1';
const EMULATOR_SPEED = 70;

window.addEventListener('load', init);

let assemblyInput: HTMLTextAreaElement;
let machineCodeOutput: HTMLPreElement;
let assemblyStatusOutput: HTMLSpanElement;

let emulatorOutput: HTMLDivElement;
let emulatorResetButton: HTMLButtonElement;
let emulatorStepButton: HTMLButtonElement;
let emulatorStep10Button: HTMLButtonElement;
let emulatorRunButton: HTMLButtonElement;

let controlSendButton: HTMLButtonElement;
let controlSendCancelButton: HTMLButtonElement;
let controlSendStatus: HTMLPreElement;
let controlSendStartInput: HTMLInputElement;;

let textDecorator: any;
let showDocs: boolean = false;
let emulatorRunning: boolean = false;
let emulatorBreakpoints: Set<number> = new Set();

let targetArch: ArchSpecification;
let assemblyOutput: AssemblyOutput;

let lastInputReceivedTime = 0;

let configuration: Configuration;

type OutputFormat = 'binary' | 'hex' | 'note' | 'decimal' | 'none';

type ConfigurationSpecification = {
	version: typeof CONFIG_VERSION;

	targetArch: ArchName;
	assemblyOutputFormat: OutputFormat;
	machineCodeOutputFormat: OutputFormat;
	machineCodeShowLabels: boolean;
	syntaxHighlighting: string;
	inlineSourceFormat: string;
	rawOutput: boolean;
	focusEmulator: boolean;
	sendDelay: number;
};

class Configuration {
	machineCodeOutputFormat: OutputFormat;
	addressOutputFormat: OutputFormat;
	machineCodeShowLabels: boolean;
	targetArch: ArchName;
	syntaxHighlighting: string;
	inlineSourceFormat: string;
	rawOutput: boolean;
	focusEmulator: boolean;
	sendDelay: number;

	private formElement: HTMLFormElement;
	private outputFormatSelect: HTMLSelectElement;
	private addressFormatSelect: HTMLSelectElement;
	private labelsCheckbox: HTMLInputElement;
	private inlineSourceSelect: HTMLSelectElement;
	private targetArchSelect: HTMLSelectElement;
	private targetArchDocsButton: HTMLButtonElement;
	private syntaxHighlightingSelect: HTMLSelectElement;
	private rawOutputCheckbox: HTMLInputElement;
	private focusEmulatorCheckbox: HTMLInputElement;
	private sendDelayInput: HTMLInputElement;

	constructor() {
		this.formElement = document.querySelector('#controls form') as HTMLFormElement;
		this.outputFormatSelect = document.getElementById('config-output-format-select') as HTMLSelectElement;
		this.addressFormatSelect = document.getElementById('config-address-format-select') as HTMLSelectElement;
		this.labelsCheckbox = document.getElementById('config-labels-input') as HTMLInputElement;
		this.inlineSourceSelect = document.getElementById('config-source-select') as HTMLSelectElement;
		this.targetArchSelect = document.getElementById('config-target-arch-select') as HTMLSelectElement;
		this.targetArchDocsButton = document.getElementById('config-target-arch-docs-button') as HTMLButtonElement;
		this.syntaxHighlightingSelect = document.getElementById('config-syntax-highlighting-select') as HTMLSelectElement;
		this.rawOutputCheckbox = document.getElementById('config-raw-output-input') as HTMLInputElement;
		this.focusEmulatorCheckbox = document.getElementById('config-focus-emulator-input') as HTMLInputElement;
		this.sendDelayInput = document.getElementById('control-send-speed') as HTMLInputElement;

		this.formElement.addEventListener('change', () => {
			this.update();
			updateOutput();
		});

		this.sendDelayInput.addEventListener('change', () => this.update());

		this.targetArchDocsButton.addEventListener('click', () => {
			showDocs = !showDocs;
			this.targetArchDocsButton.innerText = showDocs ? 'Show assembly' : 'Show docs';
			updateOutput();
		});

		// TODO
		// Add change event listeners
	}

	update() {
		if (this.targetArch !== this.targetArchSelect.value) {
			updateTargetArch(this.targetArchSelect.value as ArchName);
		}
		this.targetArch = this.targetArchSelect.value as ArchName;
		this.syntaxHighlighting = this.syntaxHighlightingSelect.value;
		this.machineCodeOutputFormat = this.outputFormatSelect.value as OutputFormat;
		this.addressOutputFormat = this.addressFormatSelect.value as OutputFormat;
		this.machineCodeShowLabels = this.labelsCheckbox.checked;
		this.inlineSourceFormat = this.inlineSourceSelect.value;
		this.rawOutput = this.rawOutputCheckbox.checked;
		this.focusEmulator = this.focusEmulatorCheckbox.checked;
		this.sendDelay = parseInt(this.sendDelayInput.value);

		document.getElementById('assembly').className = `theme-${this.syntaxHighlighting}`;

		if (this.focusEmulator) {
			document.getElementById('page').classList.add('emulator');
		} else {
			document.getElementById('page').classList.remove('emulator');
		}

		this.saveToLocalStorage();
	}

	static fromLocalStorage() {
		const configuration = new Configuration();
		const configurationStorageItem = localStorage.getItem('configuration');

		if (configurationStorageItem !== null) {
			const parsed: ConfigurationSpecification = JSON.parse(configurationStorageItem);

			if (parsed.version !== CONFIG_VERSION) {
				console.warn(`Saved configuration version mismatch: found ${parsed.version}, expected ${CONFIG_VERSION}`);
				localStorage.removeItem('configuration');
			} else {
				configuration.addressOutputFormat = parsed.assemblyOutputFormat;
				configuration.machineCodeOutputFormat = parsed.machineCodeOutputFormat;
				configuration.machineCodeShowLabels = parsed.machineCodeShowLabels;
				configuration.targetArch = parsed.targetArch;
				configuration.syntaxHighlighting = parsed.syntaxHighlighting;
				configuration.inlineSourceFormat = parsed.inlineSourceFormat;
				configuration.focusEmulator = parsed.focusEmulator;
				configuration.rawOutput = parsed.rawOutput;
				configuration.sendDelay = parsed.sendDelay;

				configuration.outputFormatSelect.value = configuration.machineCodeOutputFormat;
				configuration.addressFormatSelect.value = configuration.addressOutputFormat;
				configuration.labelsCheckbox.checked = configuration.machineCodeShowLabels;
				configuration.targetArchSelect.value = configuration.targetArch;
				configuration.syntaxHighlightingSelect.value = configuration.syntaxHighlighting;
				configuration.inlineSourceSelect.value = configuration.inlineSourceFormat;
				configuration.rawOutputCheckbox.checked = configuration.rawOutput;
				configuration.focusEmulatorCheckbox.checked = configuration.focusEmulator;
				configuration.sendDelayInput.value = configuration.sendDelay.toString();
			}
		}

		configuration.update();
		updateTargetArch(configuration.targetArch);

		return configuration;
	}

	saveToLocalStorage() {
		const values: ConfigurationSpecification = {
			version: CONFIG_VERSION,
			targetArch: this.targetArch,
			assemblyOutputFormat: this.addressOutputFormat,
			machineCodeOutputFormat: this.machineCodeOutputFormat,
			machineCodeShowLabels: this.machineCodeShowLabels,
			inlineSourceFormat: this.inlineSourceFormat,
			syntaxHighlighting: this.syntaxHighlighting,
			rawOutput: this.rawOutput,
			focusEmulator: this.focusEmulator,
			sendDelay: this.sendDelay,
		};
		localStorage.setItem('configuration', JSON.stringify(values));
	}
}

function getArch(name: string): ArchSpecification {
	if (name === 'v8') {
		return targetV8;
	} else if (name === 'parva_0_1') {
		return targetParva_0_1;
	} else if (name === 'bitzzy') {
		return targetBitzzy;
	} else if (name === 'lodestar') {
		return targetLodestar as any;
	} else {
		throw new Error('Unknown architecture \'' + name + '\'');
	}
}

function init() {
	assemblyInput = document.getElementById('assembly-input') as HTMLTextAreaElement;
	assemblyStatusOutput = document.getElementById('assembly-status') as HTMLSpanElement;
	machineCodeOutput = document.getElementById('machine-code-text') as HTMLPreElement;

	controlSendButton = document.getElementById('control-send-button') as HTMLButtonElement;
	controlSendCancelButton = document.getElementById('control-send-cancel-button') as HTMLButtonElement;
	controlSendStatus = document.getElementById('control-send-status') as HTMLPreElement;
	controlSendStartInput = document.getElementById('control-send-start') as HTMLInputElement;
	controlSendButton.addEventListener('click', sendToLbp);

	emulatorOutput = document.getElementById('emulator-output') as HTMLDivElement;
	emulatorResetButton = document.getElementById('emulator-control-reset') as HTMLButtonElement;
	emulatorStepButton = document.getElementById('emulator-control-step') as HTMLButtonElement;
	emulatorStep10Button = document.getElementById('emulator-control-step-10') as HTMLButtonElement;
	emulatorRunButton = document.getElementById('emulator-control-run') as HTMLButtonElement;

	emulatorResetButton.addEventListener('click', () => {
		const memory = [];
		for (const line of assemblyOutput.lines) {
			if (line.tag === 'instruction') {
				const bytes = line.bits.match(new RegExp(`.{1,${targetArch.wordSize}}`, 'g'))!;
				for (let i = 0; i < bytes.length; i++) {
					memory[line.address + i] = parseInt(bytes[i], 2);
				}
			}
		}
		targetArch.emulator?.init(memory);
		updateEmulatorOutput();
	});
	emulatorStepButton.addEventListener('click', () => {
		targetArch.emulator?.step();
		updateEmulatorOutput();
	});
	emulatorStep10Button.addEventListener('click', () => {
		for (let i = 0; i < 10; i++) {
			targetArch.emulator?.step();
		}
		updateEmulatorOutput();
	});
	emulatorRunButton.addEventListener('click', () => {
		if (emulatorRunning) {
			emulatorRunning = false;
			emulatorRunButton.innerText = 'Run';
			return;
		}
		emulatorRunning = true;
		emulatorRunButton.innerText = 'Stop';
		const run = async () => {
			let nextStepTime = null;
			while (true) {
				if (!emulatorRunning) {
					nextStepTime = null;
					await new Promise(resolve => setTimeout(resolve, 100));
					break;
				} else if (nextStepTime === null) {
					nextStepTime = Date.now();
				}

				while (Date.now() >= nextStepTime) {
					targetArch.emulator?.step();
					nextStepTime += 1000 / EMULATOR_SPEED;

					if (emulatorBreakpoints.has(targetArch.emulator?.pc)) {
						emulatorRunning = false;
						emulatorRunButton.innerText = 'Run';
						break;
					}
				}

				updateOutput();
				await new Promise(resolve => setTimeout(resolve, nextStepTime - Date.now()));
			}
		};
		run();
	});

	bitUtils.expose();

	assemblyInput.value = localStorage.getItem('assembly') ?? '';

	var textarea = document.getElementById('assembly-input') as HTMLTextAreaElement;
	textDecorator = new window['TextareaDecorator'](textarea, new window['Parser']({}));

	configuration = Configuration.fromLocalStorage();

	updateOutput();

	assemblyInput.addEventListener('input', () => {
		lastInputReceivedTime = Date.now();
		setTimeout(() => {
			if (Date.now() - lastInputReceivedTime > 300) {
				localStorage.setItem('assembly', assemblyInput.value);
				updateOutput();
			}
		}, 500);
	});

	assemblyInput.addEventListener('keydown', function (event) {
		if (event.key == 'Tab') {
			event.preventDefault();
			var start = this.selectionStart;
			var end = this.selectionEnd;

			this.value = this.value.substring(0, start) +
				"\t" + this.value.substring(end);

			this.selectionStart =
				this.selectionEnd = start + 1;
			textDecorator.update();
		}
	});

	// ---
	// Tests
	// ---

	targetTest.runTests();
}

function updateTargetArch(name: ArchName) {
	targetArch = getArch(name);

	window['emulator'] = targetArch?.emulator;

	const parser = targetArch.syntaxHighlighting;
	textDecorator.parser = parser;
	textDecorator.update();
	// get the textarea
	// wait for the page to finish loading before accessing the DOM
}

function updateEmulatorOutput() {
	emulatorOutput.innerHTML = targetArch.emulator?.printState() ?? '';

	for (const line of Array.from(machineCodeOutput.querySelectorAll('pre.line'))) {
		const address = parseInt(line.getAttribute('data-address')!);
		if (targetArch.emulator?.pc === address) {
			line.classList.add('current');
		} else {
			line.classList.remove('current');
		}
	}

}

function updateOutput() {

	if (showDocs) {
		machineCodeOutput.innerHTML = '';
		const element = document.createElement('div');
		element.innerHTML = window['marked'].parse(targetArch.documentation, { breaks: true });
		machineCodeOutput.appendChild(element);
		return;
	}

	const input: AssemblyInput = {
		source: assemblyInput.value,
	};

	assemblyOutput = targetArch.assemble(input);
	const errorMap = {};
	for (const error of assemblyOutput.errors) {
		errorMap[error.line] = [...(errorMap[error.line] ?? []), error.message];
	}
	textDecorator.setErrorMap(errorMap);

	assemblyStatusOutput.innerText = assemblyOutput.errors.map(e => `Line ${e.line + 1}: ${e.message}`).join('\n');

	const outputFormat = configuration.machineCodeOutputFormat
	const addressFormat = configuration.addressOutputFormat;
	const sourceFormat = configuration.inlineSourceFormat;

	machineCodeOutput.innerHTML = '';

	for (const line of assemblyOutput.lines) {
		if (line.tag === 'label') {
			if (configuration.machineCodeShowLabels) {
				if (configuration.rawOutput) {
					machineCodeOutput.innerText += `${line.name}:\n`;
				} else {
					const element = document.createElement('pre');
					element.classList.add('label');
					element.innerText = `${line.name}:`;
					machineCodeOutput.appendChild(element);
				}

			}
			continue;
		}

		const binary = line.bits;
		const binaryValue = parseInt(binary, 2);
		const address = line.address;
		const maximumBitCount = targetArch.maxWordsPerInstruction * targetArch.wordSize;

		let lineRepresentation = '';
		if (outputFormat === 'binary') {
			const maximumStringLength = (maximumBitCount / 8) * 9;
			const binaryString = binary.match(/.{1,8}/g)!.map(s => parseInt(s, 2).toString(2).padStart(8, '0')).join(' ');
			lineRepresentation = binaryString.padEnd(maximumStringLength + 2, ' ');
		} else if (outputFormat === 'hex') {
			const maximumStringLength = (maximumBitCount / 8) * 3;
			const hexString = binary.match(/.{1,8}/g)!.map(s => parseInt(s, 2).toString(16).padStart(2, '0')).join(' ');
			lineRepresentation = hexString.padEnd(maximumStringLength + 2, ' ');
		} else if (outputFormat === 'note') {
			lineRepresentation = toNote(binaryValue, targetArch.wordSize).padStart(16, ' ');
		} else if (outputFormat === 'decimal') {
			const maximumStringLength = (maximumBitCount / 3);
			const decimalString = binary.match(new RegExp(`.{1,${targetArch.wordSize}}`, 'g'))!
				.map(s => parseInt(s, 2).toString(10).padStart(8, ' ')).join(' ');
			lineRepresentation = decimalString.padEnd(maximumStringLength, ' ');
		}

		let addressRepresentation = '';
		if (addressFormat === 'binary') {
			addressRepresentation = address.toString(2).padStart(16, '0');
		} else if (addressFormat === 'hex') {
			addressRepresentation = address.toString(16).padStart(2, '0').padStart(4, ' ');
		} else if (addressFormat === 'note') {
			addressRepresentation = toNote(address, targetArch.wordSize).padStart(14, ' ');
		} else if (addressFormat === 'decimal') {
			addressRepresentation = address.toString(10).padStart(3, ' ');
		} else if (addressFormat === 'none') {
			addressRepresentation = '';
		}

		if (addressFormat !== 'none') {
			addressRepresentation += ': ';
		}

		let sourceRepresentation = '';
		if (sourceFormat === 'instruction') {
			sourceRepresentation = '; ' + line.source.realInstruction;
		} else if (sourceFormat === 'source') {
			sourceRepresentation = '; ' + line.source.sourceInstruction;
		} else if (sourceFormat === 'comments') {
			sourceRepresentation = '; ' + line.source.sourceInstructionCommented;
		}

		if (configuration.rawOutput) {
			machineCodeOutput.innerText += `${addressRepresentation}${lineRepresentation} ${sourceRepresentation}\n`;
		} else {
			const lineElement = document.createElement('pre');
			lineElement.classList.add('line');
			const addressElement = document.createElement('span');
			const outputElement = document.createElement('span');
			const sourceElement = document.createElement('span');
			addressElement.innerText = `${addressRepresentation}`;
			addressElement.classList.add('address');
			outputElement.innerText = `${lineRepresentation}`;
			outputElement.classList.add('binary');
			sourceElement.innerText = `${sourceRepresentation}`;
			sourceElement.classList.add('source');

			lineElement.appendChild(addressElement);
			lineElement.appendChild(outputElement);
			lineElement.appendChild(sourceElement);

			addressElement.addEventListener('click', () => {
				if (emulatorBreakpoints.has(address)) {
					emulatorBreakpoints.delete(address);
					lineElement.classList.remove('breakpoint');
				} else {
					emulatorBreakpoints.add(address);
					lineElement.classList.add('breakpoint');
				}
			});

			lineElement.setAttribute('data-address', address.toString());

			if (emulatorBreakpoints.has(address)) {
				lineElement.classList.add('breakpoint');
			}

			machineCodeOutput.appendChild(lineElement);
		}
	}

	updateEmulatorOutput();
}

function sendToLbp() {
	const startAddress = parseInt(controlSendStartInput.value) ?? 0;

	const lbpData = [];
	for (const line of assemblyOutput.lines) {
		if (line.tag === 'label') {
			continue;
		}

		const binary = line.bits;
		const wordSize = targetArch.wordSize;
		const words = binary.match(new RegExp(`.{1,${wordSize}}`, 'g'))!;
		let address = line.address;
		if (address < startAddress) {
			continue;
		}
		for (const word of words) {
			const binaryValue = parseInt(word, 2);
			// lbpData.push([address & 0xfff, address >> 12, binaryValue & 0xfff, binaryValue >> 12]);
			lbpData.push([address, binaryValue]);
			address += 1;
		}
	}
	const payload = JSON.stringify(lbpData);
	const delay = configuration.sendDelay;

	// send to websocket
	const socket = new WebSocket('ws://localhost:8090');
	controlSendStatus.innerText = 'Connecting...';

	const cancel = () => {
		controlSendCancelButton.innerText = 'Cancelling...';
		socket.send(JSON.stringify({ type: 'cancel' }));
	};
	let complete = false;

	socket.addEventListener('open', () => {
		socket.send(JSON.stringify({ type: 'data', data: payload, speed: delay }));

		controlSendCancelButton.disabled = false;
		controlSendCancelButton.addEventListener('click', cancel);

		socket.addEventListener('message', (event) => {
			const payload = JSON.parse(event.data);
			controlSendStatus.innerText = `${payload.message}\nChecksum: ${toNote(payload.checksum, 24)}`;
			if (payload.status === 'complete') {
				controlSendCancelButton.disabled = true;
				complete = true;
				socket.close();
			} else if (payload.status === 'cancelled') {
				controlSendCancelButton.innerText = 'Cancel';
				controlSendCancelButton.disabled = true;
				complete = true;
				controlSendCancelButton.removeEventListener('click', cancel);
				socket.close();
			}
		});
	});
	socket.addEventListener('error', () => {
		controlSendStatus.innerText = 'Error connecting';
		controlSendCancelButton.disabled = true;
	});
	socket.addEventListener('close', () => {
		if (!complete) {
			controlSendStatus.innerText = 'Disconnected';
		}
		controlSendCancelButton.disabled = true;
		controlSendCancelButton.removeEventListener('click', cancel);
		controlSendCancelButton.innerText = 'Cancel';
	});

}
