import { encodeMultilangString, parseMultilangString } from "../util";
import type { character, loreBook, botPreset } from "../storage/database.svelte";
import { requestChatData } from "../process/request/request";

export const characterCardTranslationSystemPrompt = `You are Risuai's character-card translation engine.
Translate the user's content into Vietnamese and return only the translation.
Preserve the original meaning, tone, paragraph breaks, line breaks, dialogue structure, and markup.
Never add explanations, summaries, labels, thoughts, or content that is not in the source.
Discover and preserve the source's own formatting and output protocol instead of assuming a fixed markup scheme.
Keep syntax delimiters, tag names, attribute names, placeholders, variables, escaped sequences, and asset keys exactly unchanged.
Translate natural-language prose inside custom markup when appropriate, while leaving its structure intact.
Do not translate code, JSON, CSS, JavaScript, regular expressions, lore activation keys, or asset identifiers.`;

interface ProtectedTranslationText {
    masked: string;
    protectedFragments: string[];
    protectedTokens: string[];
    structuralSymbols: string[];
}

interface ProtectedRange {
    start: number;
    end: number;
    value: string;
}

const ordinaryProsePunctuation = new Set(Array.from(`.,!?;\"'“”‘’…—–-()`));

function collectProtectedRanges(text: string, regex: RegExp): ProtectedRange[] {
    const ranges: ProtectedRange[] = [];
    for (const match of text.matchAll(regex)) {
        if (match.index === undefined || !match[0]) continue;
        ranges.push({
            start: match.index,
            end: match.index + match[0].length,
            value: match[0],
        });
    }
    return ranges;
}

