/**
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';
import * as process from 'process';
import { WindowsStrategy, UnixStrategy } from './strategies';
import { logger } from '../shared/log_service';
import { EnvironmentScanResult, PlatformStrategy, ProcessInfo, ScanDiagnostics } from '../shared/types';
import { TIMING, PROCESS_NAMES, API_ENDPOINTS } from '../shared/constants';

const execAsync = promisify(exec);

/**
 */
export class ProcessHunter {
    private strategy: PlatformStrategy;
    private targetProcess: string;
    private lastDiagnostics: ScanDiagnostics = {
        scan_method: 'unknown',
        target_process: '',
        attempts: 0,
        found_candidates: 0,
    };

    constructor() {
        logger.debug('Initializing ProcessHunter...');
        logger.debug(`Platform: ${process.platform}, Arch: ${process.arch}`);

        if (process.platform === 'win32') {
            this.strategy = new WindowsStrategy();
            this.targetProcess = PROCESS_NAMES.windows;
            logger.debug('Using Windows Strategy');
        } else if (process.platform === 'darwin') {
            this.strategy = new UnixStrategy('darwin');
            this.targetProcess = process.arch === 'arm64' 
                ? PROCESS_NAMES.darwin_arm 
                : PROCESS_NAMES.darwin_x64;
            logger.debug('Using macOS Strategy');
        } else {
            this.strategy = new UnixStrategy('linux');
            this.targetProcess = PROCESS_NAMES.linux;
            logger.debug('Using Linux Strategy');
        }

        logger.debug(`Target Process: ${this.targetProcess}`);
    }

    /**
     */
    async scanEnvironment(maxAttempts: number = 3): Promise<EnvironmentScanResult | null> {
        logger.info(`Scanning environment, max attempts: ${maxAttempts}`);

        const resultByName = await this.scanByProcessName(maxAttempts);
        if (resultByName) {
            return resultByName;
        }

        logger.info('Process name search failed; keyword scan disabled in hardened mode');
        await this.runDiagnostics();

        return null;
    }

    /**
     */
    getLastDiagnostics(): ScanDiagnostics {
        return { ...this.lastDiagnostics };
    }

    /**
     */
    private async scanByProcessName(maxAttempts: number): Promise<EnvironmentScanResult | null> {
        let powershellTimeoutRetried = false;
        this.lastDiagnostics = {
            scan_method: 'process_name',
            target_process: this.targetProcess,
            attempts: maxAttempts,
            found_candidates: 0,
        };

        for (let i = 0; i < maxAttempts; i++) {
            logger.debug(`Attempt ${i + 1}/${maxAttempts} (by process name)...`);

            try {
                const cmd = this.strategy.getProcessListCommand(this.targetProcess);
                logger.debug(`Executing: ${cmd}`);

                const { stdout, stderr } = await execAsync(cmd, {
                    timeout: TIMING.PROCESS_CMD_TIMEOUT_MS,
                });

                if (stderr && stderr.trim()) {
                    logger.warn(`Command stderr: ${stderr.substring(0, 500)}`);
                }

                if (!stdout || !stdout.trim()) {
                    logger.debug('Command returned empty output, process may not be running');
                    continue;
                }

                const candidates = this.strategy.parseProcessInfo(stdout);

                if (candidates && candidates.length > 0) {
                    logger.info(`Found ${candidates.length} candidate process(es)`);
                    this.lastDiagnostics.found_candidates = candidates.length;
                    
                    for (const info of candidates) {
                        logger.info(`🔍 Checking Process: PID=${info.pid}, ExtPort=${info.extensionPort}`);
                        const result = await this.verifyAndConnect(info);
                        if (result) {
                            return result;
                        }
                    }
                    logger.warn('❌ All candidates failed verification in this attempt');
                }
            } catch (e) {
                const error = e instanceof Error ? e : new Error(String(e));
                const errorMsg = error.message.toLowerCase();
                
                const detailMsg = `Attempt ${i + 1} failed: ${error.message}`;
                logger.error(detailMsg);

                if (process.platform === 'win32' && this.strategy instanceof WindowsStrategy) {
                    
                    if (errorMsg.includes('cannot be loaded because running scripts is disabled') ||
                        errorMsg.includes('executionpolicy')) {
                        logger.error('⚠️ PowerShell execution policy may be blocking scripts. Try running: Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned');
                    }
                    
                    if (errorMsg.includes('rpc server') || 
                        errorMsg.includes('wmi') ||
                        errorMsg.includes('invalid class')) {
                        logger.error('⚠️ WMI service may not be running. Try: net start winmgmt');
                    }

                    if (!powershellTimeoutRetried &&
                        (errorMsg.includes('timeout') ||
                         errorMsg.includes('timed out'))) {
                        logger.warn('PowerShell command timed out (likely cold start), retrying with longer wait...');
                        powershellTimeoutRetried = true;
                        i--;
                        await new Promise(r => setTimeout(r, 3000));
                        continue;
                    }
                }
            }

            if (i < maxAttempts - 1) {
                await new Promise(r => setTimeout(r, TIMING.PROCESS_SCAN_RETRY_MS));
            }
        }

        return null;
    }

