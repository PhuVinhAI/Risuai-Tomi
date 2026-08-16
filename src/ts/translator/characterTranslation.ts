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

function protectSourceSyntax(text: string): ProtectedTranslationText {
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
    let masked = "";
    let unprotected = "";
    let cursor = 0;
    for (const range of selected) {
        const visible = text.slice(cursor, range.start);
        const token = `⟪RISU_LOCK_${protectedFragments.length.toString().padStart(4, "0")}⟫`;
        masked += visible + token;
        unprotected += visible + " ";
        protectedFragments.push(range.value);
        cursor = range.end;
    }
    masked += text.slice(cursor);
    unprotected += text.slice(cursor);

    const structuralSymbols = Array.from(new Set(
        Array.from(unprotected).filter((char) =>
            /[\p{P}\p{S}]/u.test(char) && !ordinaryProsePunctuation.has(char)
        ),
    )).slice(0, 48);

    return { masked, protectedFragments, structuralSymbols };
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

function restoreProtectedSyntax(result: string, protectedFragments: string[]): string {
    let restored = result;
    protectedFragments.forEach((fragment, index) => {
        const token = `⟪RISU_LOCK_${index.toString().padStart(4, "0")}⟫`;
        const occurrences = restored.split(token).length - 1;
        if (occurrences !== 1) {
            throw new Error(`Translation changed protected syntax token ${index + 1}.`);
        }
        restored = restored.replace(token, fragment);
    });
    return restored;
}

export type CharacterTranslationScope = "greeting" | "all";

export interface CharacterTranslationProgress {
    current: number;
    total: number;
    label: string;
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
}

interface TranslationSlot {
    label: string;
    value: string;
    apply: (translated: string) => void;
}

interface CharacterTranslationSessionState {
    preset: CharacterTranslationPreset;
    slots: TranslationSlot[];
    translated: string[];
    controller: AbortController | null;
    stopReason: "none" | "pause" | "cancel";
    running: Promise<CharacterTranslationStatus> | null;
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
        protectedText.protectedFragments,
    );
    if (!translated) {
        throw new Error("Translation returned an empty response.");
    }

    return translated;
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

export function createCharacterTranslationSession(
    char: character,
    preset: CharacterTranslationPreset,
    scope: CharacterTranslationScope,
): CharacterTranslationSession {
    const slots = collectCharacterTranslationSlots(char, scope);
    const session: CharacterTranslationSession = {
        status: "ready",
        scope,
        current: 0,
        total: slots.length,
        label: slots[0]?.label ?? "",
        error: "",
    };

    characterTranslationSessionStates.set(session, {
        preset,
        slots,
        translated: [],
        controller: null,
        stopReason: "none",
        running: null,
    });

    return session;
}

export function pauseCharacterTranslation(session: CharacterTranslationSession): void {
    const state = getSessionState(session);
    if (session.status !== "running") return;

    state.stopReason = "pause";
    session.status = "pausing";
    state.controller?.abort();
}

export function cancelCharacterTranslation(session: CharacterTranslationSession): void {
    const state = getSessionState(session);
    if (session.status === "completed" || session.status === "cancelled") return;

    state.stopReason = "cancel";
    state.translated = [];
    session.status = "cancelled";
    session.error = "";
    session.label = "";
    state.controller?.abort();
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

        while (session.current < state.slots.length) {
            const slot = state.slots[session.current];
            session.label = slot.label;
            state.controller = new AbortController();
            emitSessionProgress(session, onProgress);

            try {
                const result = await translateCharacterText(
                    slot.value,
                    state.preset,
                    state.controller.signal,
                );

                const stopped = settleRequestedStop(session, state, onProgress);
                if (stopped) return stopped;
                state.translated.push(result);
                session.current += 1;
            }
            catch (error) {
                const stopped = settleRequestedStop(session, state, onProgress);
                if (stopped) return stopped;

                session.status = "error";
                session.error = error instanceof Error ? error.message : `${error}`;
                emitSessionProgress(session, onProgress);
                return session.status;
            }
            finally {
                state.controller = null;
            }
        }

        state.slots.forEach((slot, index) => slot.apply(state.translated[index]));
        session.status = "completed";
        session.label = "";
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
): Promise<number> {
    const session = createCharacterTranslationSession(char, preset, scope);
    const status = await continueCharacterTranslation(session, onProgress);

    if (status === "error") throw new Error(session.error);
    if (status !== "completed") throw new Error(`Translation ${status}.`);
    return session.total;
}
