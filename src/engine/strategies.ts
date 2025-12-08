import {logger} from '../shared/log_service';

export interface platform_strategy {
	get_process_list_command(process_name: string): string;
	parse_process_info(stdout: string): {pid: number; extension_port: number; csrf_token: string} | null;
	get_port_list_command(pid: number): string;
	parse_listening_ports(stdout: string): number[];
	get_error_messages(): {process_not_found: string; command_not_available: string; requirements: string[]};
}

export class WindowsStrategy implements platform_strategy {
	private use_powershell: boolean = true;

	set_use_powershell(use: boolean) {
		this.use_powershell = use;
	}

	is_using_powershell(): boolean {
		return this.use_powershell;
	}

	/**
	 * Determine if a command line belongs to an Antigravity process.
	 * Checks for --app_data_dir antigravity parameter or antigravity in the path.
	 */
	private is_antigravity_process(command_line: string): boolean {
		const lower_cmd = command_line.toLowerCase();
		if (/--app_data_dir\s+antigravity\b/i.test(command_line)) {
			return true;
		}
		if (lower_cmd.includes('\\antigravity\\') || lower_cmd.includes('/antigravity/')) {
			return true;
		}
		return false;
	}

	get_process_list_command(process_name: string): string {
		if (this.use_powershell) {
			return `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name='${process_name}'\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json"`;
		}
		return `wmic process where "name='${process_name}'" get ProcessId,CommandLine /format:list`;
	}

	parse_process_info(stdout: string): {pid: number; extension_port: number; csrf_token: string} | null {
		logger.debug('[WindowsStrategy] 开始解析进程信息...');
		
		if (this.use_powershell || stdout.trim().startsWith('{') || stdout.trim().startsWith('[')) {
			try {
				let data = JSON.parse(stdout.trim());
				if (Array.isArray(data)) {
					if (data.length === 0) {
						logger.debug('[WindowsStrategy] JSON 数组为空');
						return null;
					}
					const total_count = data.length;
					const antigravity_processes = data.filter((item: any) => item.CommandLine && this.is_antigravity_process(item.CommandLine));
					logger.info(`[WindowsStrategy] 找到 ${total_count} 个 language_server 进程, ${antigravity_processes.length} 个属于 Antigravity`);
					
					if (antigravity_processes.length === 0) {
						logger.warn('[WindowsStrategy] 未找到 Antigravity 进程，跳过非 Antigravity 进程');
						return null;
					}
					if (total_count > 1) {
						logger.debug(`[WindowsStrategy] 选择 Antigravity 进程 PID: ${antigravity_processes[0].ProcessId}`);
					}
					data = antigravity_processes[0];
				} else {
					if (!data.CommandLine || !this.is_antigravity_process(data.CommandLine)) {
						logger.warn('[WindowsStrategy] 单个进程不是 Antigravity，跳过');
						return null;
					}
					logger.info(`[WindowsStrategy] 找到 1 个 Antigravity 进程, PID: ${data.ProcessId}`);
				}

				const command_line = data.CommandLine || '';
				const pid = data.ProcessId;

				if (!pid) {
					logger.warn('[WindowsStrategy] 无法获取 PID');
					return null;
				}

				const port_match = command_line.match(/--extension_server_port[=\s]+(\d+)/);
				const token_match = command_line.match(/--csrf_token[=\s]+([a-f0-9\-]+)/i);

				if (!token_match || !token_match[1]) {
					logger.warn('[WindowsStrategy] 无法从命令行中提取 CSRF Token');
					logger.debug(`[WindowsStrategy] 命令行: ${command_line.substring(0, 200)}...`);
					return null;
				}

				const extension_port = port_match && port_match[1] ? parseInt(port_match[1], 10) : 0;
				const csrf_token = token_match[1];

				logger.debug(`[WindowsStrategy] 解析成功: PID=${pid}, ExtPort=${extension_port}`);
				return {pid, extension_port, csrf_token};
			} catch (e: any) {
				logger.debug(`[WindowsStrategy] JSON 解析失败: ${e.message}`);
			}
		}
		
		// WMIC 格式解析
		logger.debug('[WindowsStrategy] 尝试 WMIC 格式解析...');
		const blocks = stdout.split(/\n\s*\n/).filter(block => block.trim().length > 0);

		const candidates: Array<{pid: number; extension_port: number; csrf_token: string}> = [];

		for (const block of blocks) {
			const pid_match = block.match(/ProcessId=(\d+)/);
			const command_line_match = block.match(/CommandLine=(.+)/);

			if (!pid_match || !command_line_match) {
				continue;
			}

			const command_line = command_line_match[1].trim();

			if (!this.is_antigravity_process(command_line)) {
				continue;
			}

			const port_match = command_line.match(/--extension_server_port[=\s]+(\d+)/);
			const token_match = command_line.match(/--csrf_token[=\s]+([a-f0-9\-]+)/i);

			if (!token_match || !token_match[1]) {
				continue;
			}

			const pid = parseInt(pid_match[1], 10);
			const extension_port = port_match && port_match[1] ? parseInt(port_match[1], 10) : 0;
			const csrf_token = token_match[1];

			candidates.push({pid, extension_port, csrf_token});
		}

		if (candidates.length === 0) {
			logger.warn('[WindowsStrategy] WMIC: 未找到 Antigravity 进程');
			return null;
		}

		logger.info(`[WindowsStrategy] WMIC: 找到 ${candidates.length} 个 Antigravity 进程, 使用 PID: ${candidates[0].pid}`);
		return candidates[0];
	}

