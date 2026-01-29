/**
 */


export interface PromptCreditsInfo {
    available: number;
    monthly: number;
    usedPercentage: number;
    remainingPercentage: number;
}

export interface ModelQuotaInfo {
    label: string;
    modelId: string;
    remainingFraction?: number;
    remainingPercentage?: number;
    isExhausted: boolean;
    resetTime: Date;
    timeUntilReset: number;
    timeUntilResetFormatted: string;
    resetTimeDisplay: string;
    resetTimeValid?: boolean;
    supportsImages?: boolean;
    isRecommended?: boolean;
    tagTitle?: string;
    supportedMimeTypes?: Record<string, boolean>;
}

export interface QuotaGroup {
    groupId: string;
    groupName: string;
    models: ModelQuotaInfo[];
    remainingPercentage: number;
    resetTime: Date;
    resetTimeDisplay: string;
    timeUntilResetFormatted: string;
    isExhausted: boolean;
}

export interface QuotaSnapshot {
    timestamp: Date;
    /** Prompt Credits */
    promptCredits?: PromptCreditsInfo;
    userInfo?: UserInfo;
    models: ModelQuotaInfo[];
    allModels?: ModelQuotaInfo[];
    groups?: QuotaGroup[];
    isConnected: boolean;
    errorMessage?: string;
    localAccountEmail?: string;
}

export enum QuotaLevel {
    Normal = 'normal',
    Warning = 'warning',
    Critical = 'critical',
    Depleted = 'depleted',
}


export interface ModelOrAlias {
    model: string;
}

export interface QuotaInfo {
    remainingFraction?: number;
    resetTime: string;
}

export interface ClientModelConfig {
    label: string;
    modelOrAlias?: ModelOrAlias;
    quotaInfo?: QuotaInfo;
    supportsImages?: boolean;
    isRecommended?: boolean;
    allowedTiers?: string[];
    tagTitle?: string;
    supportedMimeTypes?: Record<string, boolean>;
}

export interface DefaultTeamConfig {
    allowMcpServers?: boolean;
    allowAutoRunCommands?: boolean;
    allowBrowserExperimentalFeatures?: boolean;
    [key: string]: boolean | string | number | undefined;
}

export interface PlanInfo {
    teamsTier: string;
    planName: string;
    monthlyPromptCredits: number;
    monthlyFlowCredits: number;

    browserEnabled?: boolean;
    knowledgeBaseEnabled?: boolean;
    canBuyMoreCredits?: boolean;
    hasAutocompleteFastMode?: boolean;
    cascadeWebSearchEnabled?: boolean;
    canGenerateCommitMessages?: boolean;
    hasTabToJump?: boolean;
    allowStickyPremiumModels?: boolean;
    allowPremiumCommandModels?: boolean;
    canCustomizeAppIcon?: boolean;
    cascadeCanAutoRunCommands?: boolean;
    canAllowCascadeInBackground?: boolean;

    maxNumChatInputTokens?: string | number;
    maxNumPremiumChatMessages?: string | number;
    maxCustomChatInstructionCharacters?: string | number;
    maxNumPinnedContextItems?: string | number;
    maxLocalIndexSize?: string | number;
    monthlyFlexCreditPurchaseAmount?: number;

    defaultTeamConfig?: DefaultTeamConfig;

    [key: string]: string | number | boolean | object | undefined;
}

export interface PlanStatus {
    planInfo: PlanInfo;
    availablePromptCredits: number;
    availableFlowCredits: number;
}

export interface ModelSortGroup {
    modelLabels: string[];
}

export interface ClientModelSort {
    name: string;
    groups: ModelSortGroup[];
}

export interface CascadeModelConfigData {
    clientModelConfigs: ClientModelConfig[];
    clientModelSorts?: ClientModelSort[];
}

export interface UserStatus {
    name: string;
    email: string;
    planStatus?: PlanStatus;
    cascadeModelConfigData?: CascadeModelConfigData;
    acceptedLatestTermsOfService?: boolean;
    userTier?: {
        name: string;
        id: string;
        description: string;
        upgradeSubscriptionUri?: string;
        upgradeSubscriptionText?: string;
    };
}

export interface ServerUserStatusResponse {
    userStatus: UserStatus;
    message?: string;
    code?: string;
}


export interface EnvironmentScanResult {
    extensionPort: number;
    connectPort: number;
    /** CSRF Token */
    csrfToken: string;
}

export interface ScanDiagnostics {
    scan_method: 'process_name' | 'keyword' | 'unknown';
    target_process: string;
    attempts: number;
    found_candidates: number;
    ports?: number[];
    verified_port?: number | null;
    verification_success?: boolean;
}

