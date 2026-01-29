/**
 */

import * as https from 'https';
import { 
    QuotaSnapshot, 
    ModelQuotaInfo, 
    PromptCreditsInfo, 
    ServerUserStatusResponse,
    ClientModelConfig,
    QuotaGroup,
    ScanDiagnostics,
    UserInfo,
} from '../shared/types';
import { logger } from '../shared/log_service';
import { configService } from '../shared/config_service';
import { t } from '../shared/i18n';
import { TIMING, API_ENDPOINTS } from '../shared/constants';
import { AntigravityError, isServerError } from '../shared/errors';
import { readQuotaCache, writeQuotaCache, QuotaCacheModel, QuotaCacheRecord, QuotaCacheSource } from '../services/quota_cache';


/**
 */
export class ReactorCore {
    private port: number = 0;
    private token: string = '';

    private updateHandler?: (data: QuotaSnapshot) => void;
    private errorHandler?: (error: Error) => void;
    private pulseTimer?: ReturnType<typeof setInterval>;
    public currentInterval: number = 0;
    private lastScanDiagnostics?: ScanDiagnostics;
    
    private lastSnapshot?: QuotaSnapshot;
    private lastRawResponse?: ServerUserStatusResponse;
    private lastLocalFetchedAt?: number;
    private hasSuccessfulSync: boolean = false;
    private initRetryToken: number = 0;
    private activeModelId?: string;

    constructor() {
        logger.debug('ReactorCore Online');
    }

    /**
     */
    engage(port: number, token: string, diagnostics?: ScanDiagnostics): void {
        this.port = port;
        this.token = token;
        this.lastScanDiagnostics = diagnostics;
        logger.info(`Reactor Engaged: :${port}`);
    }

    /**
     */
    getLatestSnapshot(): QuotaSnapshot | undefined {
        return this.lastSnapshot;
    }

    setActiveModelId(modelId?: string): void {
        const normalized = modelId?.trim();
        const next = normalized && normalized.length > 0 ? normalized : undefined;
        if (this.activeModelId === next) {
            return;
        }
        this.activeModelId = next;
        if (this.lastSnapshot) {
            this.lastSnapshot.activeModelId = next;
        }
        if (this.updateHandler) {
            this.reprocess();
        }
    }

    private formatCacheModels(models: ModelQuotaInfo[]): QuotaCacheModel[] {
        return models.map((model) => ({
            id: model.modelId,
            displayName: model.label,
            remainingPercentage: model.remainingPercentage,
            remainingFraction: model.remainingFraction,
            resetTime: model.resetTime?.toISOString(),
            isRecommended: model.isRecommended,
            tagTitle: model.tagTitle,
            supportsImages: model.supportsImages,
            supportedMimeTypes: model.supportedMimeTypes,
        }));
    }

    private buildModelsFromCache(models: QuotaCacheModel[]): ModelQuotaInfo[] {
        const now = Date.now();
        return models.map((model) => {
            const label = model.displayName || model.id;
            const remainingPercentage = model.remainingPercentage ?? (
                model.remainingFraction !== undefined ? model.remainingFraction * 100 : undefined
            );
            const remainingFraction = model.remainingFraction ?? (
                remainingPercentage !== undefined ? remainingPercentage / 100 : undefined
            );
            let resetTime = model.resetTime ? new Date(model.resetTime) : new Date(now + 24 * 60 * 60 * 1000);
            let resetTimeValid = true;
            if (Number.isNaN(resetTime.getTime())) {
                resetTime = new Date(now + 24 * 60 * 60 * 1000);
                resetTimeValid = false;
            }
            const timeUntilReset = Math.max(0, resetTime.getTime() - now);
            return {
                label,
                modelId: model.id,
                remainingFraction,
                remainingPercentage,
                isExhausted: (remainingFraction ?? 0) <= 0,
                resetTime,
                resetTimeDisplay: resetTimeValid ? this.formatIso(resetTime) : (t('common.unknown') || 'Unknown'),
                timeUntilReset,
                timeUntilResetFormatted: resetTimeValid ? this.formatDelta(timeUntilReset) : (t('common.unknown') || 'Unknown'),
                resetTimeValid,
                supportsImages: model.supportsImages,
                isRecommended: model.isRecommended,
                tagTitle: model.tagTitle,
                supportedMimeTypes: model.supportedMimeTypes,
            };
        });
    }