	get_port_list_command(pid: number): string {
		return `netstat -ano | findstr "${pid}" | findstr "LISTENING"`;
	}

	parse_listening_ports(stdout: string): number[] {
		const port_regex = /(?:127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\\d+)\s+\S+\s+LISTENING/gi;
		const ports: number[] = [];
		let match;

		while ((match = port_regex.exec(stdout)) !== null) {
			const port = parseInt(match[1], 10);
			if (!ports.includes(port)) {
				ports.push(port);
			}
		}

		logger.debug(`[WindowsStrategy] 解析到 ${ports.length} 个端口: ${ports.join(', ')}`);
		return ports.sort((a, b) => a - b);
	}

	get_error_messages() {
		return {
			process_not_found: this.use_powershell ? 'language_server process not found' : 'language_server process not found',
			command_not_available: this.use_powershell
				? 'PowerShell command failed; please check system permissions'
				: 'wmic/PowerShell command unavailable; please check the system environment',
			requirements: [
				'Antigravity is running',
				'language_server_windows_x64.exe process is running',
				this.use_powershell
					? 'The system has permission to run PowerShell and netstat commands'
					: 'The system has permission to run wmic/PowerShell and netstat commands (auto-fallback supported)',
			],
		};
	}
}

export class UnixStrategy implements platform_strategy {
	private platform: string;
	private target_pid: number = 0;
	
	constructor(platform: string) {
		this.platform = platform;
		logger.debug(`[UnixStrategy] 初始化，平台: ${platform}`);
	}

	get_process_list_command(process_name: string): string {
		return `pgrep -fl ${process_name}`;
	}

