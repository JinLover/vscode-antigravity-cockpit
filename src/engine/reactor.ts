/**
 * Reactor Core Service
 */

import * as https from 'https';
import {quota_snapshot, model_quota_info, prompt_credits_info, server_user_status_response} from '../shared/types';
import {logger} from '../shared/log_service';

export class ReactorCore {
	private port: number = 0;
	private token: string = '';

	private update_hdl?: (data: quota_snapshot) => void;
	private err_hdl?: (error: Error) => void;
	private pulse_timer?: NodeJS.Timeout;

	constructor() {
		logger.debug('ReactorCore Online');
	}

	engage(port: number, token: string) {
		this.port = port;
		this.token = token;
		logger.info(`Reactor Engaged: :${port}`);
	}

	private async transmit<T>(endpoint: string, payload: object): Promise<T> {
		return new Promise((resolve, reject) => {
			const data = JSON.stringify(payload);
			const opts: https.RequestOptions = {
				hostname: '127.0.0.1',
				port: this.port,
				path: endpoint,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(data),
					'Connect-Protocol-Version': '1',
					'X-Codeium-Csrf-Token': this.token,
				},
				rejectUnauthorized: false,
				timeout: 5000,
			};

			const req = https.request(opts, res => {
				let body = '';
				res.on('data', c => (body += c));
				res.on('end', () => {
					try {
						resolve(JSON.parse(body) as T);
					} catch (e: any) {
						reject(new Error('Signal Corrupted'));
					}
				});
			});

			req.on('error', (e) => reject(e));
			req.on('timeout', () => {
				req.destroy();
				reject(new Error('Signal Lost'));
			});

			req.write(data);
			req.end();
		});
	}

	on_telemetry(cb: (data: quota_snapshot) => void) {
		this.update_hdl = cb;
	}

	on_malfunction(cb: (error: Error) => void) {
		this.err_hdl = cb;
	}

	start_reactor(interval: number) {
		this.shutdown();
		logger.info(`Reactor Pulse: ${interval}ms`);
		
		this.sync_telemetry();
		
		this.pulse_timer = setInterval(() => {
			this.sync_telemetry();
		}, interval);
	}

	shutdown() {
		if (this.pulse_timer) {
			clearInterval(this.pulse_timer);
			this.pulse_timer = undefined;
		}
	}

	async sync_telemetry() {
		try {
			const raw = await this.transmit<server_user_status_response>(
				'/exa.language_server_pb.LanguageServerService/GetUserStatus',
				{
					metadata: {
						ideName: 'antigravity',
						extensionName: 'antigravity',
						locale: 'en',
					},
				}
			);

			const telemetry = this.decode_signal(raw);
			
			if (this.update_hdl) {
				this.update_hdl(telemetry);
			}
		} catch (error: any) {
			logger.error('Telemetry Sync Failed:', error.message);
			if (this.err_hdl) {
				this.err_hdl(error);
			}
		}
	}

	private decode_signal(data: server_user_status_response): quota_snapshot {
		const status = data.userStatus;
		const plan = status.planStatus?.planInfo;
		const credits = status.planStatus?.availablePromptCredits;

		let prompt_credits: prompt_credits_info | undefined;

		if (plan && credits !== undefined) {
			const montly_limit = Number(plan.monthlyPromptCredits);
			const available_val = Number(credits);
			
			if (montly_limit > 0) {
				prompt_credits = {
					available: available_val,
					monthly: montly_limit,
					used_percentage: ((montly_limit - available_val) / montly_limit) * 100,
					remaining_percentage: (available_val / montly_limit) * 100,
				};
			}
		}

		const configs = status.cascadeModelConfigData?.clientModelConfigs || [];
		
		const models: model_quota_info[] = configs
			.filter((m: any) => m.quotaInfo)
			.map((m: any) => {
				const reset = new Date(m.quotaInfo.resetTime);
				const now = new Date();
				const delta = reset.getTime() - now.getTime();

				return {
					label: m.label,
					model_id: m.modelOrAlias?.model || 'unknown',
					remaining_fraction: m.quotaInfo.remainingFraction,
					remaining_percentage: m.quotaInfo.remainingFraction !== undefined ? m.quotaInfo.remainingFraction * 100 : undefined,
					is_exhausted: m.quotaInfo.remainingFraction === 0,
					reset_time: reset,
					reset_time_display: this.format_iso(reset),
					time_until_reset: delta,
					time_until_reset_formatted: this.format_delta(delta),
				};
			});

		return {
			timestamp: new Date(),
			prompt_credits,
			models,
		};
	}

	private format_iso(d: Date): string {
		const pad = (n: number) => n.toString().padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	}

	private format_delta(ms: number): string {
		if (ms <= 0) return 'Online';
		const m = Math.ceil(ms / 60000);
		if (m < 60) return `${m}m`;
		const h = Math.floor(m / 60);
		return `${h}h ${m % 60}m`;
	}
}
