/**
 * Process Hunter Service
 */

import {exec} from 'child_process';
import {promisify} from 'util';
import * as https from 'https';
import {WindowsStrategy, UnixStrategy, platform_strategy} from './strategies';
import * as process from 'process';
import {logger} from '../shared/log_service';

const exec_async = promisify(exec);

export interface environment_scan_result {
	extension_port: number;
	connect_port: number;
	csrf_token: string;
}

export class ProcessHunter {
	private strategy: platform_strategy;
	private target_process: string;

	constructor() {
		logger.debug('Initializing ProcessHunter...');
		logger.debug(`Platform: ${process.platform}, Arch: ${process.arch}`);
		
		if (process.platform === 'win32') {
			this.strategy = new WindowsStrategy();
			this.target_process = 'language_server_windows_x64.exe';
			logger.debug('Using Windows Strategy');
		} else if (process.platform === 'darwin') {
			this.strategy = new UnixStrategy('darwin');
			this.target_process = `language_server_macos${process.arch === 'arm64' ? '_arm' : ''}`;
			logger.debug('Using macOS Strategy');
		} else {
			this.strategy = new UnixStrategy('linux');
			this.target_process = 'language_server_linux';
			logger.debug('Using Linux Strategy');
		}
		
		logger.debug(`Target Process: ${this.target_process}`);
	}

	async scan_environment(max_attempts: number = 1): Promise<environment_scan_result | null> {
		logger.info(`Scanning environment, max attempts: ${max_attempts}`);
		
		for (let i = 0; i < max_attempts; i++) {
			logger.debug(`Attempt ${i + 1}/${max_attempts}...`);
			
			try {
				const cmd = this.strategy.get_process_list_command(this.target_process);
				logger.debug(`Executing: ${cmd}`);
				
				const {stdout, stderr} = await exec_async(cmd, {timeout: 2000});
				
				if (stderr) {
					logger.warn(`StdErr: ${stderr}`);
				}
				
				const info = this.strategy.parse_process_info(stdout);
				
				if (info) {
					logger.info(`✅ Found Process: PID=${info.pid}, ExtPort=${info.extension_port}`);
					
					const ports = await this.identify_ports(info.pid);
					logger.debug(`Listening Ports: ${ports.join(', ')}`);
					
					if (ports.length > 0) {
						const valid_port = await this.verify_connection(ports, info.csrf_token);
						
						if (valid_port) {
							logger.info(`✅ Connection Logic Verified: ${valid_port}`);
							return {
								extension_port: info.extension_port,
								connect_port: valid_port,
								csrf_token: info.csrf_token,
							};
						}
					}
				}
			} catch (e: any) {
				logger.error(`Attempt ${i + 1} failed:`, e.message);
			}
			
			if (i < max_attempts - 1) {
				await new Promise(r => setTimeout(r, 100));
			}
		}
		
		return null;
	}

	private async identify_ports(pid: number): Promise<number[]> {
		try {
			const cmd = this.strategy.get_port_list_command(pid);
			const {stdout} = await exec_async(cmd);
			return this.strategy.parse_listening_ports(stdout);
		} catch (e: any) {
			logger.error('Port identification failed:', e.message);
			return [];
		}
	}

	private async verify_connection(ports: number[], token: string): Promise<number | null> {
		for (const port of ports) {
			if (await this.ping_port(port, token)) {
				return port;
			}
		}
		return null;
	}

	private ping_port(port: number, token: string): Promise<boolean> {
		return new Promise(resolve => {
			const options = {
				hostname: '127.0.0.1',
				port,
				path: '/exa.language_server_pb.LanguageServerService/GetUnleashData',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Codeium-Csrf-Token': token,
					'Connect-Protocol-Version': '1',
				},
				rejectUnauthorized: false,
				timeout: 2000,
			};

			const req = https.request(options, res => resolve(res.statusCode === 200));
			req.on('error', () => resolve(false));
			req.on('timeout', () => {
				req.destroy();
				resolve(false);
			});
			req.write(JSON.stringify({wrapper_data: {}}));
			req.end();
		});
	}
}