	parse_process_info(stdout: string): {pid: number; extension_port: number; csrf_token: string} | null {
		logger.debug('[UnixStrategy] 开始解析进程信息...');
		
		const lines = stdout.split('\n');
		logger.debug(`[UnixStrategy] 输出包含 ${lines.length} 行`);
		
		for (const line of lines) {
			if (line.includes('--extension_server_port')) {
				logger.debug(`[UnixStrategy] 找到匹配行: ${line.substring(0, 100)}...`);
				
				const parts = line.trim().split(/\s+/);
				const pid = parseInt(parts[0], 10);
				const cmd = line.substring(parts[0].length).trim();

				const port_match = cmd.match(/--extension_server_port[=\s]+(\d+)/);
				const token_match = cmd.match(/--csrf_token[=\s]+([a-zA-Z0-9\-]+)/);

				if (!token_match || !token_match[1]) {
					logger.warn('[UnixStrategy] 无法从命令行中提取 CSRF Token');
					continue;
				}

				logger.debug(`[UnixStrategy] 解析成功: PID=${pid}, ExtPort=${port_match?.[1] || 0}`);
				
				// 保存目标 PID 用于后续端口过滤
				this.target_pid = pid;
				
				return {
					pid,
					extension_port: port_match ? parseInt(port_match[1], 10) : 0,
					csrf_token: token_match ? token_match[1] : '',
				};
			}
		}
		
		logger.warn('[UnixStrategy] 未在输出中找到包含 --extension_server_port 的行');
		return null;
	}

	get_port_list_command(pid: number): string {
		// 保存目标 PID
		this.target_pid = pid;
		
		if (this.platform === 'darwin') {
			// macOS: 使用 lsof 列出所有 TCP LISTEN 端口，然后用 grep 过滤 PID
			// -p 参数在某些情况下权限不足无法正确过滤，所以改用 grep
			return `lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null | grep -E "^\\S+\\s+${pid}\\s"`;
		}
		return `ss -tlnp 2>/dev/null | grep "pid=${pid}" || lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null | grep -E "^\\S+\\s+${pid}\\s"`;
	}

	parse_listening_ports(stdout: string): number[] {
		const ports: number[] = [];

		if (this.platform === 'darwin') {
			// macOS lsof 输出格式 (已经过 grep 过滤 PID):
			// language_ 15684 jieli   12u  IPv4 0x310104...    0t0  TCP *:53125 (LISTEN)
			
			const lines = stdout.split('\n');
			logger.debug(`[UnixStrategy] lsof 输出 ${lines.length} 行 (已过滤 PID: ${this.target_pid})`);
			
			for (const line of lines) {
				if (!line.trim()) {
					continue;
				}
				
				logger.debug(`[UnixStrategy] 解析行: ${line.substring(0, 80)}...`);
				
				// 检查是否是 LISTEN 状态
				if (!line.includes('(LISTEN)')) {
					continue;
				}
				
				// 提取端口号 - 匹配 *:PORT 或 IP:PORT 格式
				const port_match = line.match(/[*\d.:]+:(\d+)\s+\(LISTEN\)/);
				if (port_match) {
					const port = parseInt(port_match[1], 10);
					if (!ports.includes(port)) {
						ports.push(port);
						logger.debug(`[UnixStrategy] ✅ 找到端口: ${port}`);
					}
				}
			}
			
			logger.info(`[UnixStrategy] 解析到 ${ports.length} 个目标进程端口: ${ports.join(', ') || '(无)'}`);
		} else {
			const ss_regex = /LISTEN\s+\d+\s+\d+\s+(?:\*|[\d.]+|\[[\da-f:]*\]):(\d+)/gi;
			let match;
			while ((match = ss_regex.exec(stdout)) !== null) {
				const port = parseInt(match[1], 10);
				if (!ports.includes(port)) {
					ports.push(port);
				}
			}

			if (ports.length === 0) {
				const lsof_regex = /(?:TCP|UDP)\s+(?:\*|[\d.]+|\[[\da-f:]+\]):(\d+)\s+\(LISTEN\)/gi;
				while ((match = lsof_regex.exec(stdout)) !== null) {
					const port = parseInt(match[1], 10);
					if (!ports.includes(port)) {
						ports.push(port);
					}
				}
			}
		}

		logger.debug(`[UnixStrategy] 解析到 ${ports.length} 个端口: ${ports.join(', ')}`);
		return ports.sort((a, b) => a - b);
	}

	get_error_messages() {
		return {
			process_not_found: 'Process not found',
			command_not_available: 'Command check failed',
			requirements: ['lsof or netstat'],
		};
	}
}
