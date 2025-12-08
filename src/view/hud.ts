import * as vscode from 'vscode';
import {quota_snapshot, model_quota_info} from '../shared/types';
import {logger} from '../shared/log_service';

export class CockpitHUD {
	public static readonly viewType = 'antigravity.cockpit';
	private panels: Map<string, vscode.WebviewPanel> = new Map();
	private cached_telemetry?: quota_snapshot;

	constructor(private readonly extensionUri: vscode.Uri) {}

	public reveal_hud(snapshot?: quota_snapshot) {
		if (snapshot) {
			this.cached_telemetry = snapshot;
		}

		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		const existingPanel = this.panels.get('main');
		if (existingPanel) {
			existingPanel.reveal(column);
			if (this.cached_telemetry) {
				const config = vscode.workspace.getConfiguration('agCockpit');
				const showPromptCredits = config.get<boolean>('showPromptCredits', false);
				const pinnedModels = config.get<string[]>('pinnedModels', []);
				const modelOrder = config.get<string[]>('modelOrder', []);
				this.refresh_view(this.cached_telemetry, { showPromptCredits, pinnedModels, modelOrder });
			}
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			CockpitHUD.viewType,
			'Antigravity Cockpit',
			column || vscode.ViewColumn.One,
			{
				enableScripts: true,
				localResourceRoots: [this.extensionUri],
			}
		);

		this.panels.set('main', panel);

		panel.onDidDispose(() => {
			this.panels.delete('main');
		});
		
		panel.webview.onDidReceiveMessage(message => {
			if (this.msg_router) {
				this.msg_router(message);
			}
		});

		panel.webview.html = this._generate_hud_html(panel.webview);

		if (this.cached_telemetry) {
			const config = vscode.workspace.getConfiguration('agCockpit');
			const showPromptCredits = config.get<boolean>('showPromptCredits', false);
			const pinnedModels = config.get<string[]>('pinnedModels', []);
			const modelOrder = config.get<string[]>('modelOrder', []);
			this.refresh_view(this.cached_telemetry, { showPromptCredits, pinnedModels, modelOrder });
		}
	}

	public rehydrate() {
		if (this.cached_telemetry) {
			const config = vscode.workspace.getConfiguration('agCockpit');
			const showPromptCredits = config.get<boolean>('showPromptCredits', false);
			const pinnedModels = config.get<string[]>('pinnedModels', []);
			const modelOrder = config.get<string[]>('modelOrder', []);
			this.refresh_view(this.cached_telemetry, { showPromptCredits, pinnedModels, modelOrder });
		}
	}


	private msg_router?: (message: any) => void;

	public on_signal(handler: (message: any) => void) {
		this.msg_router = handler;
	}

	public refresh_view(snapshot: quota_snapshot, config: { showPromptCredits: boolean; pinnedModels: string[]; modelOrder?: string[] } = { showPromptCredits: false, pinnedModels: [], modelOrder: [] }) {
		this.cached_telemetry = snapshot;
		const panel = this.panels.get('main');
		if (panel && panel.visible) {
			panel.webview.postMessage({
				type: 'telemetry_update',
				data: snapshot,
				config: config
			});
		}
	}

	private _generate_hud_html(webview: vscode.Webview) {
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Antigravity Cockpit</title>
			<style>
				:root {
					--bg-color: #0d1117;
					--card-bg: #161b22;
					--text-primary: #e6edf3;
					--text-secondary: #8b949e;
					--accent: #2f81f7;
					--success: #238636;
					--warning: #d29922;
					--danger: #da3633;
					--font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
				}

				body {
					background-color: var(--bg-color);
					color: var(--text-primary);
					font-family: var(--font-family);
					padding: 20px;
					margin: 0;
					display: flex;
					flex-direction: column;
					align-items: center;
				}

				h1 {
					font-size: 24px;
					margin-bottom: 20px;
					letter-spacing: 1px;
					text-transform: uppercase;
					color: var(--text-primary);
					border-bottom: 2px solid var(--accent);
					padding-bottom: 10px;
					width: 100%;
					max-width: 1200px;
					display: flex;
					justify-content: space-between;
					align-items: center;
				}

				.controls {
					display: flex;
					gap: 10px;
					align-items: center;
					font-size: 14px;
				}

				.switch {
					position: relative;
					display: inline-block;
					width: 36px;
					height: 20px;
					margin-left: 8px;
				}
				.switch input { opacity: 0; width: 0; height: 0; }
				.slider {
					position: absolute;
					cursor: pointer;
					top: 0; left: 0; right: 0; bottom: 0;
					background-color: #30363d;
					transition: .4s;
					border-radius: 20px;
				}
				.slider:before {
					position: absolute;
					content: "";
					height: 14px;
					width: 14px;
					left: 3px;
					bottom: 3px;
					background-color: white;
					transition: .4s;
					border-radius: 50%;
				}
				input:checked + .slider { background-color: var(--accent); }
				input:checked + .slider:before { transform: translateX(16px); }

				#dashboard {
					display: grid;
					grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
					gap: 20px;
					width: 100%;
					max-width: 1200px;
				}

