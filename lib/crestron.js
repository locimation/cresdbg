import { Client } from "ssh2";
import AdmZip from "adm-zip";
import { parseCrestronSigFile } from "./parseSig.js";

class Crestron {
	/**
	 * @param {Object} options
	 * @param {string} options.host - IP or hostname of the Crestron processor
	 * @param {number} options.port - SSH port (e.g. 22 or custom)
	 * @param {string} options.username - SSH username
	 * @param {string} options.password - SSH password
	 */
	constructor(options) {
		this.host = options.host;
		this.port = options.port;
		this.username = options.username;
		this.password = options.password;

		this.client = new Client();
		this._connected = false;

		this.program_signal_cache = [];

		// Shell-related state
		this.shellStream = null;
		this.buffer = ""; // accumulates incoming shell data
		this.promptRegex = /CP4>/; // Adjust to match your actual Crestron prompt (e.g., /CP4>|CP3>|PRO3>/ )
		this.currentResolve = null; // for resolving the current command's promise
	}

	/**
	 * Establish an SSH connection and open a shell session to the Crestron processor.
	 */
	connect() {
		return new Promise((resolve, reject) => {
			this.client
				.on("ready", () => {
					this._connected = true;
					// Once ready, open a shell
					this.client.shell((err, stream) => {
						if (err) {
							return reject(err);
						}
						this.shellStream = stream;

						// Listen for all data coming from the shell
						stream.on("data", (chunk) => this._onShellData(chunk));

						// If the shell closes, mark disconnected
						stream.on("close", () => {
							this._connected = false;
						});

						// Optionally, wait a moment for the initial prompt
						// or just resolve immediately
						resolve();
					});
				})
				.on("error", (err) => {
					reject(err);
				})
				.connect({
					host: this.host,
					port: this.port,
					username: this.username,
					password: this.password,
				});
		});
	}

	/**
	 * Handler for whenever we get data on the shell stream.
	 * We buffer it and check if we've reached the Crestron prompt.
	 */
	_onShellData(chunk) {
		const text = chunk.toString();
		this.buffer += text;

		// Check if we've reached a prompt
		if (this.currentResolve?.pattern.test(this.buffer)) {
			// If we have a command waiting for resolution, resolve it now
			const fullOutput = this.buffer;
			// Clear the buffer for the next command
			this.buffer = "";
			// Resolve the promise with everything we got
			this.currentResolve.resolve(fullOutput);
			this.currentResolve = null;
		}
	}

	/**
	 * Write a command to the shell and wait for the next prompt.
	 * @param {string} command
	 * @returns {Promise<string>} The entire console output up to (and including) the prompt.
	 */
	execShellCommand(command, pattern) {
		return new Promise((resolve, reject) => {
			if (!this._connected || !this.shellStream) {
				return reject(new Error("Shell is not connected or not ready."));
			}

			// The next prompt arrival will resolve this command
			this.currentResolve = { pattern, resolve };
			// Send the command (plus \r\n)
			this.shellStream.write(`${command.trim()}\r\n`);
		});
	}

	/**
	 * Closes the SSH connection and shell stream.
	 */
	async disconnect() {
		if (this.shellStream) {
			// Some people do "exit\r\n" or just end the stream
			this.shellStream.end("bye\r\n");
			this.shellStream = null;
		}
		if (this._connected) {
			this.client.end();
			this._connected = false;
		}
	}

	/**
	 * Retrieve the numeric signal number from the .zig file (cached).
	 */
	async getSignalNumber(program, name) {
		if (this.program_signal_cache[program] === undefined) {
			// We must SFTP in shell mode? Actually, 'client.sftp' works outside the shell.
			// This is OK if Crestron allows standard SFTP on the same connection.
			await new Promise((resolve, reject) => {
				this.client.sftp((err, sftp) => {
					if (err) return reject(err);
					sftp.readdir(
						`/program${String(program).padStart(2, "0")}`,
						(err, list) => {
							if (err) return reject(err);

							const zig = list.filter((file) => file.filename.endsWith(".zig"));
							if (!zig.length) {
								return reject(
									new Error(`No .zig file found for program ${program}`),
								);
							}
							// read the first .zig file
							sftp.readFile(
								`/program${String(program).padStart(2, "0")}/${zig[0].filename}`,
								(err, data) => {
									if (err) return reject(err);

									const zip = new AdmZip(data, { readEntries: true });
									const sig = zip.getEntries()[0].getData();
									const signals = parseCrestronSigFile(sig);
									this.program_signal_cache[program] = signals;
									resolve();
								},
							);
						},
					);
				});
			});
		}
		const signalMeta = this.program_signal_cache[program][name];
		if (!signalMeta) {
			throw new Error(`Signal ${name} not found in program ${program}`);
		}
		return signalMeta.number;
	}

