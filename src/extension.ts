import * as vscode from 'vscode';
import {ProcessHunter} from './engine/hunter';
import {ReactorCore} from './engine/reactor';
import {logger} from './shared/log_service';
import {CockpitHUD} from './view/hud';

let hunter: ProcessHunter;
let reactor: ReactorCore;
let hud: CockpitHUD;
let statusBarItem: vscode.StatusBarItem;
let system_online = false;
let pulse_frequency = 60000; // 60s default

export async function activate(context: vscode.ExtensionContext) {
	logger.init();
	logger.info('Antigravity Cockpit Systems: Online');

	hunter = new ProcessHunter();
	reactor = new ReactorCore();
	hud = new CockpitHUD(context.extensionUri);

	// Status Bar
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'agCockpit.open';
	statusBarItem.text = '$(rocket) Cockpit: Init...';
	statusBarItem.tooltip = 'Click to engage Antigravity Cockpit';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	// Commands
	context.subscriptions.push(
		vscode.commands.registerCommand('agCockpit.open', () => {
			hud.reveal_hud();
		})
	);

	// Handle messages from Webview
	hud.on_signal(async (message) => {
		const config = vscode.workspace.getConfiguration('agCockpit');
		
		if (message.command === 'togglePin') {
			const modelId = message.modelId;
			let pinnedModels = config.get<string[]>('pinnedModels', []);
			
			if (pinnedModels.includes(modelId)) {
				pinnedModels = pinnedModels.filter(id => id !== modelId);
			} else {
				pinnedModels.push(modelId);
			}
			
			await config.update('pinnedModels', pinnedModels, vscode.ConfigurationTarget.Global);
			// Trigger refresh to update UI immediately
			reactor.sync_telemetry();
		} 
		
		if (message.command === 'toggleCredits') {
			const current = config.get<boolean>('showPromptCredits', false);
			await config.update('showPromptCredits', !current, vscode.ConfigurationTarget.Global);
			reactor.sync_telemetry();
		}

		if (message.command === 'updateOrder') {
			const newOrder = message.order;
			await config.update('modelOrder', newOrder, vscode.ConfigurationTarget.Global);
			// No need to fetch quota, just update UI might be enough, but fetch is safer to ensure state consistency
			reactor.sync_telemetry();
		}

		if (message.command === 'refresh') {
			reactor.sync_telemetry();
		}

		if (message.command === 'init') {
			// 1. Immediately restore from cache (instant feedback)
			hud.rehydrate();
			// 2. Then try to fetch fresh data
			reactor.sync_telemetry();
		}
	});

	// Events
	reactor.on_telemetry(snapshot => {
		// Get latest config
		const config = vscode.workspace.getConfiguration('agCockpit');
		const showPromptCredits = config.get<boolean>('showPromptCredits', false);
		const pinnedModels = config.get<string[]>('pinnedModels', []);
		const modelOrder = config.get<string[]>('modelOrder', []);

		// Update Dashboard with config
		hud.refresh_view(snapshot, { showPromptCredits, pinnedModels, modelOrder });

		// Update Status Bar
		let statusTextParts: string[] = [];
		let minPercentage = 100;

		// 1. Add Pinned Models
		const monitoredModels = snapshot.models.filter(m => 
			pinnedModels.some(p => p.toLowerCase() === m.model_id.toLowerCase() || p.toLowerCase() === m.label.toLowerCase())
		);

		if (monitoredModels.length > 0) {
			// Show specific pinned models
			monitoredModels.forEach(m => {
				const pct = m.remaining_percentage !== undefined ? m.remaining_percentage : 0;
				statusTextParts.push(`${m.label}: ${pct.toFixed(0)}%`);
				if (pct < minPercentage) minPercentage = pct;
			});
		} else {
			// If nothing pinned, show lowest of all models (default behavior)
			let lowestModel = snapshot.models[0];
			let lowestPct = 100;
			
			snapshot.models.forEach(m => {
				const pct = m.remaining_percentage !== undefined ? m.remaining_percentage : 0;
				if (pct < lowestPct) {
					lowestPct = pct;
					lowestModel = m;
				}
			});

			if (lowestModel) {
				statusTextParts.push(`Lowest: ${lowestPct.toFixed(0)}%`);
				minPercentage = lowestPct;
			}
		}

		// 2. Add Prompt Credits (if enabled)
		if (showPromptCredits && snapshot.prompt_credits) {
			const pct = snapshot.prompt_credits.remaining_percentage;
			statusTextParts.push(`Credits: ${pct.toFixed(0)}%`);
			if (pct < minPercentage) minPercentage = pct;
		}

		// 3. Render Status Bar
		if (statusTextParts.length > 0) {
			statusBarItem.text = `$(rocket) ${statusTextParts.join('  |  ')}`;
		} else {
			statusBarItem.text = `$(rocket) Cockpit: Ready`;
		}
		
		// Color logic (red if any monitored item is low)
		if (minPercentage < 20) {
			statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
		} else {
			statusBarItem.backgroundColor = undefined;
		}
	});

	reactor.on_malfunction(err => {
		statusBarItem.text = '$(error) Cockpit Failure';
		statusBarItem.tooltip = err.message;
	});

	// Get Config
	const config = vscode.workspace.getConfiguration('agCockpit');
	pulse_frequency = (config.get<number>('refreshInterval') || 60) * 1000;

	// Init
	boot_systems().catch(e => logger.error('Boot sequence failed', e));

	logger.info('Antigravity Cockpit Fully Operational');
}

async function boot_systems() {
	if (system_online) return;

	statusBarItem.text = '$(sync~spin) Cockpit: Connecting...';
	
	try {
		const info = await hunter.scan_environment(3); // Retry 3 times
		if (info) {
			reactor.engage(info.connect_port, info.csrf_token);
			reactor.start_reactor(pulse_frequency);
			system_online = true;
			statusBarItem.text = '$(rocket) Cockpit: Ready';
		} else {
			statusBarItem.text = '$(error) Cockpit: Offline';
			vscode.window.showErrorMessage('Antigravity Cockpit: Systems offline. Could not detect environment process.');
		}
	} catch (e) {
		logger.error('Boot Error', e);
		statusBarItem.text = '$(error) Cockpit: Error';
	}
}

export function deactivate() {
	reactor?.shutdown();
}