function protectSourceSyntax(text: string, namespace = ""): ProtectedTranslationText {
    const candidates = [
        ...collectProtectedRanges(text, /```[\s\S]*?```/g),
        ...collectProtectedRanges(text, /<\/?[A-Za-z][^<>]*>/g),
        ...collectProtectedRanges(text, /`[^`\r\n]+`/g),
        ...collectProtectedRanges(text, /\{\{[^{}\r\n]{0,200}\}\}|\[\[[^\[\]\r\n]{0,200}\]\]|<<[^<>\r\n]{0,200}>>/g),
        ...collectProtectedRanges(text, /https?:\/\/[^\s<>\"']+/g),
        ...collectProtectedRanges(text, /\b[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+){2,}\b/gu),
        ...collectProtectedRanges(text, /\\(?:[0abfnrtv\\'\"]|x[\dA-Fa-f]{2}|u[\dA-Fa-f]{4}|u\{[\dA-Fa-f]+\})/g),
        ...collectProtectedRanges(text, /[$@][A-Za-z_][\w.-]*/g),
        ...collectProtectedRanges(text, /%[A-Za-z_][\w.-]*%/g),
    ].sort((a, b) => a.start - b.start || b.end - a.end);

    const selected: ProtectedRange[] = [];
    let occupiedUntil = -1;
    for (const candidate of candidates) {
        if (candidate.start < occupiedUntil) continue;
        selected.push(candidate);
        occupiedUntil = candidate.end;
    }

    const protectedFragments: string[] = [];
    const protectedTokens: string[] = [];
    let masked = "";
    let unprotected = "";
    let cursor = 0;
    for (const range of selected) {
        const visible = text.slice(cursor, range.start);
        const token = namespace
            ? `⟪RISU_LOCK_${namespace}_${protectedFragments.length.toString().padStart(4, "0")}⟫`
            : `⟪RISU_LOCK_${protectedFragments.length.toString().padStart(4, "0")}⟫`;
        masked += visible + token;
        unprotected += visible + " ";
        protectedFragments.push(range.value);
        protectedTokens.push(token);
        cursor = range.end;
    }
    masked += text.slice(cursor);
    unprotected += text.slice(cursor);

    const structuralSymbols = Array.from(new Set(
        Array.from(unprotected).filter((char) =>
            /[\p{P}\p{S}]/u.test(char) && !ordinaryProsePunctuation.has(char)
        ),
    )).slice(0, 48);

    return { masked, protectedFragments, protectedTokens, structuralSymbols };
}

function buildTranslationSystemPrompt(protectedText: ProtectedTranslationText): string {
    const profile: string[] = [];
    if (protectedText.protectedFragments.length > 0) {
        profile.push(
            `The source contains ${protectedText.protectedFragments.length} immutable RISU_LOCK placeholder(s). Copy every placeholder exactly once; each will be restored after translation.`,
        );
    }
    if (protectedText.structuralSymbols.length > 0) {
        profile.push(
            `Source-specific structural symbols detected: ${JSON.stringify(protectedText.structuralSymbols)}. Preserve their markup function and pairing while translating prose between them.`,
        );
    }

    return profile.length > 0
        ? `${characterCardTranslationSystemPrompt}\n\nSource-specific syntax profile:\n- ${profile.join("\n- ")}`
        : characterCardTranslationSystemPrompt;
}

function restoreProtectedSyntax(result: string, protectedText: ProtectedTranslationText): string {
    let restored = result;
    protectedText.protectedFragments.forEach((fragment, index) => {
        const token = protectedText.protectedTokens[index];
        const occurrences = restored.split(token).length - 1;
        if (occurrences !== 1) {
            throw new Error(`Translation changed protected syntax token ${index + 1}.`);
        }
        restored = restored.replace(token, fragment);
    });
    return restored;
}

export type CharacterTranslationScope = "greeting" | "all";

export interface CharacterTranslationExecutionOptions {
    batchSize: number;
    requestCharLimit: number;
    concurrency: number;
}

const defaultCharacterTranslationExecutionOptions: CharacterTranslationExecutionOptions = {
    batchSize: 12,
    requestCharLimit: 12000,
    concurrency: 2,
};

export interface CharacterTranslationProgress {
    current: number;
    total: number;
    label: string;
    batchCurrent: number;
    batchTotal: number;
}

export type CharacterTranslationStatus =
    | "ready"
    | "running"
    | "pausing"
    | "paused"
    | "error"
    | "completed"
    | "cancelled";

export interface CharacterTranslationSession {
    status: CharacterTranslationStatus;
    scope: CharacterTranslationScope;
    current: number;
    total: number;
    label: string;
    error: string;
    batchCurrent: number;
    batchTotal: number;
}

interface TranslationSlot {
    label: string;
    value: string;
    apply: (translated: string) => void;
}

interface CharacterTranslationSessionState {
    preset: CharacterTranslationPreset;
    slots: TranslationSlot[];
    batches: TranslationBatch[];
    translated: (string | undefined)[];
    completedBatches: Set<number>;
    controllers: Map<number, AbortController>;
    concurrency: number;
    stopReason: "none" | "pause" | "cancel";
    running: Promise<CharacterTranslationStatus> | null;
}

interface TranslationBatch {
    start: number;
    end: number;
}

const characterTranslationSessionStates = new WeakMap<
    CharacterTranslationSession,
    CharacterTranslationSessionState
>();

type CharacterTranslationPreset = botPreset;

function addSlot(
    slots: TranslationSlot[],
    label: string,
    value: unknown,
    apply: (translated: string) => void,
): void {
    if (typeof value !== "string" || value.trim().length === 0) return;
    slots.push({ label, value, apply });
}

function addLoreSlots(slots: TranslationSlot[], lore: loreBook, index: number): void {
    addSlot(slots, `Lore ${index + 1} comment`, lore.comment, (translated) => {
        lore.comment = translated;
    });
    addSlot(slots, `Lore ${index + 1} content`, lore.content, (translated) => {
        lore.content = translated;
    });
}

function getCreatorNotesTranslation(source: string): {
    value: string;
    apply: (translated: string) => string;
} | null {
    const parsed = parseMultilangString(source);
    const value = parsed.en
        || parsed.xx
        || Object.entries(parsed).find(([code, text]) => code !== "vi" && text.trim())?.[1]
        || parsed.vi;

    if (!value?.trim()) return null;

    const apply = (translated: string) => {
        const next = { ...parsed };
        delete next.xx;
        next.vi = translated;
        return encodeMultilangString(next);
    };

    return { value, apply };
}

export function collectCharacterTranslationSlots(
    char: character,
    scope: CharacterTranslationScope,
): TranslationSlot[] {
    const slots: TranslationSlot[] = [];

    addSlot(slots, "Greeting", char.firstMessage, (translated) => {
        char.firstMessage = translated;
    });

    if (scope === "greeting") return slots;

    addSlot(slots, "Description", char.desc, (translated) => {
        char.desc = translated;
    });
    addSlot(slots, "Notes", char.notes, (translated) => {
        char.notes = translated;
    });
    addSlot(slots, "Example messages", char.exampleMessage, (translated) => {
        char.exampleMessage = translated;
    });
    const creatorNotes = getCreatorNotesTranslation(char.creatorNotes);
    if (creatorNotes) {
        addSlot(slots, "Creator notes", creatorNotes.value, (translated) => {
            char.creatorNotes = creatorNotes.apply(translated);
        });
    }
    addSlot(slots, "System prompt", char.systemPrompt, (translated) => {
        char.systemPrompt = translated;
    });
    addSlot(slots, "Post-history instructions", char.postHistoryInstructions, (translated) => {
        char.postHistoryInstructions = translated;
    });
    addSlot(slots, "Replace global note", char.replaceGlobalNote, (translated) => {
        char.replaceGlobalNote = translated;
    });
    addSlot(slots, "Additional text", char.additionalText, (translated) => {
        char.additionalText = translated;
    });
    addSlot(slots, "Personality", char.personality, (translated) => {
        char.personality = translated;
    });
    addSlot(slots, "Scenario", char.scenario, (translated) => {
        char.scenario = translated;
    });
    addSlot(slots, "Translator note", char.translatorNote, (translated) => {
        char.translatorNote = translated;
    });
    addSlot(slots, "Depth prompt", char.depth_prompt?.prompt, (translated) => {
        if (char.depth_prompt) char.depth_prompt.prompt = translated;
    });

    char.alternateGreetings?.forEach((greeting, index) => {
        addSlot(slots, `Alternate greeting ${index + 1}`, greeting, (translated) => {
            char.alternateGreetings[index] = translated;
        });
    });

    char.group_only_greetings?.forEach((greeting, index) => {
        addSlot(slots, `Group-only greeting ${index + 1}`, greeting, (translated) => {
            char.group_only_greetings![index] = translated;
        });
    });

    char.globalLore?.forEach((lore, index) => addLoreSlots(slots, lore, index));

    return slots;
}

function stripReasoning(result: string): string {
    return result.replace(/<Thoughts>[\s\S]*?<\/Thoughts>/gi, "").trim();
}

/**
 * Uses the selected bot preset only as the request/AI configuration. The
 * message list is deliberately built here so the preset's roleplay prompts
 * are never sent as the translation system prompt.
 */
export async function translateCharacterText(
    text: string,
    preset: CharacterTranslationPreset,
    abortSignal?: AbortSignal,
): Promise<string> {
    const protectedText = protectSourceSyntax(text);
    const response = await requestChatData(
        {
            formated: [
                { role: "system", content: buildTranslationSystemPrompt(protectedText) },
                { role: "user", content: protectedText.masked },
            ],
            bias: {},
            biasString: preset.bias ?? [],
            useStreaming: false,
            noMultiGen: true,
            skipRequestTrigger: true,
            presetOverride: preset,
        },
        "translate",
        abortSignal,
    );

    if (response.type === "fail") {
        throw new Error(response.result || "Translation request failed.");
    }
    if (response.type !== "success") {
        throw new Error("Translation returned an unexpected response type.");
    }

    const translated = restoreProtectedSyntax(
        stripReasoning(response.result),
        protectedText,
    );
    if (!translated) {
        throw new Error("Translation returned an empty response.");
    }

    return translated;
}

function stripBatchFence(result: string): string {
    const trimmed = stripReasoning(result).trim();
    const fenced = trimmed.match(/^```[A-Za-z0-9_-]*\s*([\s\S]*?)\s*```$/i);
    return fenced?.[1]?.trim() ?? trimmed;
}

const translationBatchEndMarker = "<<<RISU_BATCH_END>>>";

interface ParsedTranslationBatch {
    results: (string | undefined)[];
    firstError: Error | null;
}

function findUniqueMarker(text: string, marker: string): number {
    const start = text.indexOf(marker);
    if (start === -1) return -1;
    return text.indexOf(marker, start + marker.length) === -1 ? start : -1;
}

function parseTranslationBatchResponse(
    result: string,
    protectedTexts: ProtectedTranslationText[],
): ParsedTranslationBatch {
    const cleaned = stripBatchFence(result);
    const markers = protectedTexts.map((_, index) =>
        `<<<RISU_BATCH_ITEM_${index.toString().padStart(4, "0")}>>>`
    );
    let firstError: Error | null = null;
    const fail = (message: string) => {
        const error = new Error(message);
        firstError ??= error;
        return undefined;
    };
    const results = protectedTexts.map((protectedText, index) => {
        const marker = markers[index];
        const markerStart = findUniqueMarker(cleaned, marker);
        if (markerStart === -1) {
            return fail(`Translation batch did not preserve item marker ${index + 1}.`);
        }
        const contentStart = markerStart + marker.length;
        const nextMarker = index + 1 < markers.length
            ? markers[index + 1]
            : translationBatchEndMarker;
        const nextMarkerStart = findUniqueMarker(cleaned, nextMarker);
        if (nextMarkerStart === -1 || nextMarkerStart < contentStart) {
            return fail(index + 1 < markers.length
                ? `Translation batch did not preserve item marker ${index + 2}.`
                : "Translation batch did not preserve the end marker."
            );
        }

        let translated = cleaned.slice(contentStart, nextMarkerStart);
        if (translated.startsWith("\r\n")) translated = translated.slice(2);
        else if (translated.startsWith("\n")) translated = translated.slice(1);
        if (translated.endsWith("\r\n")) translated = translated.slice(0, -2);
        else if (translated.endsWith("\n")) translated = translated.slice(0, -1);
        if (!translated.trim()) {
            return fail(`Translation batch is missing item ${index + 1}.`);
        }
        try {
            return restoreProtectedSyntax(translated, protectedText);
        }
        catch (error) {
            firstError ??= error instanceof Error ? error : new Error(`${error}`);
            return undefined;
        }
    });
    return { results, firstError };
}

async function requestCharacterTextBatch(
    texts: string[],
    preset: CharacterTranslationPreset,
    abortSignal?: AbortSignal,
): Promise<ParsedTranslationBatch> {
    const protectedTexts = texts.map((text, index) =>
        protectSourceSyntax(text, index.toString().padStart(3, "0"))
    );
    const combinedProfile: ProtectedTranslationText = {
        masked: "",
        protectedFragments: protectedTexts.flatMap((item) => item.protectedFragments),
        protectedTokens: protectedTexts.flatMap((item) => item.protectedTokens),
        structuralSymbols: Array.from(new Set(
            protectedTexts.flatMap((item) => item.structuralSymbols),
        )).slice(0, 48),
    };
    const batchMarkers = protectedTexts.map((_, index) =>
        `<<<RISU_BATCH_ITEM_${index.toString().padStart(4, "0")}>>>`
    );
    const batchInstruction = `The user message is plain text split into items by RISU_BATCH_ITEM marker lines.
Translate the natural-language text after each marker until the next marker.
Return plain text only. Copy every marker exactly once, unchanged, on its own line and in the original order.
Copy ${translationBatchEndMarker} exactly once on its own line after the final translation.
Do not return JSON, Markdown fences, explanations, labels, or any text before the first marker.`;
    const response = await requestChatData(
        {
            formated: [
                {
                    role: "system",
                    content: `${buildTranslationSystemPrompt(combinedProfile)}\n\nBatch protocol:\n${batchInstruction}`,
                },
                {
                    role: "user",
                    content: `${protectedTexts.map((item, index) =>
                        `${batchMarkers[index]}\n${item.masked}`
                    ).join("\n")}\n${translationBatchEndMarker}`,
                },
            ],
            bias: {},
            biasString: preset.bias ?? [],
            useStreaming: false,
            noMultiGen: true,
            skipRequestTrigger: true,
            presetOverride: preset,
        },
        "translate",
        abortSignal,
    );

    if (response.type === "fail") {
        throw new Error(response.result || "Translation request failed.");
    }
    if (response.type !== "success") {
        throw new Error("Translation returned an unexpected response type.");
    }

    return parseTranslationBatchResponse(response.result, protectedTexts);
}

function collectMissingRanges(results: (string | undefined)[]): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    let start = -1;
    results.forEach((result, index) => {
        if (result === undefined && start === -1) start = index;
        if (result !== undefined && start !== -1) {
            ranges.push([start, index]);
            start = -1;
        }
    });
    if (start !== -1) ranges.push([start, results.length]);
    return ranges;
}

async function translateCharacterTextBatch(
    texts: string[],
    preset: CharacterTranslationPreset,
    abortSignal?: AbortSignal,
): Promise<string[]> {
    if (texts.length === 0) return [];
    if (texts.length === 1) {
        return [await translateCharacterText(texts[0], preset, abortSignal)];
    }

    const parsed = await requestCharacterTextBatch(texts, preset, abortSignal);
    const missingRanges = collectMissingRanges(parsed.results);
    if (missingRanges.length === 0) return parsed.results as string[];

    // A provider may stop at its completion-token limit after translating a
    // valid prefix. Keep that prefix and request only the unresolved ranges.
    // If no item was recoverable, split the batch so retries cannot repeat the
    // same oversized request forever.
    if (parsed.results.every((result) => result === undefined)) {
        const midpoint = Math.ceil(texts.length / 2);
        const first = await translateCharacterTextBatch(
            texts.slice(0, midpoint),
            preset,
            abortSignal,
        );
        const second = await translateCharacterTextBatch(
            texts.slice(midpoint),
            preset,
            abortSignal,
        );
        return [...first, ...second];
    }

    const recovered = [...parsed.results];
    for (const [start, end] of missingRanges) {
        const retry = await translateCharacterTextBatch(
            texts.slice(start, end),
            preset,
            abortSignal,
        );
        retry.forEach((translation, index) => {
            recovered[start + index] = translation;
        });
    }

    const unresolvedIndex = recovered.findIndex((result) => result === undefined);
    if (unresolvedIndex !== -1) {
        throw parsed.firstError
            ?? new Error(`Translation batch is missing item ${unresolvedIndex + 1}.`);
    }
    return recovered as string[];
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 1
        ? Math.floor(numeric)
        : fallback;
}

function resolveExecutionOptions(
    options: Partial<CharacterTranslationExecutionOptions>,
): CharacterTranslationExecutionOptions {
    return {
        batchSize: normalizePositiveInteger(
            options.batchSize,
            defaultCharacterTranslationExecutionOptions.batchSize,
        ),
        requestCharLimit: normalizePositiveInteger(
            options.requestCharLimit,
            defaultCharacterTranslationExecutionOptions.requestCharLimit,
        ),
        concurrency: normalizePositiveInteger(
            options.concurrency,
            defaultCharacterTranslationExecutionOptions.concurrency,
        ),
    };
}

function createTranslationBatches(
    slots: TranslationSlot[],
    options: CharacterTranslationExecutionOptions,
): TranslationBatch[] {
    const batches: TranslationBatch[] = [];

    let start = 0;
    let characters = 0;
    for (let index = 0; index < slots.length; index += 1) {
        const nextCharacters = slots[index].value.length;
        const itemCount = index - start;
        if (itemCount > 0 && (
            itemCount >= options.batchSize
            || characters + nextCharacters > options.requestCharLimit
        )) {
            batches.push({ start, end: index });
            start = index;
            characters = 0;
        }
        characters += nextCharacters;
    }
    if (start < slots.length) batches.push({ start, end: slots.length });

    return batches;
}

function getSessionState(session: CharacterTranslationSession): CharacterTranslationSessionState {
    const state = characterTranslationSessionStates.get(session);
    if (!state) throw new Error("Invalid character translation session.");
    return state;
}

function emitSessionProgress(
    session: CharacterTranslationSession,
    onProgress?: (progress: CharacterTranslationProgress) => void,
): void {
    onProgress?.({
        current: session.current,
        total: session.total,
        label: session.label,
        batchCurrent: session.batchCurrent,
        batchTotal: session.batchTotal,
    });
}

function settleRequestedStop(
    session: CharacterTranslationSession,
    state: CharacterTranslationSessionState,
    onProgress?: (progress: CharacterTranslationProgress) => void,
): CharacterTranslationStatus | null {
    if (state.stopReason === "pause") {
        session.status = "paused";
        emitSessionProgress(session, onProgress);
        return session.status;
    }
    if (state.stopReason === "cancel") {
        session.status = "cancelled";
        emitSessionProgress(session, onProgress);
        return session.status;
    }
    return null;
}

function createTranslationSessionFromSlots(
    slots: TranslationSlot[],
    preset: CharacterTranslationPreset,
    scope: CharacterTranslationScope,
    executionOptions: Partial<CharacterTranslationExecutionOptions> = {},
): CharacterTranslationSession {
    const resolvedOptions = resolveExecutionOptions(executionOptions);
    const batches = createTranslationBatches(slots, resolvedOptions);
    const session: CharacterTranslationSession = {
        status: "ready",
        scope,
        current: 0,
        total: slots.length,
        label: slots[0]?.label ?? "",
        error: "",
        batchCurrent: 0,
        batchTotal: batches.length,
    };

    characterTranslationSessionStates.set(session, {
        preset,
        slots,
        batches,
        translated: new Array(slots.length),
        completedBatches: new Set(),
        controllers: new Map(),
        concurrency: resolvedOptions.concurrency,
        stopReason: "none",
        running: null,
    });

    return session;
}

export function createCharacterTranslationSession(
    char: character,
    preset: CharacterTranslationPreset,
    scope: CharacterTranslationScope,
    executionOptions: Partial<CharacterTranslationExecutionOptions> = {},
): CharacterTranslationSession {
    return createTranslationSessionFromSlots(
        collectCharacterTranslationSlots(char, scope),
        preset,
        scope,
        executionOptions,
    );
}

export function createCharacterTextTranslationSession(
    text: string,
    preset: CharacterTranslationPreset,
    apply: (translated: string) => void,
    executionOptions: Partial<CharacterTranslationExecutionOptions> = {},
): CharacterTranslationSession {
    const slots: TranslationSlot[] = [];
    addSlot(slots, "Greeting", text, apply);
    return createTranslationSessionFromSlots(
        slots,
        preset,
        "greeting",
        executionOptions,
    );
}

export function pauseCharacterTranslation(session: CharacterTranslationSession): void {
    const state = getSessionState(session);
    if (session.status !== "running") return;

    state.stopReason = "pause";
    session.status = "pausing";
    state.controllers.forEach((controller) => controller.abort());
}

export function cancelCharacterTranslation(session: CharacterTranslationSession): void {
    const state = getSessionState(session);
    if (session.status === "completed" || session.status === "cancelled") return;

    state.stopReason = "cancel";
    state.translated = new Array(state.slots.length);
    state.completedBatches.clear();
    session.current = 0;
    session.batchCurrent = 0;
    session.status = "cancelled";
    session.error = "";
    session.label = "";
    state.controllers.forEach((controller) => controller.abort());
}

export async function continueCharacterTranslation(
    session: CharacterTranslationSession,
    onProgress?: (progress: CharacterTranslationProgress) => void,
): Promise<CharacterTranslationStatus> {
    const state = getSessionState(session);
    if (state.running) return state.running;
    if (session.status === "completed" || session.status === "cancelled") {
        return session.status;
    }

    const run = async (): Promise<CharacterTranslationStatus> => {
        state.stopReason = "none";
        session.status = "running";
        session.error = "";
        emitSessionProgress(session, onProgress);

        while (state.completedBatches.size < state.batches.length) {
            const pendingBatchIndexes = state.batches
                .map((_, index) => index)
                .filter((index) => !state.completedBatches.has(index));
            const wave = pendingBatchIndexes.slice(0, state.concurrency);
            const firstBatch = state.batches[wave[0]];
            const firstBatchSlots = firstBatch
                ? state.slots.slice(firstBatch.start, firstBatch.end)
                : [];
            session.label = firstBatchSlots.length > 1
                ? `${firstBatchSlots[0].label} +${firstBatchSlots.length - 1}`
                : firstBatchSlots[0]?.label ?? "";
            emitSessionProgress(session, onProgress);

            const outcomes = await Promise.all(wave.map(async (batchIndex) => {
                const batch = state.batches[batchIndex];
                const batchSlots = state.slots.slice(batch.start, batch.end);
                const controller = new AbortController();
                state.controllers.set(batchIndex, controller);

                try {
                    const results = await translateCharacterTextBatch(
                        batchSlots.map((slot) => slot.value),
                        state.preset,
                        controller.signal,
                    );
                    if (state.stopReason !== "none") {
                        return { batchIndex, error: null };
                    }

                    results.forEach((result, offset) => {
                        state.translated[batch.start + offset] = result;
                    });
                    state.completedBatches.add(batchIndex);
                    session.current = Array.from(state.completedBatches).reduce(
                        (total, completedIndex) => {
                            const completed = state.batches[completedIndex];
                            return total + completed.end - completed.start;
                        },
                        0,
                    );
                    session.batchCurrent = state.completedBatches.size;
                    emitSessionProgress(session, onProgress);
                    return { batchIndex, error: null };
                }
                catch (error) {
                    return { batchIndex, error };
                }
                finally {
                    state.controllers.delete(batchIndex);
                }
            }));

            const stopped = settleRequestedStop(session, state, onProgress);
            if (stopped) return stopped;

            const failed = outcomes.find((outcome) => outcome.error !== null);
            if (failed) {
                session.status = "error";
                session.error = failed.error instanceof Error
                    ? failed.error.message
                    : `${failed.error}`;
                emitSessionProgress(session, onProgress);
                return session.status;
            }
        }

        state.slots.forEach((slot, index) => {
            const translated = state.translated[index];
            if (translated === undefined) {
                throw new Error(`Translation result ${index + 1} is missing.`);
            }
            slot.apply(translated);
        });
        session.status = "completed";
        session.label = "";
        session.batchCurrent = session.batchTotal;
        emitSessionProgress(session, onProgress);
        return session.status;
    };

    state.running = run();
    try {
        return await state.running;
    }
    finally {
        state.running = null;
    }
}

export async function translateCharacterCard(
    char: character,
    preset: CharacterTranslationPreset,
    scope: CharacterTranslationScope,
    onProgress?: (progress: CharacterTranslationProgress) => void,
    executionOptions: Partial<CharacterTranslationExecutionOptions> = {},
): Promise<number> {
    const session = createCharacterTranslationSession(char, preset, scope, executionOptions);
    const status = await continueCharacterTranslation(session, onProgress);

    if (status === "error") throw new Error(session.error);
    if (status !== "completed") throw new Error(`Translation ${status}.`);
    return session.total;
}