	/**
	 * Sets a signal to a given value on the Crestron processor.
	 * Equivalent to: SETSIGNAL:{program} {signalNumber} {value}
	 */
	async setSignal(program, signalName, value) {
		const signalNumber = await this.getSignalNumber(program, signalName);
		const cmd = `SETSIGNAL:${program} ${signalNumber} ${value}`;
		await this.execShellCommand(cmd, /CP4>/);
		// The output might show some lines like 00000020:1=1
		// but we generally don't parse it unless needed
	}

	/**
	 * Reads (queries) the current value of a signal.
	 * We use MDBGSIGNAL or DBGSIGNAL, whichever works best for your scenario.
	 */
	async getSignal(program, signalName) {
		const signalNumber = await this.getSignalNumber(program, signalName);

		// For single-signal queries, MDBGSIGNAL is often more reliable:
		const cmd = `MDBGSIGNAL:${program} -S:SYNC ${signalNumber}`;
		const regex = new RegExp(
			`${signalNumber.toString("16").padStart(8, "0")}:\\d=.*`,
		);
		const output = await this.execShellCommand(cmd, regex);

		// Parse lines from the output
		const lines = output
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
		// lines might include the command echo, signal lines, prompt, etc.

		// Example line: 00000020:1=1
		for (const line of lines) {
			const match = line.match(/^([0-9A-Fa-f]+):(\d)=(.*)$/);
			if (match) {
				const [_, hexSignal, progStr, valStr] = match;
				const lineDecSignal = Number.parseInt(hexSignal, 16);
				const lineProgNum = Number.parseInt(progStr, 10);

				// Compare to our target signal
				if (lineProgNum === program && lineDecSignal === signalNumber) {
					// Basic interpretation
					// if (valStr === "0") return false;
					// if (valStr === "1") return true;

					const maybeNum = Number.parseInt(valStr, 10);
					if (!Number.isNaN(maybeNum)) {
						return maybeNum;
					}

					// If it's a hex string, convert it to a string
					return valStr.replaceAll(/\[([0-9A-F]{2})\]/g, (_, match) =>
						String.fromCharCode(Number.parseInt(match, 16)),
					);

				}
			}
		}
		return null;
	}
}

/** ========== Globals ========== **/
const loginDetails = {
	host: "",
	port: 22,
	username: "",
	password: "",
};

// Our singleton Crestron instance
let crestronClient = null;

/**
 * Attempts to create/connect crestronClient if we have enough info.
 * Called whenever we set host/username/password.
 */
async function tryLogin() {
	const { host, port, username, password } = loginDetails;
	if (host && username && password) {
		if (!crestronClient) {
			crestronClient = new Crestron({ host, port, username, password });
			await crestronClient.connect();
		}
	}
}

// Public helper functions
export async function setHost(host) {
	loginDetails.host = host;
	await tryLogin();
}

export async function setPort(port) {
	loginDetails.port = port;
	await tryLogin();
}

export async function setUsername(username) {
	loginDetails.username = username;
	await tryLogin();
}

export async function setPassword(password) {
	loginDetails.password = password;
	await tryLogin();
}

export async function setSignal(signalName, value) {
	if (!crestronClient) {
		throw new Error("Crestron client not connected.");
	}
	// Example usage => setSignal('input_select', 3)
	await crestronClient.setSignal(1, signalName, value);
}

export async function getSignal(signalName) {
	if (!crestronClient) {
		throw new Error("Crestron client not connected.");
	}
	// Example usage => getSignal('hdmi_3_active')
	return await crestronClient.getSignal(1, signalName);
}

export async function disconnect() {
	if (crestronClient) {
		await crestronClient.disconnect();
		crestronClient = null;
	}
}