				.card {
					background-color: var(--card-bg);
					border-radius: 12px;
					padding: 20px;
					box-shadow: 0 4px 12px rgba(0,0,0,0.3);
					transition: transform 0.2s, box-shadow 0.2s;
					border: 1px solid #30363d;
					display: flex;
					flex-direction: column;
					align-items: center;
					position: relative;
					overflow: hidden;
					cursor: grab;
				}
				
				.card:active {
					cursor: grabbing;
				}

				.card.dragging {
					opacity: 0.5;
					border: 2px dashed var(--accent);
				}
				
				.card.over {
					border: 2px solid var(--accent);
				}

				.card:hover {
					transform: translateY(-2px);
					box-shadow: 0 6px 16px rgba(0,0,0,0.5);
					border-color: var(--accent);
				}

				.card-title {
					font-size: 16px;
					font-weight: 600;
					margin-bottom: 15px;
					color: var(--text-primary);
					width: 100%;
					text-align: left;
					display: flex;
					justify-content: space-between;
					align-items: center;
					white-space: nowrap;
					overflow: hidden;
					text-overflow: ellipsis;
				}
				
				.card-title span {
					overflow: hidden;
					text-overflow: ellipsis;
				}

				.pin-btn {
					background: none;
					border: none;
					cursor: pointer;
					color: var(--text-secondary);
					font-size: 16px;
					transition: color 0.2s;
					padding: 4px;
				}
				.pin-btn:hover { color: var(--text-primary); }
				.pin-btn:hover { color: var(--text-primary); }
				.pin-btn.active { color: var(--accent); }

				.refresh-btn {
					background: transparent;
					border: 1px solid var(--text-secondary);
					color: var(--text-primary);
					border-radius: 4px;
					cursor: pointer;
					padding: 4px 10px;
					font-size: 12px;
					height: 24px;
					display: flex;
					align-items: center;
					justify-content: center;
					transition: all 0.2s;
					margin-right: 15px;
					min-width: 60px;
				}
				.refresh-btn:hover:not(:disabled) {
					border-color: var(--accent);
					color: var(--accent);
					background: rgba(47, 129, 247, 0.1);
				}
				.refresh-btn:disabled {
					opacity: 0.5;
					cursor: not-allowed;
					border-color: #30363d;
					color: var(--text-secondary);
				}

				.status-dot {
					width: 10px;
					height: 10px;
					border-radius: 50%;
					background-color: var(--secondary);
				}

				/* Circular Progress */
				.progress-circle {
					width: 120px;
					height: 120px;
					border-radius: 50%;
					background: conic-gradient(var(--accent) 0%, transparent 0%);
					display: flex;
					align-items: center;
					justify-content: center;
					position: relative;
					margin-bottom: 15px;
					box-shadow: 0 0 15px rgba(47, 129, 247, 0.2);
				}
				
				.progress-circle::before {
					content: '';
					position: absolute;
					width: 100px;
					height: 100px;
					border-radius: 50%;
					background-color: var(--card-bg);
				}

				.percentage {
					position: relative;
					font-size: 24px;
					font-weight: bold;
				}

				.info-row {
					display: flex;
					justify-content: space-between;
					width: 100%;
					margin-top: 8px;
					font-size: 13px;
					color: var(--text-secondary);
				}

				.info-value {
					color: var(--text-primary);
					font-weight: 500;
				}

