/**
 * AGQ Logger - 日志管理器
 * 使用 VS Code OutputChannel 输出日志到"输出"面板
 */

import * as vscode from 'vscode';

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
}

class Logger {
	private outputChannel: vscode.OutputChannel | null = null;
	private logLevel: LogLevel = LogLevel.DEBUG;

	/**
	 * 初始化日志频道
	 */
	init() {
		if (!this.outputChannel) {
			this.outputChannel = vscode.window.createOutputChannel('AGQ Cockpit');
		}
	}

	/**
	 * 设置日志级别
	 */
	setLevel(level: LogLevel) {
		this.logLevel = level;
	}

	/**
	 * 获取当前时间戳
	 */
	private getTimestamp(): string {
		const now = new Date();
		return now.toISOString().replace('T', ' ').substring(0, 19);
	}

	/**
	 * 格式化日志消息
	 */
	private formatMessage(level: string, message: string, ...args: any[]): string {
		const timestamp = this.getTimestamp();
		let formatted = `[${timestamp}] [${level}] ${message}`;
		
		if (args.length > 0) {
			const argsStr = args.map(arg => {
				if (typeof arg === 'object') {
					try {
						return JSON.stringify(arg, null, 2);
					} catch {
						return String(arg);
					}
				}
				return String(arg);
			}).join(' ');
			formatted += ` ${argsStr}`;
		}
		
		return formatted;
	}

	/**
	 * 输出日志
	 */
	private log(level: LogLevel, levelStr: string, message: string, ...args: any[]) {
		if (level < this.logLevel) return;
		
		const formatted = this.formatMessage(levelStr, message, ...args);
		
		if (this.outputChannel) {
			this.outputChannel.appendLine(formatted);
		}
		
		// 同时输出到控制台（开发者工具）
		switch (level) {
			case LogLevel.DEBUG:
				console.log(formatted);
				break;
			case LogLevel.INFO:
				console.info(formatted);
				break;
			case LogLevel.WARN:
				console.warn(formatted);
				break;
			case LogLevel.ERROR:
				console.error(formatted);
				break;
		}
	}

	/**
	 * 调试日志
	 */
	debug(message: string, ...args: any[]) {
		this.log(LogLevel.DEBUG, 'DEBUG', message, ...args);
	}

	/**
	 * 信息日志
	 */
	info(message: string, ...args: any[]) {
		this.log(LogLevel.INFO, 'INFO', message, ...args);
	}

	/**
	 * 警告日志
	 */
	warn(message: string, ...args: any[]) {
		this.log(LogLevel.WARN, 'WARN', message, ...args);
	}

	/**
	 * 错误日志
	 */
	error(message: string, ...args: any[]) {
		this.log(LogLevel.ERROR, 'ERROR', message, ...args);
	}

	/**
	 * 显示日志面板
	 */
	show() {
		this.outputChannel?.show();
	}

	/**
	 * 清空日志
	 */
	clear() {
		this.outputChannel?.clear();
	}

	/**
	 * 销毁日志频道
	 */
	dispose() {
		this.outputChannel?.dispose();
		this.outputChannel = null;
	}
}

// 导出单例
export const logger = new Logger();