    private async persistQuotaCache(
        source: QuotaCacheSource,
        email: string | null,
        telemetry: QuotaSnapshot,
    ): Promise<void> {
        if (!email) {
            return;
        }
        const models = telemetry.allModels && telemetry.allModels.length > 0
            ? telemetry.allModels
            : telemetry.models;
        const record: QuotaCacheRecord = {
            version: 1,
            source,
            email,
            updatedAt: Date.now(),
            subscriptionTier: telemetry.userInfo?.tier && telemetry.userInfo.tier !== 'N/A'
                ? telemetry.userInfo.tier
                : undefined,
            isForbidden: false,
            models: this.formatCacheModels(models),
        };
        try {
            await writeQuotaCache(record);
        } catch (error) {
            logger.debug(`[QuotaCache] Failed to write cache: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    public async tryUseQuotaCache(
        source: QuotaCacheSource,
        email: string | null,
    ): Promise<boolean> {
        if (!email) {
            return false;
        }
        const record = await readQuotaCache(source, email);
        if (!record || !record.models?.length) {
            return false;
        }
        const models = this.buildModelsFromCache(record.models);
        if (models.length === 0) {
            return false;
        }
        const telemetry = this.buildSnapshot(models);
        this.publishTelemetry(telemetry, source);
        return true;
    }

    /**
     */
    private async transmit<T>(endpoint: string, payload: object): Promise<T> {
        return new Promise((resolve, reject) => {
            // Guard against unengaged reactor
            if (!this.port) {
                reject(new AntigravityError('Antigravity Error: System not ready (Reactor not engaged)'));
                return;
            }

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
                timeout: TIMING.HTTP_TIMEOUT_MS,
                agent: false,
            };

            logger.info(`Transmitting signal to ${endpoint}`, JSON.parse(data));

            const req = https.request(opts, res => {
                let body = '';
                res.on('data', c => (body += c));
                res.on('end', () => {
                    logger.info(`Signal Received (${res.statusCode}):`, {
                        statusCode: res.statusCode,
                        bodyLength: body.length,
                    });

                    // Check for empty body (often happens during process startup)
                    if (!body || body.trim().length === 0) {
                        logger.warn('Received empty response from API');
                        reject(new Error('Signal Corrupted: Empty response from server'));
                        return;
                    }

                    if (res.statusCode === 404 || /404 page not found/i.test(body)) {
                        reject(new Error(`Not Found: ${endpoint}`));
                        return;
                    }

                    try {
                        resolve(JSON.parse(body) as T);
                    } catch (e) {
                        const error = e instanceof Error ? e : new Error(String(e));
                        
                        // Log body preview for diagnosis
                        const bodyPreview = body.length > 200 ? body.substring(0, 200) + '...' : body;
                        logger.error(`JSON parse failed. Response preview: ${bodyPreview}`);
                        
                        reject(new Error(`Signal Corrupted: ${error.message}`));
                    }
                });
            });

            req.on('error', (e) => reject(new Error(`Connection Failed: ${e.message}`)));
            req.on('timeout', () => {
                req.destroy();
                reject(new AntigravityError('Signal Lost: Request timed out'));
            });

            req.write(data);
            req.end();
        });
    }

    /**
     */
    onTelemetry(cb: (data: QuotaSnapshot) => void): void {
        this.updateHandler = cb;
    }

    /**
     */
    onMalfunction(cb: (error: Error) => void): void {
        this.errorHandler = cb;
    }

    /**
     */
    startReactor(interval: number): void {
        this.shutdown();
        this.currentInterval = interval;
        logger.info(`Reactor Pulse: ${interval}ms`);

        this.initRetryToken += 1;
        const retryToken = this.initRetryToken;
        this.initAfterReady(retryToken);

        this.pulseTimer = setInterval(() => {
            this.syncTelemetry();
        }, interval);
    }

    private async initAfterReady(retryToken: number): Promise<void> {
        const ready = await this.waitForServerReady(retryToken);
        if (!ready || retryToken !== this.initRetryToken) {
            return;
        }
        this.initWithRetry(3, 0, retryToken);
    }

    private async waitForServerReady(retryToken: number): Promise<boolean> {
        const maxWaitMs = 10000;
        const pollIntervalMs = 500;
        const start = Date.now();
        while (Date.now() - start < maxWaitMs) {
            if (retryToken !== this.initRetryToken) {
                return false;
            }
            const ok = await this.probeReady();
            if (ok) {
                return true;
            }
            await this.delay(pollIntervalMs);
        }
        logger.warn('[ReactorCore] Server not ready after wait; continuing with init');
        return true;
    }

    private async probeReady(): Promise<boolean> {
        const payload = JSON.stringify({
            metadata: {
                ideName: 'antigravity',
                extensionName: 'antigravity',
                locale: 'en',
            },
        });

        const probe = (path: string): Promise<boolean> => new Promise(resolve => {
            const opts: https.RequestOptions = {
                hostname: '127.0.0.1',
                port: this.port,
                path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    'Connect-Protocol-Version': '1',
                    'X-Codeium-Csrf-Token': this.token,
                },
                rejectUnauthorized: false,
                timeout: 2000,
                agent: false,
            };

            const req = https.request(opts, res => {
                let body = '';
                res.on('data', c => (body += c));
                res.on('end', () => {
                    if (res.statusCode === 404 || /404 page not found/i.test(body)) {
                        resolve(false);
                        return;
                    }
                    const ok = res.statusCode === 200 || res.statusCode === 400 || res.statusCode === 401 || res.statusCode === 403;
                    resolve(ok);
                });
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
            req.write(payload);
            req.end();
        });

        if (await probe(API_ENDPOINTS.GET_USER_STATUS)) {
            return true;
        }
        return probe(API_ENDPOINTS.GET_USER_STATUS_SEAT);
    }

    /**
     */
    private async initWithRetry(
        maxRetries: number = 3,
        currentRetry: number = 0,
        retryToken: number = this.initRetryToken,
    ): Promise<void> {
        if (retryToken !== this.initRetryToken) {
            logger.info('Init sync retry canceled');
            return;
        }
        try {
            await this.syncTelemetryCore();
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            const source = this.getSyncErrorSource(err);
            const endpoint = API_ENDPOINTS.GET_USER_STATUS;
            if (this.shouldIgnoreSyncError(err)) {
                logger.info(`[ReactorCore] Ignoring ${this.getSyncErrorSource(err)} init error after source switch: ${err.message}`);
                return;
            }
            
            if (retryToken !== this.initRetryToken) {
                logger.info('Init sync retry canceled after error');
                return;
            }
            if (currentRetry < maxRetries) {
                const delay = 2000 * (currentRetry + 1);  // 2s, 4s, 6s
                const sourceInfo = source ? `source=${source}` : 'source=unknown';
                const endpointInfo = `endpoint=${endpoint}`;
                logger.warn(`Init sync failed (${sourceInfo}, ${endpointInfo}), retry ${currentRetry + 1}/${maxRetries} in ${delay}ms: ${err.message}`);
                
                await this.delay(delay);
                return this.initWithRetry(maxRetries, currentRetry + 1, retryToken);
            }
            
            const sourceInfo = source ? `source=${source}` : 'source=unknown';
            const endpointInfo = `endpoint=${endpoint}`;
            logger.error(`Init sync failed after ${maxRetries} retries (${sourceInfo}, ${endpointInfo}): ${err.message}`);
            
            if (!isServerError(err)) {
                logger.warn(`[Init] Initial sync failed: ${err.message}`);
            }
            if (this.errorHandler) {
                this.errorHandler(err);
            }
        }
    }

    /**
     */
    cancelInitRetry(): void {
        this.initRetryToken += 1;
    }

    private wrapSyncError(error: unknown, source: 'local'): Error {
        const err = error instanceof Error ? error : new Error(String(error));
        (err as Error & { source?: string }).source = source;
        return err;
    }

    private getSyncErrorSource(error: Error): string | undefined {
        return (error as Error & { source?: string }).source;
    }

    private shouldIgnoreSyncError(error: Error): boolean {
        const source = this.getSyncErrorSource(error);
        return Boolean(source && source !== 'local');
    }

    /**
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     */
    shutdown(): void {
        if (this.pulseTimer) {
            clearInterval(this.pulseTimer);
            this.pulseTimer = undefined;
        }
    }

    /**
     */
    async syncTelemetry(): Promise<void> {
        try {
            await this.syncTelemetryCore();
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            if (this.shouldIgnoreSyncError(err)) {
                logger.info(`[ReactorCore] Ignoring ${this.getSyncErrorSource(err)} sync error after source switch: ${err.message}`);
                return;
            }
            const source = this.getSyncErrorSource(err);
            const sourceInfo = source ? `source=${source}` : 'source=local';
            logger.error(`Telemetry Sync Failed (${sourceInfo}, endpoint=${API_ENDPOINTS.GET_USER_STATUS}): ${err.message}`);
            
            if (!this.hasSuccessfulSync && !isServerError(err)) {
                logger.warn(`[Telemetry] Initial sync failed: ${err.message}`);
            }
            if (this.errorHandler) {
                this.errorHandler(err);
            }
        }
    }

    /**
     */
    private async syncTelemetryCore(): Promise<void> {
        try {
            const telemetry = await this.fetchLocalTelemetry();
            const rawEmail = telemetry.userInfo?.email || null;
            const cacheEmail = rawEmail && rawEmail.includes('@') ? rawEmail : null;
            await this.persistQuotaCache('local', cacheEmail, telemetry);
            this.publishTelemetry(telemetry, 'local');
        } catch (error) {
            throw this.wrapSyncError(error, 'local');
        }
    }

    private async fetchLocalTelemetry(): Promise<QuotaSnapshot> {
        const payload = {
            metadata: {
                ideName: 'antigravity',
                extensionName: 'antigravity',
                locale: 'en',
            },
        };

        const maxAttempts = 4;
        const delays = [500, 1000, 2000];

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            let raw: ServerUserStatusResponse;
            try {
                raw = await this.transmit<ServerUserStatusResponse>(
                    API_ENDPOINTS.GET_USER_STATUS,
                    payload,
                );
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                if (/Not Found:/i.test(err.message)) {
                    raw = await this.transmit<ServerUserStatusResponse>(
                        API_ENDPOINTS.GET_USER_STATUS_SEAT,
                        payload,
                    );
                } else {
                    throw err;
                }
            }
            this.lastRawResponse = raw;
            this.lastLocalFetchedAt = Date.now();
            try {
                return this.decodeSignal(raw);
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                if (!this.isLanguageServerNotReady(err) || attempt >= maxAttempts - 1) {
                    throw err;
                }
                logger.warn(`[ReactorCore] Language server not ready; warmup and retry ${attempt + 1}/${maxAttempts - 1}: ${err.message}`);
                await this.warmupLanguageServer();
                await this.delay(delays[Math.min(attempt, delays.length - 1)]);
            }
        }

        throw new Error('Language server not ready after retries');
    }

    private isLanguageServerNotReady(error: Error): boolean {
        return /LanguageServerClient must be initialized first/i.test(error.message);
    }

    private async warmupLanguageServer(): Promise<void> {
        if (!this.port) {
            return;
        }
        await new Promise<void>((resolve) => {
            const data = JSON.stringify({ wrapper_data: {} });
            const opts: https.RequestOptions = {
                hostname: '127.0.0.1',
                port: this.port,
                path: API_ENDPOINTS.GET_UNLEASH_DATA,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    'Connect-Protocol-Version': '1',
                    'X-Codeium-Csrf-Token': this.token,
                },
                timeout: 3000,
                agent: false,
            };

            const req = https.request(opts, () => resolve());
            req.on('error', () => resolve());
            req.on('timeout', () => {
                req.destroy();
                resolve();
            });
            req.write(data);
            req.end();
        });
    }

    private async tryFetchLocalTelemetry(): Promise<QuotaSnapshot | null> {
        if (!this.port || !this.token) {
            return null;
        }
        try {
            return await this.fetchLocalTelemetry();
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.debug(`[LocalQuota] Local fetch failed: ${err.message}`);
            return null;
        }
    }

    /**
     */
    private publishTelemetry(telemetry: QuotaSnapshot, _source?: 'local'): void {
        telemetry.activeModelId = this.activeModelId;
        this.lastSnapshot = telemetry; // Cache the latest snapshot

        if (telemetry.models.length > 0) {
            const maxLabelLen = Math.max(...telemetry.models.map(m => m.label.length));
            const quotaSummary = telemetry.models.map(m => {
                const pct = m.remainingPercentage !== undefined ? m.remainingPercentage.toFixed(2) + '%' : 'N/A';
                return `    ${m.label.padEnd(maxLabelLen)} : ${pct}`;
            }).join('\n');
            
            logger.info(`Quota Update:\n${quotaSummary}`);
        } else {
            logger.info('Quota Update: No models available');
        }

        this.hasSuccessfulSync = true;

        if (this.updateHandler) {
            this.updateHandler(telemetry);
        }
    }

    /**
     */
    reprocess(): void {
        if (this.lastRawResponse && this.updateHandler) {
            logger.info('Reprocessing cached local telemetry data with latest config');
            const telemetry = this.decodeSignal(this.lastRawResponse);
            this.publishTelemetry(telemetry, 'local');
            return;
        }

        if (this.lastSnapshot && this.updateHandler) {
            logger.info('Reprocessing cached snapshot (no raw response)');
            this.updateHandler(this.lastSnapshot);
            return;
        }

        logger.warn('Cannot reprocess: no cached data available, triggering sync');
        this.syncTelemetry();
    }

    /**
     */
    get hasCache(): boolean {
        return !!this.lastSnapshot;
    }

    /**
     */
    getCacheAgeMs(): number | undefined {
        if (!this.lastLocalFetchedAt) {
            return undefined;
        }
        return Date.now() - this.lastLocalFetchedAt;
    }

    /**
     */
    publishCachedTelemetry(): boolean {
        if (!this.updateHandler) {
            return false;
        }

        if (this.lastRawResponse) {
            const telemetry = this.decodeSignal(this.lastRawResponse);
            this.publishTelemetry(telemetry, 'local');
            return true;
        }

        return false;
    }

    /**
     */
    private decodeSignal(data: ServerUserStatusResponse): QuotaSnapshot {
        if (!data || !data.userStatus) {
            if (data && typeof data.message === 'string') {
                throw new AntigravityError(t('error.serverError', { message: data.message }));
            }

            throw new Error(t('error.invalidResponse', { 
                details: data ? JSON.stringify(data).substring(0, 100) : 'empty response', 
            }));
        }
        
        const status = data.userStatus;
        const plan = status.planStatus?.planInfo;
        const credits = status.planStatus?.availablePromptCredits;

        let promptCredits: PromptCreditsInfo | undefined;

        if (plan && credits !== undefined) {
            const monthlyLimit = Number(plan.monthlyPromptCredits);
            const availableVal = Number(credits);

            if (monthlyLimit > 0) {
                promptCredits = {
                    available: availableVal,
                    monthly: monthlyLimit,
                    usedPercentage: ((monthlyLimit - availableVal) / monthlyLimit) * 100,
                    remainingPercentage: (availableVal / monthlyLimit) * 100,
                };
            }
        }

        const userInfo: UserInfo = {
            name: status.name || 'Unknown User',
            email: status.email || 'N/A',
            planName: plan?.planName || 'N/A',
            tier: status.userTier?.name || plan?.teamsTier || 'N/A',
            browserEnabled: plan?.browserEnabled === true,
            knowledgeBaseEnabled: plan?.knowledgeBaseEnabled === true,
            canBuyMoreCredits: plan?.canBuyMoreCredits === true,
            hasAutocompleteFastMode: plan?.hasAutocompleteFastMode === true,
            monthlyPromptCredits: plan?.monthlyPromptCredits || 0,
            monthlyFlowCredits: plan?.monthlyFlowCredits || 0,
            availablePromptCredits: status.planStatus?.availablePromptCredits || 0,
            availableFlowCredits: status.planStatus?.availableFlowCredits || 0,
            cascadeWebSearchEnabled: plan?.cascadeWebSearchEnabled === true,
            canGenerateCommitMessages: plan?.canGenerateCommitMessages === true,
            allowMcpServers: plan?.defaultTeamConfig?.allowMcpServers === true,
            maxNumChatInputTokens: String(plan?.maxNumChatInputTokens ?? 'N/A'),
            tierDescription: status.userTier?.description || 'N/A',
            upgradeUri: status.userTier?.upgradeSubscriptionUri || '',
            upgradeText: status.userTier?.upgradeSubscriptionText || '',
            
            // New fields population
            teamsTier: plan?.teamsTier || 'N/A',
            hasTabToJump: plan?.hasTabToJump === true,
            allowStickyPremiumModels: plan?.allowStickyPremiumModels === true,
            allowPremiumCommandModels: plan?.allowPremiumCommandModels === true,
            maxNumPremiumChatMessages: String(plan?.maxNumPremiumChatMessages ?? 'N/A'),
            maxCustomChatInstructionCharacters: String(plan?.maxCustomChatInstructionCharacters ?? 'N/A'),
            maxNumPinnedContextItems: String(plan?.maxNumPinnedContextItems ?? 'N/A'),
            maxLocalIndexSize: String(plan?.maxLocalIndexSize ?? 'N/A'),
            monthlyFlexCreditPurchaseAmount: Number(plan?.monthlyFlexCreditPurchaseAmount) || 0,
            canCustomizeAppIcon: plan?.canCustomizeAppIcon === true,
            cascadeCanAutoRunCommands: plan?.cascadeCanAutoRunCommands === true,
            canAllowCascadeInBackground: plan?.canAllowCascadeInBackground === true,
            allowAutoRunCommands: plan?.defaultTeamConfig?.allowAutoRunCommands === true,
            allowBrowserExperimentalFeatures: plan?.defaultTeamConfig?.allowBrowserExperimentalFeatures === true,
            acceptedLatestTermsOfService: status.acceptedLatestTermsOfService === true,
            userTierId: status.userTier?.id || 'N/A',
        };

        const configs: ClientModelConfig[] = status.cascadeModelConfigData?.clientModelConfigs || [];
        const modelSorts = status.cascadeModelConfigData?.clientModelSorts || [];

        const sortOrderMap = new Map<string, number>();
        if (modelSorts.length > 0) {
            const primarySort = modelSorts[0];
            let index = 0;
            for (const group of primarySort.groups) {
                for (const label of group.modelLabels) {
                    sortOrderMap.set(label, index++);
                }
            }
        }

        const models: ModelQuotaInfo[] = configs
            .filter((m): m is ClientModelConfig & { quotaInfo: NonNullable<ClientModelConfig['quotaInfo']> } => 
                !!m.quotaInfo,
            )
            .map((m) => {
                const now = new Date();
                let reset = new Date(m.quotaInfo.resetTime);
                let resetTimeValid = true;
                if (Number.isNaN(reset.getTime())) {
                    reset = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                    resetTimeValid = false;
                    logger.warn(`[ReactorCore] Invalid resetTime for model ${m.label}: ${m.quotaInfo.resetTime}`);
                }
                const delta = reset.getTime() - now.getTime();

                return {
                    label: m.label,
                    modelId: m.modelOrAlias?.model || 'unknown',
                    remainingFraction: m.quotaInfo.remainingFraction,
                    remainingPercentage: m.quotaInfo.remainingFraction !== undefined 
                        ? m.quotaInfo.remainingFraction * 100 
                        : undefined,
                    isExhausted: m.quotaInfo.remainingFraction === 0,
                    resetTime: reset,
                    resetTimeDisplay: resetTimeValid ? this.formatIso(reset) : (t('common.unknown') || 'Unknown'),
                    timeUntilReset: delta,
                    timeUntilResetFormatted: resetTimeValid ? this.formatDelta(delta) : (t('common.unknown') || 'Unknown'),
                    resetTimeValid,
                    supportsImages: m.supportsImages,
                    isRecommended: m.isRecommended,
                    tagTitle: m.tagTitle,
                    supportedMimeTypes: m.supportedMimeTypes,
                };
            });

        models.sort((a, b) => {
            const indexA = sortOrderMap.get(a.label);
            const indexB = sortOrderMap.get(b.label);

            if (indexA !== undefined && indexB !== undefined) {
                return indexA - indexB;
            }
            if (indexA !== undefined) {
                return -1;
            }
            if (indexB !== undefined) {
                return 1;
            }
            return a.label.localeCompare(b.label);
        });

        return this.buildSnapshot(models, promptCredits, userInfo);
    }

    private buildSnapshot(
        models: ModelQuotaInfo[],
        promptCredits?: PromptCreditsInfo,
        userInfo?: UserInfo,
    ): QuotaSnapshot {
        const config = configService.getConfig();
        const allModels = [...models];

        const visibleModels = config.visibleModels ?? [];
        if (visibleModels.length > 0) {
            const visibleSet = new Set(visibleModels);
            const filteredModels = models.filter(model => visibleSet.has(model.modelId));
            
            if (filteredModels.length === 0 && models.length > 0) {
                logger.warn('[buildSnapshot] Visible models filter resulted in empty list. ' +
                    `Original: ${models.length}, Visible config: ${visibleModels.length}. ` +
                    'Showing all recommended models instead.');
            } else {
                models = filteredModels;
            }
        }

        let groups: QuotaGroup[] | undefined;
        
        if (config.groupingEnabled) {
            const groupMap = new Map<string, ModelQuotaInfo[]>();
            const savedMappings = config.groupMappings;
            const hasSavedMappings = Object.keys(savedMappings).length > 0;
            
            if (hasSavedMappings) {
                for (const model of models) {
                    const groupId = savedMappings[model.modelId];
                    if (groupId) {
                        if (!groupMap.has(groupId)) {
                            groupMap.set(groupId, []);
                        }
                        groupMap.get(groupId)!.push(model);
                    } else {
                        groupMap.set(model.modelId, [model]);
                    }
                }
                
                const modelsToRemove: string[] = [];
                
                for (const [groupId, groupModels] of groupMap) {
                    if (groupModels.length <= 1) {
                        continue;
                    }
                    
                    const signatureCount = new Map<string, { count: number; fraction: number; resetTime: number }>();
                    
                    for (const model of groupModels) {
                        const fraction = model.remainingFraction ?? 0;
                        const resetTime = model.resetTime.getTime();
                        const signature = `${fraction.toFixed(6)}_${resetTime}`;
                        
                        if (!signatureCount.has(signature)) {
                            signatureCount.set(signature, { count: 0, fraction, resetTime });
                        }
                        signatureCount.get(signature)!.count++;
                    }
                    
                    let majoritySignature = '';
                    let maxCount = 0;
                    for (const [sig, data] of signatureCount) {
                        if (data.count > maxCount) {
                            maxCount = data.count;
                            majoritySignature = sig;
                        }
                    }
                    
                    for (const model of groupModels) {
                        const fraction = model.remainingFraction ?? 0;
                        const resetTime = model.resetTime.getTime();
                        const signature = `${fraction.toFixed(6)}_${resetTime}`;
                        
                        if (signature !== majoritySignature) {
                            logger.info(`[GroupCheck] Removing model "${model.label}" from group "${groupId}" due to quota mismatch`);
                            modelsToRemove.push(model.modelId);
                        }
                    }
                }
                
                if (modelsToRemove.length > 0) {
                    const newMappings = { ...savedMappings };
                    for (const modelId of modelsToRemove) {
                        delete newMappings[modelId];
                    }
                    
                    configService.updateGroupMappings(newMappings).catch(err => {
                        logger.warn(`Failed to save updated groupMappings: ${err}`);
                    });
                    
                    for (const modelId of modelsToRemove) {
                        for (const [_gid, gModels] of groupMap) {
                            const idx = gModels.findIndex(m => m.modelId === modelId);
                            if (idx !== -1) {
                                const [removedModel] = gModels.splice(idx, 1);
                                groupMap.set(modelId, [removedModel]);
                                break;
                            }
                        }
                    }
                    
                    for (const [gid, gModels] of groupMap) {
                        if (gModels.length === 0) {
                            groupMap.delete(gid);
                        }
                    }
                    
                    logger.info(`[GroupCheck] Removed ${modelsToRemove.length} models from groups due to quota mismatch`);
                }
            } else {
                for (const model of models) {
                    groupMap.set(model.modelId, [model]);
                }
            }
            
            groups = [];
            let groupIndex = 1;
            
            for (const [groupId, groupModels] of groupMap) {
                let groupName = '';
                const customNames = config.groupingCustomNames;
                
                const nameVotes = new Map<string, number>();
                for (const model of groupModels) {
                    const customName = customNames[model.modelId];
                    if (customName) {
                        nameVotes.set(customName, (nameVotes.get(customName) || 0) + 1);
                    }
                }
                
                if (nameVotes.size > 0) {
                    let maxVotes = 0;
                    for (const [name, votes] of nameVotes) {
                        if (votes > maxVotes) {
                            maxVotes = votes;
                            groupName = name;
                        }
                    }
                }
                
                if (!groupName) {
                    if (groupModels.length === 1) {
                        groupName = groupModels[0].label;
                    } else {
                        groupName = `Group ${groupIndex}`;
                    }
                }
                
                const firstModel = groupModels[0];
                const minPercentage = Math.min(...groupModels.map(m => m.remainingPercentage ?? 0));
                
                groups.push({
                    groupId,
                    groupName,
                    models: groupModels,
                    remainingPercentage: minPercentage,
                    resetTime: firstModel.resetTime,
                    resetTimeDisplay: firstModel.resetTimeDisplay,
                    timeUntilResetFormatted: firstModel.timeUntilResetFormatted,
                    isExhausted: groupModels.some(m => m.isExhausted),
                });
                
                groupIndex++;
            }
            
            const modelIndexMap = new Map<string, number>();
            models.forEach((m, i) => modelIndexMap.set(m.modelId, i));

            groups.sort((a, b) => {
                const minIndexA = Math.min(...a.models.map(m => modelIndexMap.get(m.modelId) ?? 99999));
                const minIndexB = Math.min(...b.models.map(m => modelIndexMap.get(m.modelId) ?? 99999));
                return minIndexA - minIndexB;
            });
            
            logger.debug(`Grouping enabled: ${groups.length} groups created (saved mappings: ${hasSavedMappings})`);
        }

        return {
            timestamp: new Date(),
            promptCredits,
            userInfo,
            models,
            allModels,
            groups,
            isConnected: true,
        };
    }

    /**
     */
    private formatIso(d: Date): string {
        const dateStr = d.toLocaleDateString(undefined, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        const timeStr = d.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
        return `${dateStr} ${timeStr}`;
    }

    /**
     */
    private formatDelta(ms: number): string {
        if (ms <= 0) {
            return t('dashboard.online');
        }
        const totalMinutes = Math.ceil(ms / 60000);
        
        if (totalMinutes < 60) {
            return `${totalMinutes}m`;
        }
        
        const totalHours = Math.floor(totalMinutes / 60);
        const remainingMinutes = totalMinutes % 60;
        
        if (totalHours < 24) {
            return `${totalHours}h ${remainingMinutes}m`;
        }
        
        const days = Math.floor(totalHours / 24);
        const remainingHours = totalHours % 24;
        return `${days}d ${remainingHours}h ${remainingMinutes}m`;
    }

    /**
     */
    static createOfflineSnapshot(errorMessage?: string): QuotaSnapshot {
        return {
            timestamp: new Date(),
            models: [],
            isConnected: false,
            errorMessage,
        };
    }

    /**
     */
    static calculateGroupMappings(models: ModelQuotaInfo[]): Record<string, string> {
        const statsMap = new Map<string, string[]>();
        for (const model of models) {
            const fingerprint = `${model.remainingFraction?.toFixed(6)}_${model.resetTime.getTime()}`;
            if (!statsMap.has(fingerprint)) {
                statsMap.set(fingerprint, []);
            }
            statsMap.get(fingerprint)!.push(model.modelId);
        }

        if (statsMap.size === 1 && models.length > 1) {
            logger.info('Auto-grouping detected degenerate state (all models identical), falling back to ID-based fallback grouping.');
            return this.groupBasedOnSeries(models);
        }
        
        const mappings: Record<string, string> = {};
        for (const [, modelIds] of statsMap) {
            const stableGroupId = modelIds.sort().join('_');
            for (const modelId of modelIds) {
                mappings[modelId] = stableGroupId;
            }
        }
        
        return mappings;
    }

    /**
     */
    private static groupBasedOnSeries(models: ModelQuotaInfo[]): Record<string, string> {
        const seriesMap = new Map<string, string[]>();

        const GROUPS = {
            GEMINI: ['MODEL_PLACEHOLDER_M8', 'MODEL_PLACEHOLDER_M7'],
            GEMINI_FLASH: ['MODEL_PLACEHOLDER_M18'],
            CLAUDE_GPT: [
                'MODEL_CLAUDE_4_5_SONNET',
                'MODEL_CLAUDE_4_5_SONNET_THINKING',
                'MODEL_PLACEHOLDER_M12', // Claude Opus 4.5 Thinking
                'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
            ],
        };

        for (const model of models) {
            const id = model.modelId;
            let groupName = 'Other';

            if (GROUPS.GEMINI.includes(id)) {
                groupName = 'Gemini';
            } else if (GROUPS.GEMINI_FLASH.includes(id)) {
                groupName = 'Gemini Flash';
            } else if (GROUPS.CLAUDE_GPT.includes(id)) {
                groupName = 'Claude';
            }

            if (!seriesMap.has(groupName)) {
                seriesMap.set(groupName, []);
            }
            seriesMap.get(groupName)!.push(id);
        }

        const mappings: Record<string, string> = {};
        for (const [, modelIds] of seriesMap) {
            const stableGroupId = modelIds.sort().join('_');
            for (const modelId of modelIds) {
                mappings[modelId] = stableGroupId;
            }
        }
        return mappings;
    }
}

export type quota_snapshot = QuotaSnapshot;
export type model_quota_info = ModelQuotaInfo;