    /**
     */
    private async scanByKeyword(): Promise<EnvironmentScanResult | null> {
        if (process.platform !== 'win32' || !(this.strategy instanceof WindowsStrategy)) {
            return null;
        }

        this.lastDiagnostics = {
            scan_method: 'keyword',
            target_process: this.targetProcess,
            attempts: 1,
            found_candidates: 0,
        };

        const winStrategy = this.strategy as WindowsStrategy;

        try {
            const cmd = winStrategy.getProcessByKeywordCommand();
            logger.debug(`Keyword search command: ${cmd}`);

            const { stdout, stderr } = await execAsync(cmd, { 
                timeout: TIMING.PROCESS_CMD_TIMEOUT_MS, 
            });

            if (stderr) {
                logger.warn(`StdErr: ${stderr}`);
            }

            const candidates = this.strategy.parseProcessInfo(stdout);

            if (candidates && candidates.length > 0) {
                logger.info(`Found ${candidates.length} keyword candidate(s)`);
                this.lastDiagnostics.found_candidates = candidates.length;
                
                for (const info of candidates) {
                    logger.info(`🔍 Checking Keyword Candidate: PID=${info.pid}`);
                    const result = await this.verifyAndConnect(info);
                    if (result) {
                        return result;
                    }
                }
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            logger.error(`Keyword search failed: ${error.message}`);
        }

        return null;
    }

    /**
     */
    private async verifyAndConnect(info: ProcessInfo): Promise<EnvironmentScanResult | null> {
        if (info.extensionPort > 0) {
            const preferredPort = info.extensionPort;
            this.lastDiagnostics.ports = [preferredPort];
            const ok = await this.pingPort(preferredPort, info.csrfToken);
            this.lastDiagnostics.verified_port = ok ? preferredPort : null;
            this.lastDiagnostics.verification_success = ok;
            if (ok) {
                logger.info(`✅ Connection Logic Verified: ${preferredPort}`);
                return {
                    extensionPort: info.extensionPort,
                    connectPort: preferredPort,
                    csrfToken: info.csrfToken,
                };
            }
            logger.warn(`⚠️ Ping failed for ${preferredPort}; probing process ports`);
            const ports = await this.identifyPorts(info.pid);
            logger.debug(`Listening Ports: ${ports.join(', ')}`);
            this.lastDiagnostics.ports = ports.length > 0 ? ports : [preferredPort];
            if (ports.length > 0) {
                const validPort = await this.verifyConnection(ports, info.csrfToken);
                this.lastDiagnostics.verified_port = validPort ?? null;
                this.lastDiagnostics.verification_success = Boolean(validPort);
                if (validPort) {
                    logger.info(`✅ Connection Logic Verified: ${validPort}`);
                    return {
                        extensionPort: info.extensionPort,
                        connectPort: validPort,
                        csrfToken: info.csrfToken,
                    };
                }
                logger.warn('⚠️ No port verified; falling back to first detected port');
                return {
                    extensionPort: info.extensionPort,
                    connectPort: ports[0],
                    csrfToken: info.csrfToken,
                };
            }
            logger.warn('⚠️ No listening ports found; continuing with unverified connection');
            return {
                extensionPort: info.extensionPort,
                connectPort: preferredPort,
                csrfToken: info.csrfToken,
            };
        }

        const ports = await this.identifyPorts(info.pid);
        logger.debug(`Listening Ports: ${ports.join(', ')}`);
        this.lastDiagnostics.ports = ports;

        if (ports.length > 0) {
            const validPort = await this.verifyConnection(ports, info.csrfToken);
            this.lastDiagnostics.verified_port = validPort ?? null;
            this.lastDiagnostics.verification_success = Boolean(validPort);

            if (validPort) {
                logger.info(`✅ Connection Logic Verified: ${validPort}`);
                return {
                    extensionPort: info.extensionPort,
                    connectPort: validPort,
                    csrfToken: info.csrfToken,
                };
            }
            logger.warn('⚠️ No port verified; falling back to first detected port');
            return {
                extensionPort: info.extensionPort,
                connectPort: ports[0],
                csrfToken: info.csrfToken,
            };
        }

        return null;
    }

    /**
     */
    private async runDiagnostics(): Promise<void> {
        logger.warn('⚠️ All scan attempts failed; diagnostics disabled in hardened mode.');
        logger.info(`Target process name: ${this.targetProcess}`);
        logger.info(`Platform: ${process.platform}, Arch: ${process.arch}`);

        if (process.platform === 'win32') {
            logger.info('Tips: ensure Antigravity is running, check Task Manager for language_server_windows_x64.exe.');
        } else {
            logger.info('Tips: ensure Antigravity is running and the language_server process is alive.');
        }
    }

    /**
     */
    private async identifyPorts(pid: number): Promise<number[]> {
        try {
            if (this.strategy instanceof UnixStrategy) {
                await this.strategy.ensurePortCommandAvailable();
            }
            
            const cmd = this.strategy.getPortListCommand(pid);
            const { stdout } = await execAsync(cmd);
            return this.strategy.parseListeningPorts(stdout);
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            logger.error(`Port identification failed: ${error.message}`);
            return [];
        }
    }

    /**
     */
    private async verifyConnection(ports: number[], token: string): Promise<number | null> {
        for (const port of ports) {
            if (await this.pingPort(port, token)) {
                return port;
            }
        }
        return null;
    }

    /**
     */
    private pingPort(port: number, token: string): Promise<boolean> {
        const payload = JSON.stringify({
            metadata: {
                ideName: 'antigravity',
                extensionName: 'antigravity',
                locale: 'en',
            },
        });

        const attempt = (path: string): Promise<boolean> => new Promise(resolve => {
            const options: https.RequestOptions = {
                hostname: '127.0.0.1',
                port,
                path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    'X-Codeium-Csrf-Token': token,
                    'Connect-Protocol-Version': '1',
                },
                rejectUnauthorized: false,
                timeout: TIMING.PROCESS_CMD_TIMEOUT_MS,
                agent: false,
            };

            const req = https.request(options, res => {
                if (res.statusCode === 404) {
                    resolve(false);
                    return;
                }
                const ok = res.statusCode === 200 || res.statusCode === 400 || res.statusCode === 401 || res.statusCode === 403;
                resolve(ok);
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
            req.write(payload);
            req.end();
        });

        const paths = [API_ENDPOINTS.GET_USER_STATUS, API_ENDPOINTS.GET_USER_STATUS_SEAT];
        return attempt(paths[0]).then(ok => {
            if (ok) {
                return true;
            }
            return attempt(paths[1]);
        });
    }

    /**
     */
    getErrorMessages(): { processNotFound: string; commandNotAvailable: string; requirements: string[] } {
        return this.strategy.getErrorMessages();
    }
}

export type environment_scan_result = EnvironmentScanResult;