				.loading {
					font-style: italic;
					color: var(--text-secondary);
				}

				/* Color based on percentage */
				.good { --progress-color: var(--success); }
				.medium { --progress-color: var(--warning); }
				.low { --progress-color: var(--danger); }

			</style>
		</head>
		<body>
			<h1>
				<span>Antigravity Cockpit</span>
				<div class="controls">
					<button id="refresh-btn" class="refresh-btn" title="Manual Refresh (60s Cooldown)">REFRESH</button>
					<label>Show Prompt Credits
						<label class="switch">
							<input type="checkbox" id="credits-toggle">
							<span class="slider"></span>
						</label>
					</label>
				</div>
			</h1>
			<div id="status">Connecting to systems...</div>
			<div id="dashboard">
				<!-- Injected via JS -->
			</div>

			<script>
				const vscode = acquireVsCodeApi();
				const dashboard = document.getElementById('dashboard');
				const statusDiv = document.getElementById('status');
				const creditsToggle = document.getElementById('credits-toggle');
				const refreshBtn = document.getElementById('refresh-btn');

				// Use State for Cooldown persistence
				const state = vscode.getState() || {};
				if (state.lastRefresh) {
					const now = Date.now();
					const diff = Math.floor((now - state.lastRefresh) / 1000);
					if (diff < 60) {
						startCooldown(60 - diff);
					}
				}

				refreshBtn.addEventListener('click', () => {
					vscode.postMessage({ command: 'refresh' });
					const now = Date.now();
					vscode.setState({ ...state, lastRefresh: now });
					startCooldown(60);
				});

				function startCooldown(seconds) {
					refreshBtn.disabled = true;
					refreshBtn.innerText = seconds + 's';
					
					let remaining = seconds;
					const timer = setInterval(() => {
						remaining--;
						if (remaining <= 0) {
							clearInterval(timer);
							refreshBtn.disabled = false;
							refreshBtn.innerText = 'REFRESH';
						} else {
							refreshBtn.innerText = remaining + 's';
						}
					}, 1000);
				}

				// Bind Toggle Event
				creditsToggle.addEventListener('change', () => {
					vscode.postMessage({ command: 'toggleCredits' });
				});

				window.addEventListener('message', event => {
					const message = event.data;
					if (message.type === 'telemetry_update') {
						render(message.data, message.config);
					}
				});

				// Handshake: Tell extension we are ready to receive data
				vscode.postMessage({ command: 'init' });

				function getHealthColor(percentage) {
					if (percentage > 50) return 'var(--success)';
					if (percentage > 20) return 'var(--warning)';
					return 'var(--danger)';
				}

				function togglePin(modelId) {
					vscode.postMessage({ command: 'togglePin', modelId: modelId });
				}
				
				// Drag and Drop Logic
				let dragSrcEl = null;

				function handleDragStart(e) {
					this.style.opacity = '0.4';
					dragSrcEl = this;
					e.dataTransfer.effectAllowed = 'move';
					e.dataTransfer.setData('text/plain', this.getAttribute('data-id'));
					this.classList.add('dragging');
				}

				function handleDragOver(e) {
					if (e.preventDefault) {
						e.preventDefault();
					}
					e.dataTransfer.dropEffect = 'move';
					return false;
				}

				function handleDragEnter(e) {
					this.classList.add('over');
				}

				function handleDragLeave(e) {
					this.classList.remove('over');
				}

				function handleDrop(e) {
					if (e.stopPropagation) {
						e.stopPropagation();
					}
					
					if (dragSrcEl !== this) {
						// Swap elements visually logic: use insertBefore
						
						// Get all cards
						const cards = Array.from(dashboard.querySelectorAll('.card'));
						const srcIndex = cards.indexOf(dragSrcEl);
						const targetIndex = cards.indexOf(this);
						
						if (srcIndex < targetIndex) {
							this.after(dragSrcEl);
						} else {
							this.before(dragSrcEl);
						}
						
						// Save new order
						const newOrder = Array.from(dashboard.querySelectorAll('.card')).map(card => card.getAttribute('data-id'));
						vscode.postMessage({ command: 'updateOrder', order: newOrder });
					}
					
					return false;
				}