export interface ProcessInfo {
    pid: number;
    extensionPort: number;
    /** CSRF Token */
    csrfToken: string;
}

export interface UserInfo {
    name: string;
    email: string;
    planName: string;
    tier: string;
    browserEnabled: boolean;
    knowledgeBaseEnabled: boolean;
    canBuyMoreCredits: boolean;
    hasAutocompleteFastMode: boolean;
    monthlyPromptCredits: number;
    monthlyFlowCredits: number;
    availablePromptCredits: number;
    availableFlowCredits: number;
    cascadeWebSearchEnabled: boolean;
    canGenerateCommitMessages: boolean;
    allowMcpServers: boolean;
    maxNumChatInputTokens: string;
    tierDescription: string;
    upgradeUri: string;
    upgradeText: string;
    // New fields
    teamsTier: string;
    hasTabToJump: boolean;
    allowStickyPremiumModels: boolean;
    allowPremiumCommandModels: boolean;
    maxNumPremiumChatMessages: string;
    maxCustomChatInstructionCharacters: string;
    maxNumPinnedContextItems: string;
    maxLocalIndexSize: string;
    monthlyFlexCreditPurchaseAmount: number;
    canCustomizeAppIcon: boolean;
    cascadeCanAutoRunCommands: boolean;
    canAllowCascadeInBackground: boolean;
    allowAutoRunCommands: boolean;
    allowBrowserExperimentalFeatures: boolean;
    acceptedLatestTermsOfService: boolean;
    userTierId: string;
}


export type WebviewMessageType =
    | 'init'
    | 'refresh'
    | 'togglePin'
    | 'toggleCredits'
    | 'updateOrder'
    | 'resetOrder'
    | 'retry'
    | 'openLogs'
    | 'rerender'
    | 'renameGroup'
    | 'toggleGrouping'
    | 'promptRenameGroup'
    | 'toggleGroupPin'
    | 'updateGroupOrder'
    | 'updateNotificationEnabled'
    | 'updateThresholds'
    | 'renameModel'
    | 'updateStatusBarFormat'
    | 'toggleProfile'
    | 'updateDisplayMode'
    | 'updateDataMasked'
    | 'updateLanguage'
    | 'saveCustomGrouping'
    // Quota History
    | 'quotaHistory.get'
    | 'updateVisibleModels'
    | 'quotaHistory.clear'
    | 'quotaHistory.clearAll';

export interface WebviewMessage {
    command: WebviewMessageType;
    modelId?: string;
    order?: string[];
    groupId?: string;
    groupName?: string;
    currentName?: string;
    modelIds?: string[];
    notificationEnabled?: boolean;
    warningThreshold?: number;
    criticalThreshold?: number;
    statusBarFormat?: string;
    displayMode?: 'webview' | 'quickpick';
    dataMasked?: boolean;
    language?: string;
    customGroupMappings?: Record<string, string>;
    customGroupNames?: Record<string, string>;
    visibleModels?: string[];
    rangeDays?: number;
    email?: string;
}

export interface DashboardConfig {
    showPromptCredits: boolean;
    pinnedModels: string[];
    modelOrder: string[];
    modelCustomNames?: Record<string, string>;
    visibleModels?: string[];
    groupingEnabled: boolean;
    groupCustomNames: Record<string, string>;
    groupingShowInStatusBar: boolean;
    pinnedGroups: string[];
    groupOrder: string[];
    refreshInterval: number;
    notificationEnabled: boolean;
    warningThreshold?: number;
    criticalThreshold?: number;
    lastSuccessfulUpdate?: Date | null;
    statusBarFormat?: string;
    profileHidden?: boolean;
    displayMode?: string;
    dataMasked?: boolean;
    /** External URL */
    url?: string;
    groupMappings?: Record<string, string>;
    language?: string;
}

export interface StatusBarUpdate {
    text: string;
    tooltip: string;
    backgroundColor?: string;
    minPercentage: number;
}


export type PlatformType = 'windows' | 'darwin' | 'linux';

export interface PlatformStrategy {
    getProcessListCommand(processName: string): string;
    parseProcessInfo(stdout: string): ProcessInfo[];
    getPortListCommand(pid: number): string;
    parseListeningPorts(stdout: string): number[];
    getDiagnosticCommand(): string;
    getErrorMessages(): {
        processNotFound: string;
        commandNotAvailable: string;
        requirements: string[];
    };
}


export type model_quota_info = ModelQuotaInfo;

export type prompt_credits_info = PromptCreditsInfo;

export type quota_snapshot = QuotaSnapshot;

export const quota_level = QuotaLevel;

export type server_user_status_response = ServerUserStatusResponse;

export type environment_scan_result = EnvironmentScanResult;