				function handleDragEnd(e) {
					this.style.opacity = '1';
					this.classList.remove('dragging');
					
					let items = document.querySelectorAll('.card');
					items.forEach(function (item) {
						item.classList.remove('over');
					});
				}

				function render(snapshot, config) {
					statusDiv.style.display = 'none';
					dashboard.innerHTML = '';

					// Update UI State
					creditsToggle.checked = config && config.showPromptCredits;

					// Prompt Credits Card
					if (snapshot.prompt_credits && config && config.showPromptCredits) {
						const pc = snapshot.prompt_credits;
						const card = document.createElement('div');
						card.className = 'card';
						
						const color = getHealthColor(pc.remaining_percentage);
						
						card.innerHTML = \`
							<div class="card-title">Prompt Credits <span class="status-dot" style="background-color: \${color}"></span></div>
							<div class="progress-circle" style="background: conic-gradient(\${color} \${pc.remaining_percentage}%, #30363d \${pc.remaining_percentage}%);">
								<div class="percentage">\${pc.remaining_percentage.toFixed(0)}%</div>
							</div>
							<div class="info-row">
								<span>Available</span>
								<span class="info-value">\${pc.available}</span>
							</div>
							<div class="info-row">
								<span>Monthly</span>
								<span class="info-value">\${pc.monthly}</span>
							</div>
						\`;
						dashboard.appendChild(card);
					}

					// Sorting Logic
					// 1. Use API order as base
					let models = [...snapshot.models];
					
					// 2. Then applying specific user order if present
					if (config && config.modelOrder && config.modelOrder.length > 0) {
						const orderMap = new Map();
						config.modelOrder.forEach((id, index) => orderMap.set(id, index));
						
						// Stable sort utilizing the alphabetic order as tie-breaker/fallback
						models.sort((a, b) => {
							const idxA = orderMap.has(a.model_id) ? orderMap.get(a.model_id) : 99999;
							const idxB = orderMap.has(b.model_id) ? orderMap.get(b.model_id) : 99999;
							return idxA - idxB;
						});
					}

					// Model Cards
					models.forEach(model => {
						const pct = model.remaining_percentage || 0;
						const color = getHealthColor(pct);
						const card = document.createElement('div');
						card.className = 'card';
						card.setAttribute('draggable', 'true');
						card.setAttribute('data-id', model.model_id);
						
						// Events for DnD
						card.addEventListener('dragstart', handleDragStart, false);
						card.addEventListener('dragenter', handleDragEnter, false);
						card.addEventListener('dragover', handleDragOver, false);
						card.addEventListener('dragleave', handleDragLeave, false);
						card.addEventListener('drop', handleDrop, false);
						card.addEventListener('dragend', handleDragEnd, false);
						
						const isPinned = config && config.pinnedModels && config.pinnedModels.includes(model.model_id);
						
						// Note model_id needs to be escaped if it contains special chars.
						const safeId = model.model_id.replace(/'/g, "\\\\'");

						card.innerHTML = \`
							<div class="card-title">
								<span title="\${model.model_id}">\${model.label}</span>
								<div style="display:flex; gap:10px; align-items:center">
									<label class="switch" title="Toggle Status Bar Display">
										<input type="checkbox" \${isPinned ? 'checked' : ''} onchange="togglePin('\${safeId}')">
										<span class="slider"></span>
									</label>
									<span class="status-dot" style="background-color: \${color}"></span>
								</div>
							</div>
							<div class="progress-circle" style="background: conic-gradient(\${color} \${pct}%, #30363d \${pct}%);">
								<div class="percentage">\${pct.toFixed(0)}%</div>
							</div>
							<div class="info-row">
								<span>Reset In</span>
								<span class="info-value">\${model.time_until_reset_formatted}</span>
							</div>
							<div class="info-row">
								<span>Reset Time</span>
								<span class="info-value" style="font-size:11px">\${model.reset_time_display || 'N/A'}</span>
							</div>
							<div class="info-row">
								<span>Status</span>
								<span class="info-value" style="color: \${color}">\${model.is_exhausted ? 'Exhausted' : 'Active'}</span>
							</div>
						\`;
						dashboard.appendChild(card);
					});
				}
			</script>
		</body>
		</html>`;
	}
}
